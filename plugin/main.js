"use strict";
const { app, core, action, imaging, constants } = require("photoshop");
const uxp = require("uxp");
const lfs = uxp.storage.localFileSystem;
const formats = uxp.storage.formats;
const Engine = require("./engine.js");
const { CHARSETS } = require("./charsets.js");
const { PRESETS } = require("./presets.js");
const setupInk = require("./inkui.js");
const { makeSlider, SLIDER_HTML } = require("./slider.js");
const { enhanceAllSelects } = require("./dropdown.js");
const { createViewer } = require("./viewer.js");
const { findLayers, findLayerById, fullFrame, sameFrame, frameOf, fillArtboardSelect, toRGBA8, convertOut, makeImageData, makeReader } = require("./pixels.js");

const $ = (id) => document.getElementById(id);
// Layers made by the plugin end in "ASCII by Star" (older versions used a "#xxxxxx" tag).
const OUR_RE = /(\s*ASCII by Star|\s*#[a-z0-9]{6})$/;
const TAG_RE = /#([a-z0-9]{6})$/;
const ANALYSIS_MAX = 1600; // long side of the cached analysis image
// The monospaced system font for text layers and for characters missing from the built-in atlas
const MONO_FONT = (() => { try { return require("os").platform() === "win32" ? "Consolas" : "Menlo-Regular"; } catch (e) { return "Menlo-Regular"; } })();

let atlas = null; // glyph atlas in use: the built-in one, or one rendered from the chosen font
let baseAtlas = null;
let S = freshSettings(loadJSON("gf:last", null));
let src = null; // cached analysis pixels {docId, layerId, frame, scale, docW, docH (frame size), w, h, data, stale}
let busy = false;
let editing = null; // {docId, layerId, tag, name, sourceLayerId}
let live = null; // live preview window {docId, layerId, sourceDocId, scale}
let gridCache = { key: null, src: null, grid: null, cs: null, geo: null };
let userPresets = loadJSON("gf:userPresets", []);
let tab = loadJSON("gf:tab", "ascii"); // "ascii" | "ink"
let ink = null; // the Ink bleed tab (inkui.js)

// ---------- utils ----------
function loadJSON(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or unavailable */ } }
function freshSettings(over) {
  const s = JSON.parse(JSON.stringify(Engine.DEFAULTS));
  if (over) for (const k of Object.keys(s)) if (over[k] !== undefined) s[k] = JSON.parse(JSON.stringify(over[k]));
  if (s.dither === "bayer") s.dither = "bayer4"; // renamed in 1.2
  return s;
}
function status(msg, isErr) { const el = $("status"); el.textContent = msg || ""; el.style.color = isErr ? "#ff7070" : ""; }
function errMsg(e) {
  const m = (e && (e.message || e.toString())) || "Unknown error";
  if (/modal/i.test(m)) return "Photoshop is busy (a dialog or tool is active). Finish it and try again.";
  return m;
}
function setSelect(el, v) { for (const o of el.options) o.selected = o.value === String(v); el.value = String(v); if (el.ddUpdate) el.ddUpdate(); }
function activeDoc() { try { return app.activeDocument || null; } catch (e) { return null; } }
function bitDepth(doc) { const b = String(doc.bitsPerChannel); return b.includes("32") ? 32 : b.includes("16") ? 16 : 8; }
function isGray(doc) { return /gray/i.test(String(doc.mode)); }
function checkDoc(doc) {
  if (!doc) throw new Error("Open a document first.");
  if (!/rgb|gray/i.test(String(doc.mode))) throw new Error("ASCII by Star needs an RGB or Grayscale document (Image ▸ Mode ▸ RGB Color).");
}
function charsetInfo() { return CHARSETS.find((c) => c.id === S.charset) || CHARSETS[0]; }
function rainPresetChars() { return (CHARSETS.find((c) => c.id === S.rainCharset) || {}).chars || ""; }
function docBaseName(doc) { return String((doc && doc.title) || "ascii").replace(/\.[^.]+$/, ""); }

let csCache = { key: null, cs: null };
function currentCharset() {
  const parts = Engine.charsetParts(S, charsetInfo().chars, rainPresetChars());
  const key = atlas.id + "|" + JSON.stringify(parts) + "|" + S.sortByDensity;
  if (csCache.key !== key) csCache = { key, cs: Engine.buildCharset(atlas, parts.ramp, S.sortByDensity, parts) };
  return csCache.cs;
}

async function loadAtlas() {
  const folder = await lfs.getPluginFolder();
  const meta = JSON.parse(await (await folder.getEntry("atlas.json")).read({ format: formats.utf8 }));
  const bin = await (await folder.getEntry("atlas.bin")).read({ format: formats.binary });
  return Engine.prepareAtlas(meta, new Uint8Array(bin));
}

// ---------- pixel I/O ----------
// The area to work on: an artboard, or the whole canvas (the Artboard menu; see pixels.js frameOf).
const artboardPick = () => $("artboard").value || "auto";

// Reads the frame (an artboard or the canvas) of the visible image without ASCII by Star layers, or of one
// layer, into an RGBA buffer at `scale`. Inside executeAsModal. ownHistory: undo-proof temporary changes.
async function capture(ctx, doc, layerId, scale, ownHistory, frame) {
  frame = frame || fullFrame(doc);
  const aw = Math.max(1, Math.round(frame.w * scale)), ah = Math.max(1, Math.round(frame.h * scale));
  let hidden = [], sid = null;
  if (layerId === null) {
    hidden = findLayers(doc.layers, (l) => OUR_RE.test(l.name) && l.visible);
    if (ownHistory) { try { sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "ASCII by Star sample" }); } catch (e) { sid = null; } }
    for (const l of hidden) l.visible = false;
  }
  const reader = makeReader(doc, layerId);
  try {
    const data = await reader.read({ x: frame.x * scale, y: frame.y * scale, w: aw, h: ah }, scale);
    return { docId: doc.id, layerId, frame, scale, docW: frame.w, docH: frame.h, w: aw, h: ah, data, stale: false };
  } finally {
    await reader.close();
    for (const l of hidden) { try { l.visible = true; } catch (e) { /* gone */ } }
    if (sid !== null) { try { await ctx.hostControl.resumeHistory(sid, false); } catch (e) { try { await ctx.hostControl.resumeHistory(sid, true); } catch (e2) { /* ignore */ } } }
  }
}

function sourceLayerId(doc) {
  if ($("source").value !== "layer") return null;
  if (editing && editing.docId === doc.id && editing.sourceLayerId != null && findLayerById(doc, editing.sourceLayerId)) return editing.sourceLayerId;
  const al = doc.activeLayers && doc.activeLayers[0];
  if (al && !OUR_RE.test(al.name) && al.kind !== constants.LayerKind.GROUP && String(al.kind) !== "group") return al.id;
  if (src && src.docId === doc.id && src.layerId != null && findLayerById(doc, src.layerId)) return src.layerId;
  return al ? al.id : null;
}
// frame: {w, h} of the area being converted
function baseScale(frame) { return Math.min(1, ANALYSIS_MAX / Math.max(frame.w, frame.h)); }
// analysis resolution needed so every character cell gets ~3x3 real source pixels
function neededScale(frame) {
  const geo = Engine.computeGeometry(frame.w, frame.h, S, atlas);
  return Math.min(1, Math.max(baseScale(frame), (geo.cols * 4.5) / frame.w, (geo.rows * 4.5) / frame.h));
}

// Makes `src` hold the current source. full: at the resolution the output needs (else enough for a preview).
async function ensureSource(full, forDoc) {
  const doc = forDoc || sourceDoc();
  if (!doc) { src = null; return false; }
  checkDoc(doc);
  const layerId = sourceLayerId(doc), frame = await frameOf(doc, layerId, artboardPick());
  const scale = full ? neededScale(frame) : baseScale(frame);
  if (src && !src.stale && src.docId === doc.id && src.layerId === layerId && sameFrame(src.frame, frame) && src.scale >= scale - 1e-6) return true;
  busy = true;
  try { src = await core.executeAsModal((ctx) => capture(ctx, doc, layerId, scale, true, frame), { commandName: "ASCII by Star: read pixels" }); }
  finally { busy = false; }
  return true;
}

// Renders the grid into a layer, in horizontal strips to keep memory low. Inside executeAsModal.
// The output covers the grid's area (the frame) × scale, with its top left at `at` in the target document:
// the frame's corner when writing into the source document, 0,0 in a scratch document of the frame's size.
// scale > 1 renders into a larger document (PNG export at 2x/4x); the grid stays in source-document units.
async function writeLayer(doc, layer, grid, cs, scale, markCorners, at) {
  scale = scale || 1; at = at || { x: 0, y: 0 };
  const W = Math.round(grid.geo.docW * scale), H = Math.round(grid.geo.docH * scale), depth = bitDepth(doc), gray = isGray(doc);
  let profile = null;
  try { profile = doc.colorProfileName || null; } catch (e) { profile = null; }
  const stripH = Math.max(1, Math.min(H, Math.floor(4e6 / W)));
  for (let y0 = 0; y0 < H; y0 += stripH) {
    const h = Math.min(stripH, H - y0);
    const rgba = Engine.render(grid, cs, atlas, S, { x: 0, y: y0 / scale, w: W, h, scale });
    if (markCorners) { // invisible 1/255 alpha pixels pin the layer bounds to the whole area
      if (y0 === 0) rgba[3] = Math.max(rgba[3], 1);
      if (y0 + h >= H) rgba[rgba.length - 1] = Math.max(rgba[rgba.length - 1], 1);
    }
    const id = await makeImageData(convertOut(rgba, W * h, depth, gray), W, h, gray, profile);
    try { await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: id, replace: y0 === 0, targetBounds: { left: at.x, top: at.y + y0 }, commandName: "ASCII by Star" }); }
    catch (e) { id.dispose(); throw new Error("Writing the layer failed (" + errMsg(e) + ")."); }
    id.dispose();
  }
}

async function createLayer(doc, name) {
  if (typeof doc.createPixelLayer === "function") return await doc.createPixelLayer({ name });
  return await doc.createLayer({ name });
}

const TEXT_MODE_HINTS = {
  ramp: "Each character is one brightness step. Characters with a similar amount of ink (like ABC) look alike, so one wins; use ones that differ (.:-=+*#%@), or turn Sort by density off to give each an equal share in your order.",
  words: "Separate words or letter pairs with spaces, e.g.  · oo OK WOW ###. Each one covers as many cells as it has letters; darker areas get the inkier ones.",
  phrase: "Your text is written over the image again and again, like a typed page. Light areas stay empty (Tone ▸ Threshold empties more), and the image shows through the letters' shade and colour.",
};

// ---------- custom fonts ----------
// UXP can't draw text, so characters in an installed font are rendered by Photoshop itself: one text layer
// per character in a scratch document, read back and cropped into an atlas like the built-in one.
// Atlases are cached in memory and in the plugin's data folder.
const fontAtlases = new Map();
let fontBuild = null; // {key, promise}
function charsetString() { const p = Engine.charsetParts(S, charsetInfo().chars, rainPresetChars()); return p.ramp + p.extra; }
// The font to draw with: the chosen one, or Menlo (Consolas on Windows, which has no Menlo) drawn by Photoshop
// when the text has characters the built-in atlas lacks (lowercase Cyrillic, other scripts, emoji…), so nothing
// typed is dropped.
function effectiveFont() {
  if (S.font) return S.font;
  if (baseAtlas) for (const ch of Array.from(charsetString())) if (ch > " " && !baseAtlas.index.has(ch)) return MONO_FONT;
  return "";
}
function fontKey() { const set = new Set(Array.from(" " + charsetString()).filter((c) => c !== "\n" && c !== "\r" && c !== "\t")); return { chars: Array.from(set), key: effectiveFont() + "|" + Array.from(set).join("") }; }
function hashStr(t) { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }

async function loadCachedFontAtlas(key) {
  try {
    const folder = await lfs.getDataFolder(), base = "font-" + hashStr(key);
    const meta = JSON.parse(await (await folder.getEntry(base + ".json")).read({ format: formats.utf8 }));
    if (meta.key !== key) return null;
    const bin = await (await folder.getEntry(base + ".bin")).read({ format: formats.binary });
    const a = Engine.prepareAtlas(meta, new Uint8Array(bin)); a.id = key; return a;
  } catch (e) { return null; }
}
async function saveCachedFontAtlas(key, meta, data) {
  try {
    const folder = await lfs.getDataFolder(), base = "font-" + hashStr(key);
    await (await folder.createFile(base + ".json", { overwrite: true })).write(JSON.stringify(Object.assign({ key }, meta)), { format: formats.utf8 });
    await (await folder.createFile(base + ".bin", { overwrite: true })).write(data.buffer, { format: formats.binary });
  } catch (e) { console.error("font cache", e); }
}

async function buildFontAtlas(fontPS, chars, key) {
  const F = 40, cw0 = Math.round(F * 1.4), cellH = Math.round(F * 1.2), base = Math.round(F * 0.92), cols = 16;
  const rows = Math.ceil(chars.length / cols), W = cols * cw0, H = rows * cellH;
  const boxes = [];
  let pixels = null, comps = 3;
  busy = true;
  try {
    await core.executeAsModal(async () => {
      const tmp = await app.documents.add({ width: W, height: H, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white", name: "ASCII by Star font" });
      try {
        const black = new app.SolidColor(); black.rgb.hexValue = "000000";
        for (let i = 0; i < chars.length; i++) {
          const ch = chars[i], c = i % cols, r = Math.floor(i / cols);
          if (i % 8 === 0) status(`Rendering font ${S.fontName || fontPS}… ${i}/${chars.length}`);
          if (ch === " ") { boxes.push(null); continue; }
          const layer = await tmp.createTextLayer({ contents: ch, fontSize: F, fontName: fontPS, textColor: black, position: { x: c * cw0 + Math.round(cw0 * 0.2), y: r * cellH + base } });
          const b = layer.boundsNoEffects;
          boxes.push(b && b.right > b.left ? { l: b.left, r: b.right } : null);
        }
        const res = await imaging.getPixels({ documentID: tmp.id, applyAlpha: true });
        pixels = await res.imageData.getData({ chunky: true }); comps = res.imageData.components; res.imageData.dispose();
      } finally { await tmp.closeWithoutSaving(); }
    }, { commandName: "ASCII by Star font" });
  } finally { busy = false; }
  // cell width: widest glyph, within sensible limits, so proportional fonts fit
  let maxW = 0;
  for (const b of boxes) if (b) maxW = Math.max(maxW, b.r - b.l);
  const cellW = Math.max(Math.round(F * 0.45), Math.min(Math.round(F * 1.1), Math.round(maxW * 1.08) || Math.round(F * 0.6)));
  const data = new Uint8Array(chars.length * cellW * cellH);
  for (let i = 0; i < chars.length; i++) {
    const b = boxes[i]; if (!b) continue;
    const c = i % cols, r = Math.floor(i / cols), x0 = Math.round((b.l + b.r) / 2 - cellW / 2), y0 = r * cellH;
    for (let y = 0; y < cellH; y++) for (let x = 0; x < cellW; x++) {
      const sx = x0 + x, sy = y0 + y;
      if (sx < c * cw0 || sx >= (c + 1) * cw0 || sy >= H) continue; // stay inside this glyph's slot
      const o = (sy * W + sx) * comps, L = 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];
      data[(i * cellH + y) * cellW + x] = 255 - L;
    }
  }
  const meta = { cellW, cellH, fontSize: F, chars };
  await saveCachedFontAtlas(key, meta, data);
  const a = Engine.prepareAtlas(meta, data); a.id = key;
  return a;
}

// Makes `atlas` match the chosen font and character set; renders the font first if needed.
async function readyAtlas() {
  if (!baseAtlas) return;
  const font = effectiveFont();
  if (!font) { atlas = baseAtlas; return; }
  const { chars, key } = fontKey();
  if (!fontAtlases.has(key)) {
    let a = await loadCachedFontAtlas(key);
    if (!a) {
      if (!fontBuild || fontBuild.key !== key) fontBuild = { key, promise: buildFontAtlas(font, chars, key) };
      try { a = await fontBuild.promise; }
      catch (e) { console.error(e); status(`Couldn't render ${S.fontName || font}: ${errMsg(e)}. Using the built-in font.`, true); atlas = baseAtlas; return; }
      finally { if (fontBuild && fontBuild.key === key) fontBuild = null; }
    }
    fontAtlases.set(key, a);
  }
  atlas = fontAtlases.get(key);
}

// ---------- preview ----------
let pvTimer = null, pvRunning = false, pvAgain = false;
function schedulePreview(delay) {
  saveJSON("gf:last", S);
  clearTimeout(pvTimer);
  pvTimer = setTimeout(runPreview, delay === undefined ? 40 : delay);
}
async function runPreview() {
  if (tab !== "ascii") return; // rendered again when the tab is shown
  if (pvRunning) { pvAgain = true; return; }
  pvRunning = true;
  try { await renderPreview(); } catch (e) { console.error(e); status(errMsg(e), true); }
  pvRunning = false;
  if (pvAgain) { pvAgain = false; schedulePreview(0); }
}
let viewer = null; // the preview (viewer.js)
function showPreviewMsg(t) { if (viewer) viewer.showMessage(t); else { $("previewMsg").textContent = t; } }

function docById(id) { try { const ds = app.documents; for (let i = 0; i < ds.length; i++) if (ds[i].id === id) return ds[i]; } catch (e) { /* none open */ } return null; }
// The document being converted: the active one, unless the live preview window is in front.
function sourceDoc() { const a = activeDoc(); if (live && a && a.id === live.docId) return docById(live.sourceDocId); return a; }
const qualityScale = () => Number($("quality").value) || 1;

// Temporary transparent 8-bit document (live preview, PNG export, smart-object render). Inside executeAsModal.
// The depth is explicit because new documents otherwise inherit whatever the user last picked.
async function createScratchDoc(W, H, res, name) {
  let d = null;
  try {
    d = await app.documents.add({ width: W, height: H, resolution: res, mode: "RGBColorMode", depth: 8, fill: "transparent", name });
    return { doc: d, layer: d.layers[0] };
  } catch (e) {
    d = d || (await app.documents.add({ width: W, height: H, resolution: res, mode: "RGBColorMode", depth: 8, fill: "white", name }));
    const bgLayer = d.layers[0], layer = await createLayer(d, "ASCII by Star");
    try { bgLayer.visible = false; } catch (e2) { /* background stays */ }
    return { doc: d, layer };
  }
}

// ---------- live smart object ----------
// "Open live smart object" places the result in the working document as a smart object and opens its
// contents (.psb) as the preview window. Edits are written into the .psb and saved, which updates the
// smart object in the working document. Closing saves and closes the .psb.
let liveTimer = null, liveRunning = false, liveAgain = false, liveSaveTimer = null;
function updateLiveBtn() {
  const b = $("liveBtn");
  b.textContent = live ? "Save & close live smart object" : "Open live smart object";
  b.classList.toggle("primary", !!live);
}
async function selectLayer(layer) {
  await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: layer.id }], makeVisible: false }], {});
}
async function toggleLive() {
  if (live) return closeLive();
  const doc = sourceDoc();
  try { checkDoc(doc); } catch (e) { return status(e.message, true); }
  await readyAtlas();
  busy = true;
  status("Opening live smart object…");
  try {
    await core.executeAsModal(async (ctx) => {
      const layerId = sourceLayerId(doc), frame = await frameOf(doc, layerId, artboardPick());
      let so = editing && editing.docId === doc.id ? findLayerById(doc, editing.layerId) : null;
      if (so && !/smart/i.test(String(so.kind))) so = null; // re-editing a pixel layer: make a new smart object
      if (!so) {
        src = await capture(ctx, doc, layerId, neededScale(frame), true, frame);
        const cs = currentCharset(), geo = Engine.computeGeometry(frame.w, frame.h, S, atlas), grid = Engine.computeGrid(src, geo, S, cs);
        const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "ASCII by Star smart object" });
        try { so = await placeSmartObject(doc, grid, cs, qualityScale(), outputName(doc, layerId), frame); }
        finally { await ctx.hostControl.resumeHistory(sid, true); }
      }
      rememberLayer(doc, so, layerId);
      await selectLayer(so);
      await action.batchPlay([{ _obj: "placedLayerEditContents" }], {});
      const psb = app.activeDocument;
      if (!psb || psb.id === doc.id) throw new Error("Photoshop didn't open the smart object contents");
      const inner = psb.layers.find ? psb.layers.find((l) => l.kind !== "group") || psb.layers[0] : psb.layers[0];
      live = { docId: psb.id, layerId: inner.id, sourceDocId: doc.id, soLayerId: so.id, soName: so.name, sourceLayerId: layerId, scale: psb.width / (src ? src.frame.w : doc.width) };
    }, { commandName: "ASCII by Star live smart object" });
  } catch (e) { console.error(e); live = null; status("Couldn't open the live smart object: " + errMsg(e), true); }
  finally { busy = false; }
  updateLiveBtn();
  if (live) { status(`Editing “${live.soName}” live (${live.scale.toFixed(0)}×). Zoom/pan with Photoshop's tools; Save & close when done.`); scheduleLive(0); }
}
async function saveLive(andClose) {
  if (!live) return;
  const d = docById(live.docId), lv = live;
  if (!d) { live = null; updateLiveBtn(); return; }
  busy = true;
  try {
    await core.executeAsModal(async () => { await d.save(); if (andClose) await d.closeWithoutSaving(); }, { commandName: "ASCII by Star save smart object" });
    const sd = docById(lv.sourceDocId), so = sd && findLayerById(sd, lv.soLayerId);
    if (sd && so) rememberLayer(sd, so, lv.sourceLayerId);
  } finally { busy = false; }
}
async function closeLive() {
  clearTimeout(liveTimer); clearTimeout(liveSaveTimer);
  const lv = live;
  while (liveRunning) await new Promise((r) => setTimeout(r, 50));
  try { await saveLive(true); status(`Saved into “${lv.soName}”.`); }
  catch (e) { console.error(e); status("Couldn't save the smart object: " + errMsg(e) + ". Save it with ⌘S.", true); }
  live = null; updateLiveBtn();
}
function scheduleLive(delay) { if (!live) return; clearTimeout(liveTimer); liveTimer = setTimeout(runLive, delay === undefined ? 300 : delay); }
async function runLive() {
  if (!live) return;
  if (liveRunning) { liveAgain = true; return; }
  liveRunning = true;
  try {
    const d = docById(live.docId), sd = docById(live.sourceDocId);
    if (!d || !sd) { live = null; updateLiveBtn(); return; }
    await readyAtlas();
    await ensureSource(true, sd);
    const cs = currentCharset(), geo = Engine.computeGeometry(src.docW, src.docH, S, atlas), grid = Engine.computeGrid(src, geo, S, cs);
    const lv = live;
    busy = true;
    await core.executeAsModal(async (ctx) => {
      let sid = null;
      try { sid = await ctx.hostControl.suspendHistory({ documentID: d.id, name: "Live update" }); } catch (e) { sid = null; }
      try { await writeLayer(d, findLayerById(d, lv.layerId) || d.layers[0], grid, cs, lv.scale, true); }
      finally { if (sid !== null) await ctx.hostControl.resumeHistory(sid, true); }
    }, { commandName: "ASCII by Star live update" });
    // saving pushes the change into the working document; do it once edits pause
    clearTimeout(liveSaveTimer);
    liveSaveTimer = setTimeout(() => { if (live && !liveRunning) saveLive(false).catch((e) => console.error(e)); }, 900);
  } catch (e) {
    console.error(e);
    if (/busy|modal/i.test(errMsg(e))) liveAgain = true; else status("Live update: " + errMsg(e), true);
  } finally { busy = false; liveRunning = false; }
  if (liveAgain) { liveAgain = false; scheduleLive(400); }
}

// Renders at `scale`x into a temporary document, converts it to a smart object, brings it into `doc`
// and scales it back to document size, so the smart object keeps the extra resolution. Inside executeAsModal.
async function placeSmartObject(doc, grid, cs, scale, name, frame) {
  frame = frame || fullFrame(doc);
  const W = Math.round(frame.w * scale), H = Math.round(frame.h * scale);
  const { doc: tmp, layer } = await createScratchDoc(W, H, (doc.resolution || 72) * scale, "ASCII by Star render");
  let placed = null;
  const tag = "ASCII by Star render " + Date.now().toString(36); // finds the copy even when duplicate() returns nothing
  try {
    await writeLayer(tmp, layer, grid, cs, scale, true);
    try { layer.selected = true; } catch (e) { /* only layer */ }
    await action.batchPlay([{ _obj: "newPlacedLayer" }], {});
    const so = tmp.activeLayers[0];
    so.name = tag;
    try { placed = await so.duplicate(doc); } catch (e) { console.error("duplicate", e); placed = null; }
    if (!placed) { // Photoshop sometimes returns nothing here; copy with the menu command instead
      try { await action.batchPlay([{ _obj: "duplicate", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _ref: "document", _id: doc.id }, version: 5 }], {}); } catch (e) { console.error("duplicate to", e); }
      placed = findLayers(doc.layers, (l) => l.name === tag)[0] || null;
    }
  } finally { await tmp.closeWithoutSaving(); }
  try { app.activeDocument = doc; } catch (e) { /* already active */ }
  if (!placed) throw new Error(`Photoshop couldn't copy the render into “${doc.title}”. If a smart object's contents (.psb) is the active document, switch to your main document and try again`);
  placed.name = name;
  // position first: at full size the corner pixels pin the bounds to the frame exactly, while scaling down
  // averages them away and the bounds shrink to the characters. Scaling from the top left keeps the corner.
  const b = placed.bounds;
  if (Math.round(b.left) !== frame.x || Math.round(b.top) !== frame.y) await placed.translate(frame.x - b.left, frame.y - b.top);
  if (scale !== 1) await placed.scale(100 / scale, 100 / scale, constants.AnchorPosition.TOPLEFT);
  return placed;
}

async function renderPreview() {
  if (!atlas) return;
  await readyAtlas();
  const ok = await ensureSource(false);
  if (!ok) { showPreviewMsg("Open a document to begin"); status(""); return; }
  await fillArtboardSelect($("artboard"), $("artboardRow"), sourceDoc());
  // the character grid is reused while settings and source are unchanged
  const key = atlas.id + JSON.stringify(S);
  if (gridCache.key !== key || gridCache.src !== src) {
    const cs = currentCharset(), geo = Engine.computeGeometry(src.docW, src.docH, S, atlas);
    gridCache = { key, src, cs, geo, grid: Engine.computeGrid(src, geo, S, cs) };
  }
  const { cs, geo, grid } = gridCache;
  const fk = [src.docId, src.frame.x, src.frame.y, src.frame.w, src.frame.h].join(",");
  if (viewer.frameKey !== fk) { viewer.frameKey = fk; viewer.setCentre(src.docW / 2, src.docH / 2); } // a new document or artboard
  await viewer.refresh();
  const lowRes = src.scale < neededScale(src.frame) - 1e-6;
  scheduleLive();
  const hid = grid.hidden ? ` · ${grid.hiddenPlaced} hidden message${grid.hiddenPlaced === 1 ? "" : "s"}` : "";
  if (!live) status(`${geo.cols} × ${geo.rows} chars · ${geo.size.toFixed(1)}px · ${cs.n} glyphs${hid}${lowRes ? " · preview sampled at reduced res" : ""}`);
}

// The preview of document rect `rect` at scale z, as RGB (characters over a checkerboard where transparent).
function renderRegion(rect, z) {
  const { cs, grid } = gridCache;
  if (!grid) return null;
  const w = Math.max(1, Math.round(rect.w * z)), h = Math.max(1, Math.round(rect.h * z));
  const s = markHidden ? Object.assign({}, S, { _markHidden: true }) : S;
  return { rgb: Engine.flattenForPreview(Engine.render(grid, cs, atlas, s, { x: rect.x, y: rect.y, w, h, scale: z }), w, h), w, h };
}

function makeViewer() {
  return createViewer({
    wrap: $("previewWrap"), img: $("preview"), msg: $("previewMsg"), bar: $("zoomBar"), grip: $("previewGrip"), storeKey: "gf:zoom:ascii", onLayout: () => fitLayout(true),
    docSize: () => (src ? { w: src.docW, h: src.docH } : null), render: renderRegion,
    onError: (e) => { console.error(e); status(errMsg(e), true); },
  });
}

// ---------- actions ----------
// "<layer it was made from> ASCII by Star"
function outputName(doc, layerId) {
  let base = "";
  try { const l = layerId != null ? findLayerById(doc, layerId) : doc.activeLayers && doc.activeLayers[0]; if (l) base = String(l.name); } catch (e) { base = ""; }
  base = base.replace(OUR_RE, "").trim();
  return `${base || docBaseName(doc)} ASCII by Star`;
}
const layerKey = (doc, id) => `gf:layer:${doc.title}:${id}`;
function rememberLayer(doc, layer, sourceLayer) {
  const rec = { settings: S, source: $("source").value, sourceLayerId: sourceLayer };
  saveJSON(layerKey(doc, layer.id), rec);
  saveJSON("gf:layerName:" + layer.name, rec);
}
function recallLayer(doc, layer) {
  const t = String(layer.name).match(TAG_RE);
  return loadJSON(layerKey(doc, layer.id), null) || loadJSON("gf:layerName:" + layer.name, null) || (t ? loadJSON("gf:layer:" + t[1], null) : null);
}

async function applyRaster(update) {
  const doc = sourceDoc();
  try { checkDoc(doc); } catch (e) { return status(e.message, true); }
  if (update && (!editing || editing.docId !== doc.id)) return status("The edited layer is in another document. Switch back to it.", true);
  await readyAtlas();
  busy = true;
  status("Rendering…");
  const t0 = Date.now();
  try {
    let info = null;
    await core.executeAsModal(async (ctx) => {
      const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: update ? "ASCII by Star update" : "ASCII by Star" });
      try {
        const layerId = sourceLayerId(doc), frame = await frameOf(doc, layerId, artboardPick());
        src = await capture(ctx, doc, layerId, neededScale(frame), false, frame);
        const cs = currentCharset();
        const geo = Engine.computeGeometry(frame.w, frame.h, S, atlas);
        const grid = Engine.computeGrid(src, geo, S, cs);
        const q = qualityScale();
        let layer = null;
        const old = update ? findLayerById(doc, editing.layerId) : null;
        if (update && !old) throw new Error("The layer being edited no longer exists.");
        const name = update ? old.name : outputName(doc, layerId);
        const oldIsSmart = old && /smart/i.test(String(old.kind));
        if (q > 1 || oldIsSmart) {
          try {
            layer = await placeSmartObject(doc, grid, cs, Math.max(1, q), name, frame);
            if (old) { await layer.move(old, constants.ElementPlacement.PLACEBEFORE); await old.delete(); editing.layerId = layer.id; }
            info = `${geo.cols} × ${geo.rows} chars · ${q}× smart object`;
          } catch (e) {
            console.error(e);
            layer = null;
            info = `smart object failed (${errMsg(e)}), made a pixel layer instead`;
          }
        }
        if (!layer) {
          layer = old || (await createLayer(doc, name));
          await writeLayer(doc, layer, grid, cs, 1, false, frame);
          if (!info) info = `${geo.cols} × ${geo.rows} chars`;
        }
        rememberLayer(doc, layer, layerId);
      } finally {
        await ctx.hostControl.resumeHistory(sid, true);
      }
    }, { commandName: "ASCII by Star" });
    status(`${update ? "Updated" : "Created"} layer · ${info} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error(e); status(errMsg(e), true);
  } finally { busy = false; }
}

async function outputGrid() {
  await readyAtlas();
  const doc = sourceDoc();
  checkDoc(doc);
  await ensureSource(true);
  const cs = currentCharset();
  const geo = Engine.computeGeometry(src.docW, src.docH, S, atlas);
  return { doc, cs, geo, grid: Engine.computeGrid(src, geo, S, cs) };
}

async function makeTextLayer() {
  try {
    const { doc, cs, geo, grid } = await outputGrid();
    const lines = Engine.gridLines(grid, cs);
    const total = geo.cols * geo.rows;
    if (total > 400000) return status(`That is ${total.toLocaleString()} characters — too many for a text layer. Increase the font size.`, true);
    busy = true;
    status("Creating text layer…");
    await core.executeAsModal(async (ctx) => {
      const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "ASCII by Star text" });
      try {
        // the UXP text API measures type in pixels (72 ppi based), so document pixels map 1:1
        const color = new app.SolidColor();
        color.rgb.hexValue = S.fg.replace("#", "").toUpperCase();
        const baseline = (geo.cellH - geo.glyphH) / 2 + geo.glyphH * 0.79;
        const layer = await doc.createTextLayer({
          contents: lines.join("\r"),
          fontSize: geo.size,
          fontName: S.font || MONO_FONT,
          textColor: color,
          position: { x: src.frame.x + (geo.cellW - geo.glyphW) / 2, y: src.frame.y + baseline },
        });
        try { layer.name = outputName(doc, sourceLayerId(doc)); } catch (e) { /* keep default name */ }
        const st = layer.textItem && layer.textItem.characterStyle;
        if (st) {
          try { st.useAutoLeading = false; } catch (e) { /* older API */ }
          try { st.leading = geo.cellH; } catch (e) { /* older API */ }
          try { st.tracking = Math.round(((geo.cellW - geo.glyphW) / geo.size) * 1000); } catch (e) { /* older API */ }
        }
      } finally { await ctx.hostControl.resumeHistory(sid, true); }
    }, { commandName: "ASCII by Star text" });
    status(`Text layer created · ${geo.cols} × ${geo.rows} chars`);
  } catch (e) { console.error(e); status(errMsg(e), true); } finally { busy = false; }
}

async function exportFile(kind) {
  try {
    const { doc, cs, grid } = await outputGrid();
    const text = kind === "txt" ? Engine.toText(grid, cs) : kind === "html" ? Engine.toHTML(grid, cs, S) : Engine.toSVG(grid, cs, S);
    const file = await lfs.getFileForSaving(`${docBaseName(doc)}-ascii.${kind}`, { types: [kind] });
    if (!file) return;
    await file.write(text, { format: formats.utf8 });
    status(`Saved ${file.name}`);
  } catch (e) { console.error(e); status(errMsg(e), true); }
}

async function exportPNG() {
  try {
    const { doc, cs, geo, grid } = await outputGrid();
    const scale = Number($("pngScale").value) || 1;
    const W = Math.round(geo.docW * scale), H = Math.round(geo.docH * scale);
    if (Math.max(W, H) > 30000) return status(`${W} × ${H} px is too large for Photoshop. Pick a smaller PNG scale.`, true);
    const file = await lfs.getFileForSaving(`${docBaseName(doc)}-ascii${scale > 1 ? "@" + scale + "x" : ""}.png`, { types: ["png"] });
    if (!file) return;
    busy = true;
    status(`Saving ${W} × ${H} PNG…`);
    const t0 = Date.now();
    await core.executeAsModal(async () => {
      // render into a temporary transparent document, save it as PNG, then close it
      const { doc: tmp, layer } = await createScratchDoc(W, H, (doc.resolution || 72) * scale, "ASCII by Star export");
      try {
        await writeLayer(tmp, layer, grid, cs, scale);
        await tmp.saveAs.png(file, { compression: 6 }, true);
      } finally {
        await tmp.closeWithoutSaving();
      }
    }, { commandName: "ASCII by Star PNG export" });
    status(`Saved ${file.name} · ${W} × ${H} px · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) { console.error(e); status(errMsg(e), true); } finally { busy = false; }
}

async function copyText() {
  try {
    const { cs, grid } = await outputGrid();
    await navigator.clipboard.setContent({ "text/plain": Engine.toText(grid, cs) });
    status("Copied to clipboard");
  } catch (e) { console.error(e); status(errMsg(e), true); }
}

function loadSelectedLayer() {
  const doc = sourceDoc();
  const l = doc && doc.activeLayers && doc.activeLayers[0];
  if (!l || !OUR_RE.test(String(l.name))) return status("Select a layer made by ASCII by Star (its name ends in “ASCII by Star”).", true);
  const rec = recallLayer(doc, l);
  if (!rec) return status("No saved settings for this layer on this computer.", true);
  S = freshSettings(rec.settings);
  setSelect($("source"), rec.source || "merged");
  editing = { docId: doc.id, layerId: l.id, name: l.name, sourceLayerId: rec.sourceLayerId == null ? null : rec.sourceLayerId };
  src = null;
  syncUI();
  $("editLabel").textContent = "Editing: " + l.name;
  $("editBox").classList.remove("hidden");
  fitLayout(true);
  schedulePreview(0);
}
function stopEditing() { editing = null; $("editBox").classList.add("hidden"); fitLayout(true); src = null; schedulePreview(0); }

async function runBatch() {
  try {
    status("Choose the folder with images…");
    const inF = await lfs.getFolder();
    if (!inF) return status("");
    status("Choose an output folder…");
    const outF = await lfs.getFolder();
    if (!outF) return status("");
    const files = (await inF.getEntries()).filter((e) => e.isFile && /\.(jpe?g|png|tiff?|psd|psb|webp|bmp|gif|heic)$/i.test(e.name));
    if (!files.length) return status("No images found in that folder.", true);
    await readyAtlas();
    const cs = currentCharset(), alsoTxt = $("batchTxt").checked;
    let done = 0, failed = 0;
    busy = true;
    for (const f of files) {
      status(`Batch ${done + failed + 1}/${files.length}: ${f.name}`);
      try {
        await core.executeAsModal(async (ctx) => {
          const d = await app.open(f);
          try {
            if (!/rgb|gray/i.test(String(d.mode))) await d.changeMode(constants.ChangeMode.RGB);
            const sample = await capture(ctx, d, null, neededScale(fullFrame(d)), false);
            const geo = Engine.computeGeometry(d.width, d.height, S, atlas);
            const grid = Engine.computeGrid(sample, geo, S, cs);
            const layer = await createLayer(d, "ASCII by Star");
            await writeLayer(d, layer, grid, cs);
            if (S.bgMode === "transparent") for (const l of d.layers) if (l.id !== layer.id) l.visible = false;
            const base = f.name.replace(/\.[^.]+$/, "");
            const out = await outF.createFile(base + "-ascii.png", { overwrite: true });
            await d.saveAs.png(out, { compression: 6 }, true);
            if (alsoTxt) { const t = await outF.createFile(base + "-ascii.txt", { overwrite: true }); await t.write(Engine.toText(grid, cs), { format: formats.utf8 }); }
          } finally { await d.closeWithoutSaving(); }
        }, { commandName: "ASCII by Star batch" });
        done++;
      } catch (e) { console.error(f.name, e); failed++; }
    }
    status(`Batch finished: ${done} saved${failed ? `, ${failed} failed` : ""}.`, failed > 0);
  } catch (e) { console.error(e); status(errMsg(e), true); } finally { busy = false; src = null; }
}

// ---------- presets ----------
function buildPresetSelect(selected) {
  const el = $("preset");
  let html = '<option value="" disabled>— Built-in looks —</option>';
  for (const p of PRESETS) html += `<option value="b:${p.id}">${p.name}</option>`;
  if (userPresets.length) {
    html += '<option value="" disabled>— My presets —</option>';
    userPresets.forEach((p, i) => { html += `<option value="u:${i}">${p.name.replace(/</g, "&lt;")}</option>`; });
  }
  el.innerHTML = html;
  setSelect(el, selected || "b:" + PRESETS[0].id);
}
function applyPreset(v) {
  let p = null;
  if (v.startsWith("b:")) p = PRESETS.find((x) => x.id === v.slice(2));
  else if (v.startsWith("u:")) p = userPresets[Number(v.slice(2))];
  if (!p) return;
  S = freshSettings(p.settings);
  syncUI();
  schedulePreview(0);
}
function savePreset() {
  const name = $("presetName").value.trim();
  if (!name) return status("Type a preset name first.", true);
  const i = userPresets.findIndex((p) => p.name === name);
  const rec = { name, settings: JSON.parse(JSON.stringify(S)) };
  if (i >= 0) userPresets[i] = rec; else userPresets.push(rec);
  saveJSON("gf:userPresets", userPresets);
  buildPresetSelect("u:" + (i >= 0 ? i : userPresets.length - 1));
  status(`Saved preset “${name}”`);
}
function deletePreset() {
  const v = $("preset").value;
  if (!v.startsWith("u:")) return status("Built-in looks can’t be deleted.", true);
  const [p] = userPresets.splice(Number(v.slice(2)), 1);
  saveJSON("gf:userPresets", userPresets);
  buildPresetSelect();
  status(`Deleted “${p.name}”`);
}
async function exportPresets() {
  try {
    const f = await lfs.getFileForSaving("ascii-by-star-presets.json", { types: ["json"] });
    if (!f) return;
    await f.write(JSON.stringify({ asciiByStar: 1, presets: userPresets.length ? userPresets : [{ name: "Current", settings: S }] }, null, 2), { format: formats.utf8 });
    status(`Saved ${f.name}`);
  } catch (e) { status(errMsg(e), true); }
}
async function importPresets() {
  try {
    const f = await lfs.getFileForOpening({ types: ["json"] });
    if (!f) return;
    const data = JSON.parse(await f.read({ format: formats.utf8 }));
    const list = (data && data.presets) || [];
    let n = 0;
    for (const p of list) if (p && p.name && p.settings) { userPresets.push({ name: String(p.name), settings: freshSettings(p.settings) }); n++; }
    saveJSON("gf:userPresets", userPresets);
    buildPresetSelect();
    status(`Imported ${n} preset${n === 1 ? "" : "s"}`);
  } catch (e) { status("Couldn’t import: " + errMsg(e), true); }
}

// ---------- UI ----------
const pct = (v) => Math.round(v * 100) + "%";
const SLIDERS = {
  detail: ["Shape match", 0, 1, 0.01, pct],
  size: ["Font size", 2, 120, 0.5, (v) => v + "px"],
  columns: ["Columns", 10, 600, 1, (v) => String(v)],
  spacingX: ["H spacing", 0.5, 3, 0.01, (v) => v.toFixed(2)],
  lineHeight: ["Line height", 0.5, 3, 0.01, (v) => v.toFixed(2)],
  contrast: ["Contrast", 0, 3, 0.01, (v) => v.toFixed(2)],
  brightness: ["Brightness", -1, 1, 0.01, (v) => (v > 0 ? "+" : "") + Math.round(v * 100)],
  gamma: ["Gamma", 0.2, 3, 0.01, (v) => v.toFixed(2)],
  threshold: ["Threshold", 0, 1, 0.01, pct],
  ditherStrength: ["Dither amount", 0, 1.5, 0.01, pct],
  saturation: ["Saturation", 0, 3, 0.01, pct],
  colorBoost: ["Lift darks", 0, 1, 0.01, pct],
  glyphOpacity: ["Text opacity", 0, 1, 0.01, pct],
  mosaicAmount: ["Mosaic", 0, 1, 0.01, pct],
  bgOpacity: ["Opacity", 0, 1, 0.01, pct],
  gPixelSort: ["Pixel sort", 0, 1, 0.01, pct],
  gSlices: ["Slice shift", 0, 1, 0.01, pct],
  gSliceSize: ["Slice height", 0.05, 1, 0.01, pct],
  gBlocks: ["Datamosh", 0, 1, 0.01, pct],
  gBlockSize: ["Block size", 0, 1, 0.01, pct],
  gWave: ["Wave", 0, 1, 0.01, pct],
  gWaveFreq: ["Wave freq", 1, 40, 0.5, (v) => v.toFixed(1)],
  gMelt: ["Melt", 0, 1, 0.01, pct],
  gBitCrush: ["Bit crush", 0, 1, 0.01, pct],
  gCorrupt: ["Corrupt", 0, 1, 0.01, pct],
  gRowShift: ["Row shift", 0, 1, 0.01, pct],
  gStutter: ["Stutter", 0, 1, 0.01, pct],
  gRgbSplit: ["RGB split", 0, 1, 0.01, pct],
  gInterlace: ["Interlace", 0, 1, 0.01, pct],
  gTracking: ["VHS tracking", 0, 1, 0.01, pct],
  gScanlines: ["Scanlines", 0, 1, 0.01, pct],
  gNoise: ["Noise", 0, 1, 0.01, pct],
  shadowAngle: ["Light angle", -180, 180, 1, (v) => Math.round(v) + "°"],
  dropOpacity: ["Opacity", 0, 1, 0.01, pct],
  dropDistance: ["Distance", 0, 1, 0.01, pct],
  dropSize: ["Softness", 0, 1.5, 0.01, pct],
  longOpacity: ["Opacity", 0, 1, 0.01, pct],
  longLength: ["Length", 0.1, 6, 0.05, pct],
  longFade: ["Fade out", 0, 1, 0.01, pct],
  offOpacity: ["Opacity", 0, 1, 0.01, pct],
  offDistance: ["Distance", 0, 1, 0.01, pct],
  glowOpacity: ["Strength", 0, 1, 0.01, pct],
  glowSize: ["Size", 0.05, 2, 0.01, pct],
  outlineLevel: ["Shape at", 0.05, 0.95, 0.01, pct],
  outlineWidth: ["Width", 1, 6, 1, (v) => String(v)],
  fillLevel: ["Fill from", 0.05, 0.95, 0.01, pct],
  rainLength: ["Length", 1, 60, 1, (v) => v + " ch"],
  rainLengthVar: ["Length spread", 0, 1, 0.01, pct],
  rainAmount: ["Amount", 0, 1, 0.01, pct],
  rainDistance: ["Fall distance", 1, 200, 1, (v) => v + " ch"],
  rainOutside: ["Off the shape", 0, 1, 0.01, pct],
  rainFade: ["Tail fade", 0, 1, 0.01, pct],
  rainGaps: ["Gaps", 0, 1, 0.01, pct],
  rainAngle: ["Angle", -60, 60, 1, (v) => Math.round(v) + "°"],
};
const RAIN_HINTS = {
  object: "Streams drip from the shape's lower edges into empty space (cells without a character). Fall distance: how far the lowest ones get. Raise Tone ▸ Threshold to empty more of the background.",
  everywhere: "Rain falls over the whole image. Where it crosses the shape it is at full strength (and, with The shape's colours, takes on its colour); Off the shape sets its strength elsewhere.",
};
const GLITCH_KEYS = Object.keys(Engine.DEFAULTS).filter((k) => /^g[A-Z]/.test(k));

function glitchRecipe() {
  const r = Math.random, pick = (p, max) => (r() < p ? Math.round(r() * max * 100) / 100 : 0);
  for (const k of GLITCH_KEYS) S[k] = Engine.DEFAULTS[k];
  Object.assign(S, {
    glitchOn: true, glitchSeed: Math.floor(r() * 99999) + 1,
    gPixelSort: pick(0.4, 0.6), gSortDir: r() < 0.5 ? "h" : "v", gSlices: pick(0.6, 0.6), gSliceSize: 0.2 + r() * 0.6,
    gBlocks: pick(0.4, 0.5), gBlockSize: r(), gWave: pick(0.2, 0.2), gWaveFreq: 2 + Math.round(r() * 20),
    gMelt: pick(0.2, 0.5), gBitCrush: pick(0.25, 0.7), gChannelSwap: r() < 0.2 ? ["rbg", "grb", "gbr", "brg", "bgr"][Math.floor(r() * 5)] : "none",
    gCorrupt: pick(0.5, 0.4), gRowShift: pick(0.5, 0.5), gStutter: pick(0.3, 0.4),
    gRgbSplit: pick(0.6, 0.5), gInterlace: pick(0.25, 0.4), gTracking: pick(0.4, 0.6), gScanlines: pick(0.5, 0.6), gNoise: pick(0.4, 0.3),
  });
}
function randomGlitch() { glitchRecipe(); syncUI(); schedulePreview(0); }

// ---------- randomize ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
const round2 = (v) => Math.round(v * 100) / 100;
function hslHex(h, s, l) { // h in turns
  const f = (n) => { const k = (n + (((h % 1) + 1) % 1) * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return Engine.rgbToHex(f(0), f(8), f(4));
}
function mixHex(a, b, t) { const x = Engine.hexToRgb(a), y = Engine.hexToRgb(b); return Engine.rgbToHex(...x.map((v, i) => Math.round(v + (y[i] - v) * t))); }

// A random look. The font, custom text and size mode stay, a custom charset stays custom, and the size varies
// around the one set before the first of a run of clicks (so it doesn't drift).
let undoStack = [], lastRandom = null, sizeBase = null;
function randomizeAll() {
  const now = JSON.stringify(S);
  if (now !== lastRandom) sizeBase = { size: S.size, columns: S.columns };
  undoStack.push(now);
  if (undoStack.length > 30) undoStack.shift();
  const info = S.charset === "custom" ? charsetInfo() : pickOne(CHARSETS.filter((c) => c.id !== "custom"));
  const dark = chance(0.65), h = Math.random(), h2 = h + rnd(0.3, 0.7);
  const bg = dark ? hslHex(h, rnd(0.2, 0.7), rnd(0.03, 0.1)) : hslHex(h, rnd(0.15, 0.5), rnd(0.88, 0.96));
  const fg = dark ? hslHex(h2, rnd(0.5, 1), rnd(0.65, 0.9)) : hslHex(h2, rnd(0.4, 0.9), rnd(0.1, 0.28));
  const accent = hslHex(h2 + 0.5, rnd(0.7, 1), rnd(0.45, 0.6));
  const scale = Math.pow(2, rnd(-0.6, 0.6));
  const dithers = Array.from($("dither").options).map((o) => o.value).filter((v) => v && v !== "none");
  Object.assign(S, {
    charset: info.id,
    size: Math.min(60, Math.max(4, Math.round(sizeBase.size * scale * 2) / 2)), columns: Math.min(400, Math.max(20, Math.round(sizeBase.columns / scale))),
    spacingX: chance(0.7) ? 1 : round2(rnd(0.8, 1.5)), lineHeight: chance(0.7) ? 1 : round2(rnd(0.8, 1.5)),
    contrast: round2(rnd(0.85, 1.6)), brightness: round2(rnd(-0.12, 0.12)), gamma: round2(rnd(0.7, 1.5)), threshold: chance(0.7) ? 0 : round2(rnd(0.02, 0.2)),
    invert: chance(0.12), dither: chance(0.35) ? pickOne(dithers) : "none", ditherStrength: round2(rnd(0.6, 1)), serpentine: chance(0.5),
    detail: info.shape ? round2(rnd(0.4, 0.9)) : chance(0.25) ? round2(rnd(0.2, 0.6)) : 0,
    colorMode: pickOne(["mono", "mono", "original", "gradient", "gradient"]), fg, bg, gradientMid: chance(0.8),
    gradient: [mixHex(bg, fg, 0.18), hslHex(Math.random(), rnd(0.7, 1), rnd(0.45, 0.6)), mixHex(fg, dark ? "#ffffff" : "#000000", 0.3)],
    saturation: round2(rnd(0.9, 1.6)), colorBoost: round2(rnd(0, 0.6)), glyphOpacity: chance(0.8) ? 1 : round2(rnd(0.6, 1)),
    bgMode: pickOne(["solid", "solid", "solid", "solid", "mosaic", "transparent"]), mosaicAmount: round2(rnd(0.2, 0.6)), bgOpacity: 1,
    shadowAngle: pickOne([135, 120, 90, 45, -45]),
    dropOn: chance(0.12), dropColor: dark ? mixHex(bg, fg, 0.4) : "#000000", dropOpacity: round2(rnd(0.5, 0.9)), dropDistance: round2(rnd(0.1, 0.3)), dropSize: round2(rnd(0.15, 0.5)),
    longOn: chance(0.1), longColor: mixHex(bg, fg, 0.3), longOpacity: round2(rnd(0.6, 0.9)), longLength: round2(rnd(0.8, 2.5)), longFade: round2(rnd(0.3, 1)),
    offOn: chance(0.12), offColor: accent, offOpacity: round2(rnd(0.7, 1)), offDistance: round2(rnd(0.08, 0.2)),
    glowOn: dark && chance(0.12), glowTextColor: chance(0.7), glowColor: accent, glowOpacity: round2(rnd(0.5, 0.9)), glowSize: round2(rnd(0.3, 0.7)),
  });
  if (S.outlineOn) Object.assign(S, { outlineWidth: pickOne([1, 1, 2, 3]), outlinePos: pickOne(["outside", "center", "inside"]), outlineStyle: chance(0.6) ? "lines" : "chars", outlineColor: accent, outlineFill: pickOne(["image", "none", "chars", "random"]) });
  if (chance(0.12)) glitchRecipe(); else S.glitchOn = false;
  lastRandom = JSON.stringify(S);
  syncUI(); schedulePreview(0);
  status("Random look. ↶ goes back; save it under Look to keep it.");
}
function undoRandomize() {
  if (!undoStack.length) return;
  S = freshSettings(JSON.parse(undoStack.pop()));
  syncUI(); schedulePreview(0);
}

// A black shadow on a near-black background doesn't show, so a shadow switched on with a colour that close to
// the background starts from a mix of the text and background colours instead.
const SHADOW_COLORS = { dropOn: "dropColor", longOn: "longColor", offOn: "offColor" };
function visibleShadow(key) {
  const k = SHADOW_COLORS[key], old = S[k];
  if (!k || S.bgMode === "transparent" || Math.abs(Engine.luma(Engine.hexToRgb(old)) - Engine.luma(Engine.hexToRgb(S.bg))) > 0.15) return;
  S[k] = mixHex(S.bg, S.fg, 0.45);
  syncUI();
  status(`Shadow colour set to ${S[k]}: ${old} doesn't show on this background.`);
}
const sliderEls = {};
// controls whose id is the setting they edit
const SELECTS = ["charset", "textMode", "sizeMode", "dither", "colorMode", "bgMode", "gSortDir", "gChannelSwap", "outlinePos", "outlineStyle", "outlineFill", "rainFrom", "rainCharset", "rainColorMode"];
const CHECKS = ["sortByDensity", "invert", "serpentine", "glitchOn", "gradientMid", "keepAlpha", "phraseShade", "phraseWrap", "dropOn", "longOn", "offOn", "glowOn", "glowTextColor", "outlineOn", "rainOn", "rainHead", "rainGradientMid"];
const TEXTS = ["customChars", "outlineChars", "outlineFillChars", "rainChars"];
let markHidden = loadJSON("gf:markHidden", false); // preview only: show where hidden messages went

function buildUI() {
  for (const [key, [label, min, max, step, fmt]] of Object.entries(SLIDERS)) {
    const host = $("sl-" + key);
    host.innerHTML = `<div class="row"><span class="label" title="Double-click to reset">${label}</span>${SLIDER_HTML}<span class="val"></span></div>`;
    const val = host.querySelector(".val");
    const input = makeSlider(host.querySelector(".slider"), min, max, step, (v) => { S[key] = v; val.textContent = fmt(v); schedulePreview(); });
    host.querySelector(".label").addEventListener("dblclick", () => { S[key] = Engine.DEFAULTS[key]; syncUI(); schedulePreview(); });
    sliderEls[key] = { input, val, fmt, row: host };
  }
  let html = "", group = null;
  for (const c of CHARSETS) {
    if (c.group !== group) { group = c.group; html += `<option value="" disabled>— ${group} —</option>`; }
    html += `<option value="${c.id}">${c.name}</option>`;
  }
  $("charset").innerHTML = html;
  $("rainCharset").innerHTML = html; // the rain picks from the same character sets

  for (const k of SELECTS) $(k).addEventListener("change", () => { S[k] = $(k).value; refreshVisibility(); schedulePreview(); });
  $("glitchSeed").addEventListener("change", () => { const v = parseInt($("glitchSeed").value, 10); if (v > 0) S.glitchSeed = v; syncUI(); schedulePreview(0); });
  $("glitchReseed").addEventListener("click", () => { S.glitchSeed = Math.floor(Math.random() * 99999) + 1; syncUI(); schedulePreview(0); });
  $("glitchReset").addEventListener("click", () => { for (const k of GLITCH_KEYS) S[k] = Engine.DEFAULTS[k]; syncUI(); schedulePreview(0); });
  $("glitchRandom").addEventListener("click", randomGlitch);
  $("rainSeed").addEventListener("change", () => { const v = parseInt($("rainSeed").value, 10); if (v > 0) S.rainSeed = v; syncUI(); schedulePreview(0); });
  $("rainReseed").addEventListener("click", () => { S.rainSeed = Math.floor(Math.random() * 99999) + 1; syncUI(); schedulePreview(0); });
  $("fillShuffle").addEventListener("click", () => { S.fillSeed = Math.floor(Math.random() * 99999) + 1; schedulePreview(0); });
  for (const k of CHECKS) onCheck($(k), (v) => { S[k] = v; if (v) visibleShadow(k); refreshVisibility(); schedulePreview(); });
  for (const k of TEXTS) $(k).addEventListener("input", () => { S[k] = $(k).value; refreshVisibility(); schedulePreview(120); });
  $("hideMark").checked = markHidden;
  onCheck($("hideMark"), (v) => { markHidden = v; saveJSON("gf:markHidden", v); schedulePreview(0); });
  $("hideMove").addEventListener("click", () => { S.hideSeed = Math.floor(Math.random() * 99999) + 1; schedulePreview(0); });
  $("randomize").addEventListener("click", randomizeAll);
  $("undoRandom").addEventListener("click", undoRandomize);

  document.querySelectorAll(".swatch").forEach((el) => el.addEventListener("click", () => pickColor(el.dataset.color)));
  document.querySelectorAll(".hex").forEach((el) => el.addEventListener("change", () => {
    const v = el.value.trim().replace(/^#?/, "#");
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) setColor(el.dataset.hex, Engine.rgbToHex(...Engine.hexToRgb(v)));
    else syncUI();
  }));
  $("useFg").addEventListener("click", () => { try { setColor("fg", "#" + app.foregroundColor.rgb.hexValue.toLowerCase()); } catch (e) { status(errMsg(e), true); } });
  $("useBg").addEventListener("click", () => { try { setColor("bg", "#" + app.backgroundColor.rgb.hexValue.toLowerCase()); } catch (e) { status(errMsg(e), true); } });

  $("source").addEventListener("change", () => { src = null; schedulePreview(0); });
  $("artboard").addEventListener("change", () => { src = null; schedulePreview(0); });
  $("refresh").addEventListener("click", () => { src = null; csCache.key = null; schedulePreview(0); });
  $("liveBtn").addEventListener("click", toggleLive);
  $("resetAll").addEventListener("click", () => {
    S = freshSettings(); editing = null; $("editBox").classList.add("hidden");
    $("fontSearch").value = ""; fillFontSelect(); syncUI(); buildPresetSelect(); fitLayout(true);
    status("All settings reset to defaults"); schedulePreview(0);
  });
  $("fontPicker").addEventListener("click", () => openFontPanel(!fontOpen));
  $("fontList").addEventListener("scroll", checkFontScroll);
  setInterval(checkFontScroll, 200); // UXP may not fire scroll events
  $("fontList").addEventListener("click", (e) => {
    let n = e.target;
    if (n && n.className === "fontMore") return appendFonts();
    while (n && n !== $("fontList") && !(n.getAttribute && n.getAttribute("data-ps") !== null)) n = n.parentNode;
    if (!n || n === $("fontList")) return;
    const v = n.getAttribute("data-ps"), f = allFonts.find((x) => x.ps === v);
    setFont(v, f ? f.name : v);
  });
  const refilter = () => { clearTimeout(fontFilterTimer); fontFilterTimer = setTimeout(fillFontSelect, 60); };
  $("fontSearch").addEventListener("input", refilter);
  $("fontSearch").addEventListener("keyup", refilter);
  $("fontFromLayer").addEventListener("click", () => {
    try {
      const doc = sourceDoc(), l = doc && doc.activeLayers && doc.activeLayers[0];
      const font = l && l.textItem && l.textItem.characterStyle && l.textItem.characterStyle.font;
      if (!font) return status("Select a text layer first, then click From text layer.", true);
      const f = allFonts.find((x) => x.ps === font || x.name === font);
      setFont(f ? f.ps : font, f ? f.name : font);
      status(`Font set to ${f ? f.name : font}`);
    } catch (e) { status("Select a text layer first, then click From text layer.", true); }
  });
  setSelect($("quality"), loadJSON("gf:quality", "1"));
  $("quality").addEventListener("change", async () => {
    saveJSON("gf:quality", $("quality").value);
  });

  $("apply").addEventListener("click", () => applyRaster(false));
  $("updateLayer").addEventListener("click", () => applyRaster(true));
  $("stopEdit").addEventListener("click", stopEditing);
  $("loadLayer").addEventListener("click", loadSelectedLayer);
  $("textLayer").addEventListener("click", makeTextLayer);
  $("exportTxt").addEventListener("click", () => exportFile("txt"));
  $("exportHtml").addEventListener("click", () => exportFile("html"));
  $("exportSvg").addEventListener("click", () => exportFile("svg"));
  $("copyText").addEventListener("click", copyText);
  $("exportPng").addEventListener("click", exportPNG);
  $("pngScale").addEventListener("change", () => saveJSON("gf:pngScale", $("pngScale").value));
  setSelect($("pngScale"), loadJSON("gf:pngScale", "1"));
  $("batch").addEventListener("click", runBatch);

  $("preset").addEventListener("change", () => applyPreset($("preset").value));
  $("resetBtn").addEventListener("click", () => applyPreset($("preset").value));
  $("savePreset").addEventListener("click", savePreset);
  $("deletePreset").addEventListener("click", deletePreset);
  $("exportPresets").addEventListener("click", exportPresets);
  $("importPresets").addEventListener("click", importPresets);

  const collapsed = loadJSON("gf:collapsed", { batch: true }), bands = new Map();
  document.querySelectorAll(".section").forEach((sec) => {
    const k = sec.dataset.section, n = bands.get(sec.parentNode) || 0;
    bands.set(sec.parentNode, n + 1);
    if (n % 2) sec.classList.add("alt"); // light and dark bands alternate within each tab
    const apply = () => { sec.classList.toggle("collapsed", !!collapsed[k]); sec.querySelector(".chev").textContent = collapsed[k] ? "▸" : "▾"; };
    sec.querySelector(".head").addEventListener("click", () => { collapsed[k] = !collapsed[k]; saveJSON("gf:collapsed", collapsed); apply(); });
    apply();
  });
  buildPresetSelect();
}

// colour keys: g0..g2 are the gradient stops, rg0..rg2 the rain's, anything else is a setting name (fg, bg, dropColor, …)
const GRADIENTS = { g: "gradient", rg: "rainGradient" };
const gradKey = (k) => { const m = /^(r?g)(\d)$/.exec(k); return m ? [GRADIENTS[m[1]], Number(m[2])] : null; };
function getColor(k) { const g = gradKey(k); return g ? S[g[0]][g[1]] : S[k]; }
function setColor(k, hex) {
  const g = gradKey(k);
  if (g) S[g[0]][g[1]] = hex; else S[k] = hex;
  syncUI(); schedulePreview(0);
}
// Photoshop's colour picker; resolves to the chosen "#rrggbb", or null when cancelled.
async function askColor(hex) {
  const [r, g, b] = Engine.hexToRgb(hex);
  const res = await core.executeAsModal(() => action.batchPlay([{ _obj: "showColorPicker", context: "ASCII by Star", color: { _obj: "RGBColor", red: r, grain: g, blue: b } }], {}), { commandName: "ASCII by Star colour" });
  const d = res && res[0];
  const c = d && (d.RGBFloatColor || d.color);
  if (!c || c.red === undefined) return null;
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return Engine.rgbToHex(ch(c.red), ch(c.grain !== undefined ? c.grain : c.green), ch(c.blue));
}
async function pickColor(k) {
  try { const v = await askColor(getColor(k)); if (v) setColor(k, v); }
  catch (e) { console.error(e); status("Colour picker unavailable — type a hex value instead.", true); }
}

function syncUI() {
  for (const [key, el] of Object.entries(sliderEls)) { el.input.value = String(S[key]); el.val.textContent = el.fmt(Number(S[key])); }
  for (const k of SELECTS) setSelect($(k), S[k]);
  for (const k of CHECKS) { $(k).checked = !!S[k]; if ($(k).syncChecked) $(k).syncChecked(); }
  for (const k of TEXTS) if ($(k).value !== S[k]) $(k).value = S[k];
  $("glitchSeed").value = String(S.glitchSeed);
  $("rainSeed").value = String(S.rainSeed);
  $("undoRandom").disabled = !undoStack.length;
  if (allFonts.length) fillFontSelect();
  document.querySelectorAll(".swatch").forEach((el) => { el.style.backgroundColor = getColor(el.dataset.color); });
  document.querySelectorAll(".hex").forEach((el) => { el.value = getColor(el.dataset.hex); });
  refreshVisibility();
}
function refreshVisibility() {
  const show = (el, on) => el.classList.toggle("hidden", !on);
  const custom = S.charset === "custom", mode = custom ? S.textMode : "ramp";
  show($("customRows"), custom);
  const parsed = custom ? Engine.parseCustom(S.customChars) : null;
  show($("hideRow"), !!parsed && parsed.messages.length > 0);
  show($("fillRows"), !!(parsed && parsed.fill));
  show(sliderEls.fillLevel.row, !!(parsed && parsed.fill && parsed.text.trim()));
  show($("fillShuffleRow"), !!(parsed && parsed.fill && parsed.fill.random));
  show($("textModeRows"), custom);
  show($("phraseRows"), mode === "phrase");
  show($("sortRow"), mode === "ramp");
  show($("shapeRows"), mode === "ramp"); // words and phrases are placed by tone and position only
  show($("sortHint"), mode === "ramp" && !S.sortByDensity);
  $("textModeHint").textContent = TEXT_MODE_HINTS[mode] || "";
  show(sliderEls.size.row, S.sizeMode === "px");
  show(sliderEls.columns.row, S.sizeMode === "cols");
  show($("fgRow"), S.colorMode === "mono");
  show($("gradRows"), S.colorMode === "gradient");
  for (const id of ["gradMidSwatch", "gradMidHex"]) $(id).style.opacity = S.gradientMid ? "" : "0.35";
  show($("outlineRows"), !!S.outlineOn);
  show($("outlineCharsRow"), S.outlineStyle === "chars");
  show($("outlineFillRow"), S.outlineFill === "chars" || S.outlineFill === "random");
  show($("origRows"), S.colorMode === "original");
  show($("bgRow"), S.bgMode !== "transparent");
  show($("keepAlphaRow"), S.bgMode !== "transparent");
  show($("dropRows"), !!S.dropOn); show($("longRows"), !!S.longOn); show($("offRows"), !!S.offOn); show($("glowRows"), !!S.glowOn);
  show($("glowColorRow"), !S.glowTextColor);
  show(sliderEls.shadowAngle.row, !!(S.dropOn || S.longOn || S.offOn));
  show(sliderEls.mosaicAmount.row, S.bgMode === "mosaic");
  show(sliderEls.bgOpacity.row, S.bgMode !== "transparent");
  show($("bgHint"), S.bgMode !== "transparent");
  show(sliderEls.ditherStrength.row, S.dither !== "none");
  show($("serpRow"), !!Engine.DIFFUSION[S.dither]);
  show($("ditherHint"), S.dither !== "none");
  show($("glitchBody"), !!S.glitchOn);
  show($("rainRows"), !!S.rainOn);
  show($("rainCharsRow"), S.rainCharset === "custom");
  show(sliderEls.rainDistance.row, S.rainFrom !== "everywhere");
  show(sliderEls.rainOutside.row, S.rainFrom === "everywhere");
  show($("rainColorRow"), S.rainColorMode !== "gradient");
  show($("rainGradRows"), S.rainColorMode === "gradient");
  for (const id of ["rainMidSwatch", "rainMidHex"]) $(id).style.opacity = S.rainGradientMid ? "" : "0.35";
  $("rainHint").textContent = RAIN_HINTS[S.rainFrom] || "";
}

let allFonts = [];
async function loadFonts() {
  try {
    // one batchPlay call is far faster than walking app.fonts (1000+ DOM proxies)
    const r = await action.batchPlay([{ _obj: "get", _target: [{ _property: "fontList" }, { _ref: "application", _enum: "ordinal", _value: "targetEnum" }] }], {});
    const fl = r && r[0] && r[0].fontList;
    const names = (fl && fl.fontName) || [], ps = (fl && fl.fontPostScriptName) || [];
    const fams = (fl && fl.fontFamilyName) || [];
    allFonts = ps.map((p, i) => ({ ps: p, name: names[i] || p, family: fams[i] })).sort((x, y) => x.name.localeCompare(y.name));
  } catch (e) { console.error(e); allFonts = []; }
  fillFontSelect();
  return allFonts.length;
}
// Font picker: hidden until clicked; lists every installed font (recent first) and adds more as you scroll.
let fontFilterTimer = null, fontMatches = [], fontShown = 0, fontOpen = false;
const FONT_PAGE = 60;
function fontMatchList() {
  const q = $("fontSearch").value.trim().toLowerCase(), recent = loadJSON("gf:recentFonts", []);
  if (q) return allFonts.filter((f) => f.name.toLowerCase().includes(q) || f.ps.toLowerCase().includes(q));
  const rec = recent.map((ps) => allFonts.find((f) => f.ps === ps)).filter(Boolean);
  return rec.concat(allFonts.filter((f) => !recent.includes(f.ps)));
}
function fontItem(ps, name, family) {
  const d = document.createElement("div");
  d.className = "fontItem" + ((ps || "") === (S.font || "") ? " sel" : "");
  d.setAttribute("data-ps", ps);
  if (ps) d.style.fontFamily = `'${ps}', '${family || name}'`;
  d.textContent = name;
  return d;
}
function appendFonts() {
  const box = $("fontList"), more = box.querySelector(".fontMore, .fontNote");
  if (more) box.removeChild(more);
  const next = fontMatches.slice(fontShown, fontShown + FONT_PAGE);
  for (const f of next) box.appendChild(fontItem(f.ps, f.name, f.family));
  fontShown += next.length;
  const note = document.createElement("div");
  if (fontShown < fontMatches.length) { note.className = "fontMore"; note.textContent = `Scroll for more · ${fontMatches.length - fontShown} left`; }
  else { note.className = "fontNote"; note.textContent = fontMatches.length ? `${fontMatches.length} fonts` : "No installed font matches"; }
  box.appendChild(note);
}
function fillFontSelect() {
  $("fontCurrent").textContent = S.font ? S.fontName || S.font : "Built-in (Menlo)";
  if (!fontOpen) return;
  const box = $("fontList");
  while (box.firstChild) box.removeChild(box.firstChild);
  box.appendChild(fontItem("", "Built-in (Menlo, fastest)"));
  fontMatches = fontMatchList(); fontShown = 0;
  appendFonts();
  box.scrollTop = 0;
}
function openFontPanel(open) {
  fontOpen = open;
  $("fontPanel").classList.toggle("hidden", !open);
  $("fontChev").textContent = open ? "▴" : "▾";
  if (open) fillFontSelect();
  fitLayout(true);
}
function checkFontScroll() {
  if (!fontOpen || fontShown >= fontMatches.length) return;
  const box = $("fontList");
  if (box.scrollTop + box.clientHeight >= box.scrollHeight - 60) appendFonts();
}
function setFont(ps, name) {
  S.font = ps || ""; S.fontName = ps ? name || ps : "";
  if (ps) saveJSON("gf:recentFonts", [ps].concat(loadJSON("gf:recentFonts", []).filter((x) => x !== ps)).slice(0, 8));
  $("fontSearch").value = "";
  openFontPanel(false);
  fillFontSelect(); schedulePreview(0);
}

// Checkbox toggles. Some UXP builds don't send "change" for clicks on the label text, so clicks are
// watched too and the state is read after the click has landed; `fn` only runs when the value changed.
function onCheck(el, fn) {
  let last = el.checked;
  const check = () => setTimeout(() => { if (el.checked !== last) { last = el.checked; fn(last); } }, 0);
  el.addEventListener("change", check);
  el.addEventListener("click", check);
  if (el.parentNode && el.parentNode.tagName === "LABEL") el.parentNode.addEventListener("click", check);
  el.syncChecked = () => { last = el.checked; };
}

// ---------- layout ----------
// UXP panels don't scroll on their own: give the settings area an explicit height
// (panel height minus the pinned preview block) whenever the panel size changes.
let lastH = -1, lastTop = -1;
// The preview box has a fixed height (a share of the panel the viewer keeps; it can also be hidden), so a new
// preview image (which has no size for a moment while it loads) can't shrink the top area and make the
// settings jump. Styles are only written when they change.
function fitLayout(force) {
  const H = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
  if (!H) return;
  const isInk = tab === "ink", top = $(isInk ? "inkTop" : "top");
  const setH = (el, prop, px) => { const v = px + "px"; if (el.style[prop] !== v) el.style[prop] = v; };
  const v = isInk ? ink && ink.viewer : viewer;
  if (v) v.layout(H);
  if (!force && H === lastH && top.offsetHeight === lastTop) return;
  lastH = H; lastTop = top.offsetHeight;
  setH($(isInk ? "inkScroller" : "scroller"), "height", Math.max(60, H - ($("tabs").offsetHeight || 0) - top.offsetHeight));
  if (isInk) { if (ink) ink.relayout(); } else if (viewer) viewer.relayout(); // keep the preview centred in the new size
}

function showTab(t) {
  tab = t === "ink" ? "ink" : "ascii";
  saveJSON("gf:tab", tab);
  $("tabAscii").classList.toggle("on", tab === "ascii");
  $("tabInk").classList.toggle("on", tab === "ink");
  $("asciiTool").classList.toggle("hidden", tab !== "ascii");
  $("inkTool").classList.toggle("hidden", tab !== "ink");
  fitLayout(true);
  if (!ink) return;
  if (tab === "ink") ink.activate();
  else { ink.deactivate(); if (src) src.stale = true; schedulePreview(0); }
}

// ---------- Photoshop events ----------
let staleTimer = null;
function onPsEvent(evt, desc) {
  if (live && evt === "close" && !docById(live.docId)) { live = null; updateLiveBtn(); }
  if (tab === "ink") { if (src) src.stale = true; if (ink) ink.onPsEvent(evt, desc); return; }
  if (busy) return;
  const a = activeDoc();
  if (live && a && a.id === live.docId) return; // looking at the live window doesn't change the source
  const ref = desc && desc._target && desc._target[0] && desc._target[0]._ref;
  if (evt === "select" && ref === "layer" && $("source").value !== "layer") return;
  if (src) src.stale = true;
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => { if (!busy) schedulePreview(0); }, 350);
}

async function init() {
  enhanceAllSelects(() => fitLayout(true)); // before any "change" listener is added
  viewer = makeViewer();
  buildUI();
  syncUI();
  ink = setupInk({ $, loadJSON, saveJSON, errMsg, toRGBA8, makeImageData, convertOut, createLayer, findLayers, findLayerById, bitDepth, isGray, checkDoc, activeDoc, askColor, selectLayer, docBaseName, fitLayout, onCheck });
  $("tabAscii").addEventListener("click", () => showTab("ascii"));
  $("tabInk").addEventListener("click", () => showTab("ink"));
  showTab(tab);
  window.addEventListener("resize", () => fitLayout(true));
  setInterval(() => fitLayout(false), 400);
  fitLayout(true);
  try {
    const mf = JSON.parse(await (await (await lfs.getPluginFolder()).getEntry("manifest.json")).read({ format: formats.utf8 }));
    $("version").textContent = `ASCII by Star · version ${mf.version}`;
  } catch (e) { /* footer keeps the plain name */ }
  try { baseAtlas = atlas = await loadAtlas(); baseAtlas.id = "builtin"; }
  catch (e) { console.error(e); showPreviewMsg("Failed to load glyph atlas: " + errMsg(e)); return; }
  try { await action.addNotificationListener(["select", "open", "close"], onPsEvent); } catch (e) { console.error(e); }
  if (tab !== "ink") schedulePreview(0); // the ink tab started its own preview in showTab
  setTimeout(() => loadFonts(), 300);
}
init();
