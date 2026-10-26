"use strict";
const { app, core, action, imaging, constants } = require("photoshop");
const uxp = require("uxp");
const lfs = uxp.storage.localFileSystem;
const formats = uxp.storage.formats;
const Engine = require("./engine.js");
const { CHARSETS } = require("./charsets.js");
const { PRESETS } = require("./presets.js");
const { makePresetBox } = require("./presetbox.js");
const { makePicker } = require("./picker.js");
const { makeHistory } = require("./history.js");
const setupInk = require("./inkui.js");
const setupLines = require("./linesui.js");
const setupMap = require("./mapui.js");
const setupTextArt = require("./textart.js");
const { makeSlider, trackDrag, onDoubleClick, SLIDER_HTML } = require("./slider.js");
const { enhanceAllSelects } = require("./dropdown.js");
const { enhanceAllFields, refreshFields } = require("./fields.js");
const { createViewer } = require("./viewer.js");
const { findLayers, findLayerById, fullFrame, sameFrame, frameOf, forgetArtboards, fillArtboardSelect, toRGBA8, convertOut, makeImageData, makeReader, hasAlpha, throwawayStep, readWithHidden, layersAbove, selectionBounds, withoutSelection } = require("./pixels.js");

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
let looks = null; // the Look presets (presetbox.js; saved ones in gf:userPresets)
let tab = loadJSON("gf:tab", "ascii"); // "ascii" | "text" | "ink" | "lines"
let ink = null; // the Ink bleed tab (inkui.js)
let lines = null; // the Lines tab (linesui.js)
let mapTab = null; // the Map tab (mapui.js)
let textTab = null; // the Text art tab (textart.js)

// ---------- utils ----------
function loadJSON(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or unavailable */ } }
function freshSettings(over) {
  const s = JSON.parse(JSON.stringify(Engine.DEFAULTS));
  if (over) for (const k of Object.keys(s)) if (over[k] !== undefined) s[k] = JSON.parse(JSON.stringify(over[k]));
  return Engine.migrateSettings(s); // values saved by older versions
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
const presetCharsOf = (id) => (CHARSETS.find((c) => c.id === id) || {}).chars || "";
const rainPresetChars = () => presetCharsOf(S.rainCharset);
const charsetParts = () => Engine.charsetParts(S, charsetInfo().chars, rainPresetChars(), presetCharsOf(S.rrCharset));
function docBaseName(doc) { return String((doc && doc.title) || "ascii").replace(/\.[^.]+$/, ""); }

let csCache = { key: null, cs: null };
function currentCharset() {
  const parts = charsetParts();
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
  if (S.textArtOn) return textArtSource(ctx, doc, frame, ownHistory);
  const aw = Math.max(1, Math.round(frame.w * scale)), ah = Math.max(1, Math.round(frame.h * scale)), R = { x: frame.x * scale, y: frame.y * scale, w: aw, h: ah };
  const data = layerId === null
    ? await throwawayStep(ctx, doc, () => readWithHidden(doc, null, ourOutputs(doc), R, scale), ownHistory)
    : await readWithHidden(doc, layerId, [], R, scale);
  const underRead = needsUnder(S), under = underRead ? await readBelow(ctx, doc, layerId, R, scale, ownHistory) : null;
  return { docId: doc.id, layerId, frame, scale, docW: frame.w, docH: frame.h, w: aw, h: ah, data, under, underRead, stale: false };
}

// Text art needs no pixels: the grid comes from S.textArt (Engine.textArtAnalysis). Colours from "the layer
// below" come from the visible image, without the plugin's output.
async function textArtSource(ctx, doc, frame, ownHistory) {
  const z = baseScale(frame), aw = Math.max(1, Math.round(frame.w * z)), ah = Math.max(1, Math.round(frame.h * z)), underRead = needsUnder(S);
  let under = null;
  if (underRead) {
    try { const px = await throwawayStep(ctx, doc, () => readWithHidden(doc, null, ourOutputs(doc), { x: frame.x * z, y: frame.y * z, w: aw, h: ah }, z), ownHistory); under = hasAlpha(px) ? px : null; }
    catch (e) { console.error("text art backdrop", e); }
  }
  return { docId: doc.id, layerId: null, frame, scale: 1, docW: frame.w, docH: frame.h, w: aw, h: ah, data: null, under, underRead, textArt: true, stale: false };
}

// ---------- the layer below ----------
// Settings can colour cells from "the layer below": the visible image under the source layer (or, with the
// visible image as the source, under the active layer), read with that layer, everything above it and the
// plugin's own output hidden. Engine.computeGrid averages it per cell (src.under).
function needsUnder(s) {
  const ring = s.outlineOn && s.outlineRingOn && [s.outlineRingColorFrom, s.outlineRingTextColorFrom, s.outlineRingFill === "rain" && s.rrColorMode].includes("under");
  return s.colorMode === "under" || (s.outlineOn && s.outlineColorFrom === "under") || (s.rainOn && s.rainColorMode === "under") || ring ||
    (s.cfOn && s.cfFrom === "under") || s.msgColorFrom === "under" || s.fillColorFrom === "under" || (s.cellEdits || []).some((e) => e && e.color === "under");
}
// The visible image under the source as RGBA (rect R at scale z, like capture), or null when nothing is below.
// Inside executeAsModal. ownHistory: the temporary hiding goes into a history step that is thrown away.
async function readBelow(ctx, doc, layerId, R, z, ownHistory) {
  let anchor = layerId != null ? findLayerById(doc, layerId) : null;
  if (!anchor) { const al = doc.activeLayers && doc.activeLayers[0]; anchor = al && !ourOutput(al) ? al : null; }
  if (!anchor) return null;
  const hide = [anchor].concat(layersAbove(doc, anchor), ourOutputs(doc));
  try {
    const px = await throwawayStep(ctx, doc, () => readWithHidden(doc, null, hide, R, z), ownHistory);
    return hasAlpha(px) ? px : null; // null: nothing below
  } catch (e) { console.error("layer below", e); return null; }
}

function sourceLayerId(doc) {
  if ($("source").value !== "layer") return null;
  if (editing && editing.docId === doc.id && editing.sourceLayerId != null && findLayerById(doc, editing.sourceLayerId)) return editing.sourceLayerId;
  const al = doc.activeLayers && doc.activeLayers[0];
  if (al && !ourOutput(al) && al.kind !== constants.LayerKind.GROUP && String(al.kind) !== "group") return al.id;
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
  const layerId = S.textArtOn ? null : sourceLayerId(doc), frame = await frameOf(doc, layerId, artboardPick());
  const scale = S.textArtOn ? 1 : full ? neededScale(frame) : baseScale(frame);
  if (src && !src.stale && !!src.textArt === !!S.textArtOn && src.docId === doc.id && src.layerId === layerId && sameFrame(src.frame, frame) && src.scale >= scale - 1e-6 && (src.underRead || !needsUnder(S))) return true;
  busy = true;
  try { src = await core.executeAsModal((ctx) => capture(ctx, doc, layerId, scale, true, frame), { commandName: "ASCII by Star: read pixels" }); }
  finally { busy = false; }
  return true;
}

// Renders the grid into a layer, in horizontal strips to keep memory low. Inside executeAsModal.
// The output covers the grid's area (the frame) × scale, with its top left at `at` in the target document:
// the frame's corner when writing into the source document, 0,0 in a scratch document of the frame's size.
// scale > 1 renders into a larger document (PNG export at 2x/4x); the grid stays in source-document units.
// draw(view) (optional) renders something else than the whole picture (one part, for separate layers).
// Returns whether anything visible was written.
async function writeLayer(doc, layer, grid, cs, scale, markCorners, at, draw) {
  scale = scale || 1; at = at || { x: 0, y: 0 };
  let ink = false;
  const W = Math.round(grid.geo.docW * scale), H = Math.round(grid.geo.docH * scale), depth = bitDepth(doc), gray = isGray(doc);
  let profile = null;
  try { profile = doc.colorProfileName || null; } catch (e) { profile = null; }
  const stripH = Math.max(1, Math.min(H, Math.floor(4e6 / W)));
  await withoutSelection(doc, async () => {
    for (let y0 = 0; y0 < H; y0 += stripH) {
      const h = Math.min(stripH, H - y0);
      const view = { x: 0, y: y0 / scale, w: W, h, scale }, rgba = draw ? draw(view) : Engine.render(grid, cs, atlas, S, view);
      if (!ink) ink = hasAlpha(rgba);
      if (markCorners) { // invisible 1/255 alpha pixels pin the layer bounds to the whole area
        if (y0 === 0) rgba[3] = Math.max(rgba[3], 1);
        if (y0 + h >= H) rgba[rgba.length - 1] = Math.max(rgba[rgba.length - 1], 1);
      }
      const id = await makeImageData(convertOut(rgba, W * h, depth, gray), W, h, gray, profile);
      try { await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: id, replace: y0 === 0, targetBounds: { left: at.x, top: at.y + y0 }, commandName: "ASCII by Star" }); }
      catch (e) { id.dispose(); throw new Error("Writing the layer failed (" + errMsg(e) + ")."); }
      id.dispose();
    }
  });
  return ink;
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
function charsetString() { const p = charsetParts(); return p.ramp + p.extra; }
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
// An atlas that has `chars`: the built-in one, or Menlo (Consolas on Windows) rendered by Photoshop for
// characters it lacks (the Text art tab's preview). Cached like the custom fonts.
async function atlasFor(chars) {
  if (!baseAtlas) throw new Error("The glyphs are still loading.");
  const set = Array.from(new Set(Array.from(" " + chars))).filter((c) => c !== "\n" && c !== "\r" && c !== "\t");
  if (set.every((c) => baseAtlas.index.has(c))) return baseAtlas;
  const key = MONO_FONT + "|" + set.join("");
  if (!fontAtlases.has(key)) fontAtlases.set(key, (await loadCachedFontAtlas(key)) || (await buildFontAtlas(MONO_FONT, set, key)));
  return fontAtlases.get(key);
}
// The Text art tab's "Use with effects": the art becomes the ASCII tab's picture.
function useArt(art, font) {
  Object.assign(S, { textArtOn: true, textArt: art, textArtFont: font });
  src = null;
  showTab("ascii"); syncUI(); fitLayout(true);
  status(`Text art in ${font}. Every effect applies; Apply puts it in your document.`);
}
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

// ---------- undo ----------
// ↶ Undo takes back the last change to the settings or the presets (a deleted preset comes back too). Every
// change passes through schedulePreview or a preset action, which calls noteChange; changes less than 0.7 s
// apart (a slider drag, typing) make one step.
const hist = makeHistory({
  state: () => JSON.stringify({ s: S, p: looks ? looks.list() : [] }),
  restore: (st) => {
    const prev = JSON.parse(st);
    S = freshSettings(prev.s);
    if (JSON.stringify(prev.p) !== JSON.stringify(looks.list())) looks.setList(prev.p);
  },
  onAvail: (can) => { $("undoAll").disabled = !can; },
});
const noteChange = () => hist.note();
function undoLast() {
  if (!hist.undo()) return;
  syncUI(); schedulePreview(0);
  status("Undone." + (hist.canUndo() ? "" : " Nothing more to undo."));
}

// ---------- preview ----------
let pvTimer = null, pvRunning = false, pvAgain = false;
function schedulePreview(delay) {
  saveJSON("gf:last", S);
  noteChange();
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
let liveTimer = null, liveRunning = false, liveAgain = false, liveSaveTimer = null, liveSaving = null;
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
  if (live) { status(`Editing “${live.soName}” live (${live.scale.toFixed(0)}×). Zoom/pan with Photoshop's tools; Save & close when done.`); scheduleLive(0); scheduleUnder(0); }
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
  const lv = live;
  if (!lv || lv.closing) return; // already closing (a second click)
  lv.closing = true; // no update or background save may start while the .psb saves and closes
  clearTimeout(liveTimer); clearTimeout(liveSaveTimer);
  while (liveRunning) await new Promise((r) => setTimeout(r, 50));
  clearTimeout(liveTimer); clearTimeout(liveSaveTimer); liveAgain = false;
  if (liveSaving) await liveSaving; // a background save can't share the modal state with this one
  try { await saveLive(true); status(`Saved into “${lv.soName}”.`); }
  catch (e) { console.error(e); status("Couldn't save the smart object: " + errMsg(e) + ". Save it with ⌘S.", true); }
  live = null; updateLiveBtn();
  if (lv.under) viewer.refresh(); // back to the checkerboard
}
function scheduleLive(delay) { if (!live || live.closing) return; clearTimeout(liveTimer); liveTimer = setTimeout(runLive, delay === undefined ? 300 : delay); }
async function runLive() {
  if (!live || live.closing) return;
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
    underQuietUntil = Date.now() + 600; // the "Live update" history step isn't a change by the user
    scheduleLiveSave();
    if (lv.underSig !== liveLayerSig(d)) scheduleUnder(0);
  } catch (e) {
    console.error(e);
    if (/busy|modal/i.test(errMsg(e))) liveAgain = true; else status("Live update: " + errMsg(e), true);
  } finally { busy = false; liveRunning = false; }
  if (liveAgain) { liveAgain = false; scheduleLive(400); }
}
// Saving pushes the .psb into the working document; do it once edits pause.
function scheduleLiveSave() {
  clearTimeout(liveSaveTimer);
  liveSaveTimer = setTimeout(() => { if (live && !live.closing && !liveRunning) liveSaving = saveLive(false).catch((e) => console.error(e)).then(() => { liveSaving = null; }); }, 900);
}

// Layers the user adds under the characters in the live .psb (a background to see them better) show in the
// panel preview too: live.under = {k (px per frame unit), w, h, data RGBA}, or null when there are none. It is
// read with the characters and everything above them hidden, in a history step that is thrown away, again
// when the .psb's history changes, when its layer list changes, or on ⟳.
let underTimer = null, underQuietUntil = 0;
function scheduleUnder(delay) { if (!live || live.closing) return; clearTimeout(underTimer); underTimer = setTimeout(readLiveUnder, delay === undefined ? 400 : delay); }
function liveLayerSig(d) {
  try { return findLayers(d.layers, () => true).map((l) => [l.id, l.visible, l.opacity, String(l.blendMode)].join(":")).join("|"); } catch (e) { return ""; }
}
async function readLiveUnder() {
  const lv = live;
  if (!lv || lv.closing) return;
  if (busy || liveRunning) return scheduleUnder(400);
  const d = docById(lv.docId);
  if (!d) return;
  lv.underSig = liveLayerSig(d);
  const ours = findLayerById(d, lv.layerId);
  const hide = ours ? [ours].concat(layersAbove(d, ours)) : []; // the characters and whatever is above them
  let under = null;
  if (findLayers(d.layers, (l) => l.visible && !hide.includes(l)).length) {
    const s = Math.min(1, ANALYSIS_MAX / Math.max(d.width, d.height)), w = Math.max(1, Math.round(d.width * s)), h = Math.max(1, Math.round(d.height * s));
    busy = true;
    try {
      const data = await core.executeAsModal((ctx) => throwawayStep(ctx, d, () => readWithHidden(d, null, hide, { x: 0, y: 0, w, h }, s)), { commandName: "ASCII by Star live background" });
      if (hasAlpha(data)) under = { k: s * lv.scale, w, h, data };
    } catch (e) { console.error(e); }
    finally { busy = false; underQuietUntil = Date.now() + 600; }
  }
  if (live !== lv || (!under && !lv.under)) return;
  lv.under = under;
  viewer.refresh();
}

// ---------- ⌘Z ----------
// While the panel has the keyboard, Photoshop doesn't get ⌘Z / ⇧⌘Z (Ctrl on Windows), so the panel passes
// them on as Photoshop's Undo / Redo. If Photoshop did take the key itself, the history has already moved and
// nothing more is done. In the live window a "Live update" step is a panel change, so the setting is undone
// instead: the panel, the .psb and the document stay in step.
let undoKeyBusy = false;
function histMark(d) { try { const h = d.activeHistoryState; return h ? h.id + ":" + h.name : ""; } catch (e) { return ""; } }
function histName(d) { try { const h = d.activeHistoryState; return h ? String(h.name) : ""; } catch (e) { return ""; } }
function onUndoKey(e) {
  const k = String(e.key || "").toLowerCase(), mod = e.metaKey || e.ctrlKey;
  const redo = k === "z" ? !!e.shiftKey : k === "y" && e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey || (k !== "z" && !redo)) return;
  const tag = e.target && String(e.target.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") return; // typing: the field's own undo
  if (e.preventDefault) e.preventDefault();
  if (e.stopPropagation) e.stopPropagation();
  psUndo(redo);
}
async function psUndo(redo) {
  if (undoKeyBusy) return;
  const d = activeDoc();
  if (!d) return;
  undoKeyBusy = true;
  try {
    const mark = histMark(d), name = histName(d), inLive = !!(live && !live.closing && d.id === live.docId);
    await new Promise((r) => setTimeout(r, 80));
    if (!redo && inLive && name === "Live update" && hist.canUndo()) { undoLast(); return; }
    if (histMark(d) !== mark) return; // Photoshop handled the key
    if (busy) return status("Photoshop is busy. Try ⌘Z again in a moment.", true);
    try {
      await core.executeAsModal(() => action.batchPlay([{ _obj: "select", _target: [{ _ref: "historyState", _enum: "ordinal", _value: redo ? "next" : "previous" }] }], {}), { commandName: redo ? "Redo" : "Undo" });
    } catch (e) { return; } // nothing left to undo or redo
    if (inLive) { scheduleLiveSave(); scheduleUnder(0); }
    else { if (src) src.stale = true; schedulePreview(0); }
  } finally { undoKeyBusy = false; }
}

// Renders at `scale`x into a temporary document, converts it to a smart object, brings it into `doc`
// and scales it back to document size, so the smart object keeps the extra resolution. Inside executeAsModal.
async function placeSmartObject(doc, grid, cs, scale, name, frame, draw) {
  frame = frame || fullFrame(doc);
  const W = Math.round(frame.w * scale), H = Math.round(frame.h * scale);
  const { doc: tmp, layer } = await createScratchDoc(W, H, (doc.resolution || 72) * scale, "ASCII by Star render");
  let placed = null;
  const tag = "ASCII by Star render " + Date.now().toString(36); // finds the copy even when duplicate() returns nothing
  try {
    await writeLayer(tmp, layer, grid, cs, scale, true, null, draw);
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
  if (cellSel) refreshEditUI(); else updateMarks(); // the grid may have changed under the selection
  const lowRes = src.scale < neededScale(src.frame) - 1e-6;
  scheduleLive();
  const hid = grid.hidden ? ` · ${grid.hiddenPlaced} hidden message${grid.hiddenPlaced === 1 ? "" : "s"}` : "";
  const ne = (S.cellEdits || []).length, eds = ne ? ` · ${ne} edit${ne === 1 ? "" : "s"}` : "";
  const below = needsUnder(S) && !src.under ? " · nothing below the source layer, so its own colours are used" : "";
  if (!live) status(`${geo.cols} × ${geo.rows} chars · ${geo.size.toFixed(1)}px · ${cs.n} glyphs${hid}${eds}${below}${lowRes ? " · preview sampled at reduced res" : ""}`);
}

// The preview of document rect `rect` at scale z, as RGB (characters over a checkerboard where transparent).
function renderRegion(rect, z) {
  const { cs, grid } = gridCache;
  if (!grid) return null;
  const w = Math.max(1, Math.round(rect.w * z)), h = Math.max(1, Math.round(rect.h * z));
  const s = markHidden ? Object.assign({}, S, { _markHidden: true }) : S;
  const rgba = Engine.render(grid, cs, atlas, s, { x: rect.x, y: rect.y, w, h, scale: z }), u = live && live.under;
  return { rgb: Engine.flattenForPreview(rgba, w, h, u ? underBackdrop(u, rect, z, w, h) : null), w, h };
}
// The live view's layers under the characters (live.under, see readLiveUnder) for document rect `rect` at
// scale z, as RGBA w × h (nearest pixel), to show behind the preview.
function underBackdrop(u, rect, z, w, h) {
  const out = new Uint8Array(w * h * 4), sx = new Int32Array(w);
  for (let x = 0; x < w; x++) { const v = Math.floor((rect.x + (x + 0.5) / z) * u.k); sx[x] = v >= 0 && v < u.w ? v : -1; }
  for (let y = 0; y < h; y++) {
    const sy = Math.floor((rect.y + (y + 0.5) / z) * u.k);
    if (sy < 0 || sy >= u.h) continue;
    for (let x = 0; x < w; x++) if (sx[x] >= 0) out.set(u.data.subarray((sy * u.w + sx[x]) * 4, (sy * u.w + sx[x]) * 4 + 4), (y * w + x) * 4);
  }
  return out;
}

function makeViewer() {
  return createViewer({
    wrap: $("previewWrap"), img: $("preview"), msg: $("previewMsg"), bar: $("zoomBar"), grip: $("previewGrip"), head: $("previewHead"), storeKey: "gf:zoom:ascii", onLayout: () => fitLayout(true),
    docSize: () => (src ? { w: src.docW, h: src.docH } : null), render: renderRegion, onEditToggle: () => setEditMode(!tool.on),
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
        const oldIsSmart = old && /smart/i.test(String(old.kind)), oldIsGroup = old && isGroup(old);
        if ($("applyLayers").value === "split") {
          const r = await applyAsGroup(doc, frame, layerId, old, name, q);
          layer = r.group;
          if (old) editing.layerId = layer.id;
          info = `${r.made.length} layers in a group (${r.made.join(", ")})` + (r.note ? " · " + r.note : "");
        } else if (q > 1 || oldIsSmart || oldIsGroup) {
          try {
            layer = q > 1 || oldIsSmart ? await placeSmartObject(doc, grid, cs, Math.max(1, q), name, frame) : await createLayer(doc, name);
            if (!/smart/i.test(String(layer.kind))) await writeLayer(doc, layer, grid, cs, 1, false, frame); // a group replaced by one pixel layer
            if (old) await replaceLayer(old, layer);
            info = `${geo.cols} × ${geo.rows} chars` + (/smart/i.test(String(layer.kind)) ? ` · ${q}× smart object` : "");
          } catch (e) {
            console.error(e);
            layer = null;
            info = `smart object failed (${errMsg(e)}), made a pixel layer instead`;
          }
        }
        if (!layer) {
          layer = old && !oldIsGroup ? old : await createLayer(doc, name);
          await writeLayer(doc, layer, grid, cs, 1, false, frame);
          if (oldIsGroup) await replaceLayer(old, layer);
          if (!info) info = `${geo.cols} × ${geo.rows} chars`;
        }
        rememberLayer(doc, layer, layerId);
      } finally {
        await ctx.hostControl.resumeHistory(sid, true);
      }
    }, { commandName: "ASCII by Star" });
    status(`${update ? "Updated" : "Created"} ${$("applyLayers").value === "split" ? "group" : "layer"} · ${info} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error(e); status(errMsg(e), true);
  } finally { busy = false; }
}

// ---------- separate layers ----------
const isGroup = (l) => String(l.kind) === "group" || l.kind === constants.LayerKind.GROUP;
// The plugin's output a layer belongs to: itself, or the "… ASCII by Star" group holding it (separate layers).
function ourOutput(l) { for (let p = l; p; p = p.parent) { try { if (OUR_RE.test(String(p.name))) return p; } catch (e) { return null; } } return null; }
// Every layer or group the plugin made in doc (hidden for reads of the visible image).
const ourOutputs = (doc) => findLayers(doc.layers, (l) => OUR_RE.test(String(l.name)));
const PS_BLEND = { screen: "SCREEN", multiply: "MULTIPLY", add: "LINEARDODGE" };
// An update that can't write into the old output in place: the new one takes its place in the stack.
async function replaceLayer(old, layer) {
  await layer.move(old, constants.ElementPlacement.PLACEBEFORE);
  await old.delete();
  editing.layerId = layer.id;
}
// "Separate layers": a group named like the single layer, with one layer per part (Engine.layerParts), bottom to
// top. Parts come from a grid computed without the glitch; the Glitch layer holds what the glitch changes.
// Replaces `old` (a layer or group being updated) in place. Inside executeAsModal, after capture() set src.
async function applyAsGroup(doc, frame, layerId, old, name, q) {
  const cs = currentCharset(), geo = Engine.computeGeometry(frame.w, frame.h, S, atlas);
  const clean = Engine.computeGrid(src, geo, Object.assign({}, S, { _parts: true, glitchOn: false }), cs);
  const glitched = S.glitchOn ? Engine.computeGrid(src, geo, S, cs) : null;
  const group = await doc.createLayerGroup({ name });
  if (old) await group.move(old, constants.ElementPlacement.PLACEBEFORE);
  const made = [];
  let below = null, note = "";
  for (const id of Engine.layerParts(clean, cs, S)) {
    const draw = (v) => Engine.renderPart(id, clean, cs, atlas, S, v, glitched), title = Engine.PART_NAMES[id];
    if (id === "glitch") { // skip it when the glitch changes nothing (all its amounts at 0)
      const z = Math.min(1, 400 / Math.max(frame.w, frame.h)), p = draw({ x: 0, y: 0, w: Math.max(1, Math.round(frame.w * z)), h: Math.max(1, Math.round(frame.h * z)), scale: z });
      if (!hasAlpha(p)) continue;
    }
    let layer = null;
    if (q > 1) { try { layer = await placeSmartObject(doc, clean, cs, q, title, frame, draw); } catch (e) { console.error(e); layer = null; note = "smart objects failed, made pixel layers"; } }
    if (!layer) {
      layer = await createLayer(doc, title);
      if (!(await writeLayer(doc, layer, clean, cs, 1, false, frame, draw))) { await layer.delete(); continue; }
    }
    if (below) await layer.move(below, constants.ElementPlacement.PLACEBEFORE);
    else await layer.move(group, constants.ElementPlacement.PLACEINSIDE);
    if (id === "cells" && PS_BLEND[S.cfBlend]) { try { layer.blendMode = constants.BlendMode[PS_BLEND[S.cfBlend]]; } catch (e) { console.error(e); } }
    below = layer;
    made.push(title);
  }
  if (old) await old.delete();
  if (S.glitchOn && S.bgMode === "transparent") note = (note ? note + "; " : "") + "on a transparent background the Glitch layer can't erase what the glitch moved";
  return { group, made, note };
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
  const l = ourOutput(doc && doc.activeLayers && doc.activeLayers[0]); // a layer inside a separate-layers group: the group
  if (!l) return status("Select a layer made by ASCII by Star (its name ends in “ASCII by Star”).", true);
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
            const grid = Engine.computeGrid(sample, geo, Object.assign({}, S, { cellEdits: [] }), cs); // edits belong to one picture
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
// A preset's settings applied as the look; the picture (symbol edits, text art) stays.
function applyLook(settings) {
  const picture = pictureOf(S);
  S = freshSettings(settings);
  Object.assign(S, picture);
  syncUI();
  schedulePreview(0);
}
// The settings that belong to one picture rather than to a look: symbol edits, the text art and the messages and
// fill added to a built-in character set.
const PICTURE_KEYS = ["extraChars", "cellEdits", "textArtOn", "textArt", "textArtFont"];
const pictureOf = (s) => Object.fromEntries(PICTURE_KEYS.map((k) => [k, JSON.parse(JSON.stringify(s[k] === undefined ? null : s[k]))]));
// Settings without them (for presets)
function lookOnly(s) { const out = JSON.parse(JSON.stringify(s)); for (const k of PICTURE_KEYS) out[k] = JSON.parse(JSON.stringify(Engine.DEFAULTS[k] === undefined ? null : Engine.DEFAULTS[k])); return out; }
// ---------- symbol edits ----------
// Edit symbols: the preview becomes a canvas. Dragging either paints (each cell under the pointer gets the action)
// or selects a box of cells, which Apply then edits; a Photoshop marquee can be the box too. Every change is an
// edit in S.cellEdits, which the engine applies after the grid (engine applyEdits). Positions are stored as
// fractions of the area, so they stay on the picture when the size changes. The tool's own settings belong to
// the panel, not to the look, so they're stored apart.
let tool = Object.assign({ op: "write", drag: "paint", fill: false, rainLen: "", text: "#", color: "#00e6ff", useColor: false }, loadJSON("gf:editTool", {}), { on: false });
const saveTool = () => saveJSON("gf:editTool", { op: tool.op, drag: tool.drag, fill: tool.fill, rainLen: tool.rainLen, text: tool.text, color: tool.color, useColor: tool.useColor, colorUnder: tool.colorUnder });
let cellSel = null; // the selected cells: {rect: [x0, y0, x1, y1]} or {pts: [[x, y], …]} as fractions of the area, or null
const EDIT_HINTS = {
  write: "Click a character or drag across several. More than one character is written in turn along the drag; a space empties a cell.",
  color: "Click or drag over characters to give them the colour.",
  erase: "Click or drag to empty cells.",
  restore: "Click or drag to give cells back what the image puts there.",
  rain: "Click a character and a Matrix rain stream falls from it (drag for several). Characters, colours, fade, head and angle come from Matrix rain; length from Rain length.",
  line: "Drag from one end to the other. Shift keeps it straight across, down or diagonal.",
  rect: "Drag from corner to corner. Shift makes a square.",
  ellipse: "Drag over the box the ellipse fits in. Shift makes a circle.",
  select: "Drag a box over the preview (a click picks one cell), then Apply, or press Enter in Characters. Several characters fill the box left to right. The box stays selected, so you can apply more to it.",
};
const EDIT_OPS = { write: "write", color: "recolour", erase: "erase", restore: "restore", rain: "start Matrix rain" };
const frac = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1e6) / 1e6;
// A new edit from the tool settings, or null (with a message) when there's nothing to write.
function newEdit() {
  const e = { op: tool.op };
  if (tool.op === "write") {
    if (!tool.text) { status("Type the characters to write first (Edit symbols ▸ Characters).", true); return null; }
    e.text = tool.text;
  }
  if (tool.op === "color" || (tool.op === "write" && (tool.useColor || tool.colorUnder))) e.color = tool.colorUnder ? "under" : tool.color;
  if (tool.op === "rain") e.len = Math.max(0, Math.min(500, parseInt(tool.rainLen, 10) || 0));
  return e;
}
function addEdit(e) { S.cellEdits = (S.cellEdits || []).concat([e]); refreshEditUI(); schedulePreview(0); }
// The preview grid's cell at column c, row r: its key, outline (document px) and centre (fractions).
function cellInfo(c, r) {
  const g = gridCache.geo;
  if (!g || c < 0 || r < 0 || c >= g.cols || r >= g.rows) return null;
  return { c, r, key: r * g.cols + c, rect: { x: c * g.cellW, y: r * g.cellH, w: g.cellW, h: g.cellH }, pt: [frac(((c + 0.5) * g.cellW) / g.docW), frac(((r + 0.5) * g.cellH) / g.docH)] };
}
function cellAt(p) { const g = gridCache.geo; return g && p ? cellInfo(Math.floor(p.x / g.cellW), Math.floor(p.y / g.cellH)) : null; }
// The box from cell a to cell b, as fractions along the cells' edges (so exactly those cells are inside).
function boxOf(a, b) {
  const g = gridCache.geo, c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c), r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r);
  return [frac((c0 * g.cellW) / g.docW), frac((r0 * g.cellH) / g.docH), frac(((c1 + 1) * g.cellW) / g.docW), frac(((r1 + 1) * g.cellH) / g.docH)];
}
// The selected cells in the current grid: {cols, rows, rect (document px)}, or null
function selCells() {
  const g = gridCache.geo;
  if (!cellSel || !g) return null;
  const cells = Engine.editCells(cellSel, g);
  if (!cells.length) return null;
  let c0 = Infinity, c1 = -1, r0 = Infinity, r1 = -1;
  for (const i of cells) { const c = i % g.cols, r = Math.floor(i / g.cols); c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
  // a shaped selection (from a marquee) is outlined cell by cell, up to a limit
  const each = cellSel.pts && cells.length <= 1500 ? cells.map((i) => ({ cls: "vsel", x: (i % g.cols) * g.cellW, y: Math.floor(i / g.cols) * g.cellH, w: g.cellW, h: g.cellH })) : null;
  return { n: cells.length, each, cols: c1 - c0 + 1, rows: r1 - r0 + 1, rect: { x: c0 * g.cellW, y: r0 * g.cellH, w: (c1 - c0 + 1) * g.cellW, h: (r1 - r0 + 1) * g.cellH } };
}
let hoverCell = null;
function updateMarks() {
  if (!viewer) return;
  const sc = selCells(), m = [];
  if (sc) m.push(...(sc.each || [Object.assign({ cls: "vsel" }, sc.rect)]));
  if (hoverCell && tool.on) m.push(hoverCell.rect);
  viewer.setMarks(m);
}
function setCellSel(box) {
  cellSel = box;
  refreshEditUI();
  const sc = selCells();
  if (sc) status(`${sc.n} cell${sc.n === 1 ? "" : "s"} selected. Apply edits them (Enter in Characters does too).`);
}
// Shapes from cell a to cell b (corners of their box): the cells along the outline, in drawing order.
function lineCells(a, b) {
  const out = [], n = Math.max(Math.abs(b.c - a.c), Math.abs(b.r - a.r));
  for (let t = 0; t <= n; t++) out.push([Math.round(a.c + (n ? ((b.c - a.c) * t) / n : 0)), Math.round(a.r + (n ? ((b.r - a.r) * t) / n : 0))]);
  return out;
}
function shapeCells(kind, a, b) {
  if (kind === "line") return lineCells(a, b);
  const c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c), r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r);
  if (tool.fill) { // every cell inside, in reading order
    const cx = (c0 + c1) / 2, cy = (r0 + r1) / 2, rx = (c1 - c0) / 2 + 0.5, ry = (r1 - r0) / 2 + 0.5, out = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (kind === "rect" || ((c - cx) / rx) ** 2 + ((r - cy) / ry) ** 2 <= 1) out.push([c, r]);
    return out;
  }
  let ring;
  if (kind === "rect") ring = [[c0, r0], [c1, r0], [c1, r1], [c0, r1], [c0, r0]];
  else { // ellipse: points around it, joined by lines so the outline has no gaps
    const cx = (c0 + c1) / 2, cy = (r0 + r1) / 2, rx = (c1 - c0) / 2, ry = (r1 - r0) / 2, n = Math.max(12, Math.ceil(4 * Math.PI * Math.max(rx, ry, 1)));
    ring = [];
    for (let k = 0; k <= n; k++) { const t = (2 * Math.PI * k) / n - Math.PI / 2; ring.push([Math.round(cx + rx * Math.cos(t)), Math.round(cy + ry * Math.sin(t))]); }
  }
  const out = [];
  for (let i = 1; i < ring.length; i++) out.push(...lineCells({ c: ring[i - 1][0], r: ring[i - 1][1] }, { c: ring[i][0], r: ring[i][1] }));
  return out;
}
// With Shift: an even shape on screen (cells are taller than wide), or a line straight across, down or at 45°.
function constrain(kind, a, b) {
  const g = gridCache.geo, dx = (b.c - a.c) * g.cellW, dy = (b.r - a.r) * g.cellH;
  if (kind === "line") {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
    return { c: a.c + Math.round((Math.cos(ang) * len) / g.cellW), r: a.r + Math.round((Math.sin(ang) * len) / g.cellH) };
  }
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return { c: a.c + (Math.sign(dx) || 1) * Math.round(s / g.cellW), r: a.r + (Math.sign(dy) || 1) * Math.round(s / g.cellH) };
}
let stroke = null; // the drag in progress: {e (its edit), seen (cell keys), last (cell)} or {anchor (cell)} for a box
const editor = {
  down(p) {
    const cell = cellAt(p);
    if (!cell) return;
    if (tool.drag === "select") { stroke = { anchor: cell }; setCellSel({ rect: boxOf(cell, cell) }); return; }
    const e = newEdit();
    if (!e) return;
    e.pts = [cell.pt];
    if (tool.drag !== "paint") { stroke = { shape: tool.drag, from: cell, e }; addEdit(e); return; }
    stroke = { e, seen: new Set([cell.key]), last: cell };
    addEdit(e);
  },
  move(p, ev) {
    const cell = cellAt(p);
    hoverCell = cell;
    if (stroke && stroke.shape) { // a shape is redrawn from its start to the pointer on every move
      if (!cell) return;
      const to = ev && ev.shiftKey ? constrain(stroke.shape, stroke.from, cell) : cell, seen = new Set(), pts = [];
      for (const [c, r] of shapeCells(stroke.shape, stroke.from, to)) { const k = cellInfo(c, r); if (k && !seen.has(k.key)) { seen.add(k.key); pts.push(k.pt); } }
      stroke.e.pts = pts.length ? pts : [stroke.from.pt];
      updateMarks();
      schedulePreview(0);
      return;
    }
    if (stroke && stroke.anchor) { if (cell) { cellSel = { rect: boxOf(stroke.anchor, cell) }; refreshEditUI(); } return; }
    updateMarks();
    if (!stroke || !cell || cell.key === stroke.last.key) return;
    // every cell on the way, so a quick drag leaves no gaps
    const { c: c0, r: r0 } = stroke.last, n = Math.max(Math.abs(cell.c - c0), Math.abs(cell.r - r0));
    for (let t = 1; t <= n; t++) {
      const k = cellInfo(Math.round(c0 + ((cell.c - c0) * t) / n), Math.round(r0 + ((cell.r - r0) * t) / n));
      if (k && !stroke.seen.has(k.key)) { stroke.seen.add(k.key); stroke.e.pts.push(k.pt); }
    }
    stroke.last = cell;
    schedulePreview(0);
  },
  up() { if (stroke && stroke.anchor) setCellSel(cellSel); stroke = null; },
  hover(p) { hoverCell = cellAt(p); updateMarks(); },
};
// Applies the action to the selected box.
function applySelection() {
  if (!cellSel) return status("Select cells first: Edit under the preview, Dragging ▸ Selects a box, then drag over the preview.", true);
  const e = newEdit();
  if (!e) return;
  if (cellSel.rect) e.rect = cellSel.rect.slice(); else e.pts = cellSel.pts.slice();
  addEdit(e);
  status("Edited the selected cells. Undo edit takes it back.");
}
// Selects the cells inside the marquee of the active document: the live smart object or the source document.
async function editFromSelection() {
  try {
    const a = activeDoc();
    if (!a) return status("Open a document first.", true);
    const sel = await selectionBounds(a);
    if (!sel) return status("Make a selection first: Rectangular Marquee in the live smart object or in your document.", true);
    let x0 = sel.left, y0 = sel.top, x1 = sel.right, y1 = sel.bottom, W, H;
    if (live && a.id === live.docId) { W = a.width; H = a.height; } // the .psb is the area at live.scale
    else {
      await ensureSource(false);
      if (!src || src.docId !== a.id) return status("The selection must be in the live smart object or in the document being converted.", true);
      x0 -= src.frame.x; x1 -= src.frame.x; y0 -= src.frame.y; y1 -= src.frame.y; W = src.docW; H = src.docH;
    }
    if (x1 <= 0 || y1 <= 0 || x0 >= W || y0 >= H) return status("The selection is outside the area being converted.", true);
    // the selection's own shape: the cells whose centre it covers (half or more)
    const g = gridCache.geo, ox = live && a.id === live.docId ? 0 : src.frame.x, oy = live && a.id === live.docId ? 0 : src.frame.y;
    const L = Math.max(0, Math.floor(x0)), T = Math.max(0, Math.floor(y0)), R = Math.min(W, Math.ceil(x1)), B = Math.min(H, Math.ceil(y1));
    let mask = null, mw = R - L;
    try {
      const res = await core.executeAsModal(() => imaging.getSelection({ documentID: a.id, sourceBounds: { left: L + ox, top: T + oy, right: R + ox, bottom: B + oy } }), { commandName: "ASCII by Star selection" });
      mask = await res.imageData.getData({ chunky: true }); mw = res.imageData.width; res.imageData.dispose();
    } catch (err) { console.error(err); mask = null; } // falls back to the bounding box
    if (mask && g) {
      const pts = [];
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        const fx = ((c + 0.5) * g.cellW) / g.docW, fy = ((r + 0.5) * g.cellH) / g.docH, px = Math.floor(fx * W) - L, py = Math.floor(fy * H) - T;
        if (px >= 0 && py >= 0 && px < R - L && py < B - T && mask[py * mw + px] >= 128) pts.push([frac(fx), frac(fy)]);
      }
      setCellSel(pts.length ? { pts } : null);
    } else setCellSel({ rect: [frac(x0 / W), frac(y0 / H), frac(x1 / W), frac(y1 / H)] });
    if (!selCells()) { cellSel = null; refreshEditUI(); status("The selection is smaller than a cell's centre. Make it a little bigger.", true); }
  } catch (err) { console.error(err); status("Couldn't read the selection: " + errMsg(err), true); }
}
function setEditMode(on) {
  tool.on = !!on;
  if (!tool.on) hoverCell = null;
  refreshEditUI();
  if (!tool.on) return status("Editing off: clicks and drags move and zoom the preview again.");
  const what = tool.op === "write" ? `write “${tool.text}”` : EDIT_OPS[tool.op];
  const shape = { line: "a line", rect: "a rectangle", ellipse: "an ellipse" }[tool.drag];
  if (shape) return status(`Editing: drag on the preview to draw ${shape} that will ${what} (Shift: even shape). Option-drag moves the view.`);
  status(tool.drag === "select" ? "Editing: drag a box over the preview, then Apply. Option-drag moves the view." : `Editing: click or drag on the preview to ${what}. Option-drag moves the view. More in Edit symbols.`);
}
function refreshEditUI() {
  const n = (S.cellEdits || []).length, show = (el, on) => el.classList.toggle("hidden", !on);
  if ($("editOn").checked !== tool.on) { $("editOn").checked = tool.on; if ($("editOn").syncChecked) $("editOn").syncChecked(); }
  setSelect($("editOp"), tool.op);
  setSelect($("editDrag"), tool.drag);
  if ($("editText").value !== tool.text) $("editText").value = tool.text;
  const uc = $("editUseColor"), forced = tool.op === "color"; // recolouring always uses the colour
  uc.checked = forced || tool.useColor; uc.disabled = forced;
  if (uc.syncChecked) uc.syncChecked();
  show($("editTextRow"), tool.op === "write");
  show($("editRainRow"), tool.op === "rain");
  if ($("editRainLen").value !== tool.rainLen) $("editRainLen").value = tool.rainLen;
  show($("editFillRow"), tool.drag === "rect" || tool.drag === "ellipse");
  if ($("editFill").checked !== tool.fill) { $("editFill").checked = tool.fill; if ($("editFill").syncChecked) $("editFill").syncChecked(); }
  show($("editColorRow"), tool.op === "write" || tool.op === "color"); show($("editColorUnderRow"), tool.op === "write" || tool.op === "color");
  $("editColorUnder").checked = !!tool.colorUnder; if ($("editColorUnder").ckUpdate) $("editColorUnder").ckUpdate();
  const sc = selCells();
  show($("editSelRow"), !!sc);
  if (sc) $("editSelInfo").textContent = `${sc.n} cell${sc.n === 1 ? "" : "s"} selected`;
  $("editUndo").disabled = !n; $("editClear").disabled = !n;
  $("editClear").textContent = n ? `Remove all edits (${n})` : "Remove all edits";
  $("editHint").textContent = (tool.on ? EDIT_HINTS[tool.drag === "paint" ? tool.op : tool.drag] + " Option-drag (Alt on Windows) moves the view." : "Click Edit under the preview (or tick the box above), then click or drag over the preview.") +
    " Edits stay on their spot in the picture when you change the size or the look; Reset all removes them.";
  if (viewer) viewer.setEditor(tool.on ? editor : null);
  updateMarks();
  refreshFields();
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
  msgOpacity: ["Opacity", 0, 1, 0.01, pct],
  fillOpacity: ["Opacity", 0, 1, 0.01, pct],
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
  cfShade: ["Darker / lighter", -1, 1, 0.01, (v) => (v > 0 ? "+" : "") + Math.round(v * 100) + "%"],
  cfAngle: ["Angle", 0, 360, 1, (v) => Math.round(v) + "°"],
  cfGradMidpoint: ["Midpoint", 0.05, 0.95, 0.01, pct],
  cfDepthCount: ["Outlines", 1, 12, 1, (v) => String(v)],
  cfDepthPull: ["Perspective", 0.05, 0.6, 0.01, pct],
  cfDepthWidth: ["Line width", 0.02, 0.4, 0.01, pct],
  cfDepthAim: ["Aim at the centre", 0, 1, 0.01, pct],
  cfDepthFade: ["Fade", 0, 1, 0.01, pct],
  echoCount: ["Copies", 1, 16, 1, (v) => String(v)],
  echoStep: ["Spacing", 0.03, 0.6, 0.01, pct],
  echoFade: ["Fade", 0, 1, 0.01, pct],
  echoX: ["Across", 0, 1, 0.01, pct],
  echoY: ["Down", 0, 1, 0.01, pct],
  cfGradSteps: ["Steps", 0, 12, 1, (v) => (v < 2 ? "Smooth" : String(v))],
  cfGradRepeat: ["Repeat", 1, 8, 1, (v) => v + "×"],
  cfSpread: ["Spread", 0.5, 6, 0.1, (v) => v.toFixed(1) + " cells"],
  cfGap: ["Gap", 0, 0.4, 0.01, pct],
  cfRound: ["Round corners", 0, 0.5, 0.01, (v) => Math.round(v * 200) + "%"],
  cfOpacity: ["Opacity", 0, 1, 0.01, pct],
  cfGlitch: ["Glitched cells", 0, 0.6, 0.01, pct],
  cfLines: ["Scanlines", 0, 1, 0.01, pct],
  cfLineCount: ["Lines per cell", 1, 12, 1, (v) => String(v)],
  cfGrain: ["Grain", 0, 1, 0.01, pct],
  cfGrainSize: ["Grain size", 0.02, 0.5, 0.01, pct],
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
  outlineOpacity: ["Stroke opacity", 0, 1, 0.01, pct], // the inner ring when there's an outer one
  outlineFillOpacity: ["Inside opacity", 0, 1, 0.01, pct],
  fillLevel: ["Fill from", 0.05, 0.95, 0.01, pct],
  rainLength: ["Length", 1, 60, 1, (v) => v + " ch"],
  rainLengthVar: ["Length spread", 0, 1, 0.01, pct],
  rainAmount: ["Amount", 0, 1, 0.01, pct],
  rainDistance: ["Fall distance", 1, 200, 1, (v) => v + " ch"],
  rainOutside: ["Off the shape", 0, 1, 0.01, pct],
  rainFade: ["Tail fade", 0, 1, 0.01, pct],
  rainGaps: ["Gaps", 0, 1, 0.01, pct],
  rainAngle: ["Angle", -60, 60, 1, (v) => Math.round(v) + "°"],
  rainCX: ["Across", 0, 1, 0.01, pct],
  rainCY: ["Down", 0, 1, 0.01, pct],
  rainTwist: ["Twist", -1, 1, 0.01, (v) => (v > 0 ? "+" : "") + Math.round(v * 90) + "°"],
  rainHole: ["Clear centre", 0, 0.6, 0.01, pct],
  textArtMargin: ["Margin", 0, 30, 1, (v) => v + " ch"],
  rrLength: ["Length", 1, 60, 1, (v) => v + " ch"],
  rrLengthVar: ["Length spread", 0, 1, 0.01, pct],
  rrFade: ["Fade", 0, 1, 0.01, pct],
  rrGaps: ["Gaps", 0, 1, 0.01, pct],
  outlineRingScale: ["Ring at", 1.1, 5, 0.05, (v) => v.toFixed(2) + "×"],
  outlineRingDensity: ["Density", 0, 1, 0.01, pct],
  outlineRingTwist: ["Twist", -1, 1, 0.01, (v) => (v > 0 ? "+" : "") + Math.round(v * 90) + "°"],
  outlineRingOpacity: ["Ring opacity", 0, 1, 0.01, pct],
  outlineRingFillOpacity: ["Band opacity", 0, 1, 0.01, pct],
  outlineRingFade: ["Band fade", -1, 1, 0.01, (v) => (Math.abs(v) < 0.005 ? "None" : (v > 0 ? "To ring " : "To shape ") + Math.round(Math.abs(v) * 100) + "%")],
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
    cfOn: chance(0.15), cfFill: pickOne(["solid", "gradient", "gradient", "gradient", "depth", "bleed"]), cfDepthCount: pickOne([3, 5, 7]), cfDepthAim: chance(0.4) ? round2(rnd(0.3, 1)) : 0, cfGradShape: pickOne(["linear", "linear", "reflected", "radial", "radial", "diamond", "angle"]),
    cfGradSpan: chance(0.25) ? "image" : "cell", cfGradSteps: chance(0.2) ? pickOne([3, 4, 6]) : 0, cfGradRepeat: chance(0.15) ? pickOne([2, 3]) : 1, cfGradMidOn: chance(0.15), cfGradMid: accent, cfGradReverse: chance(0.3), cfFrom: chance(0.8) ? "glyph" : "image", cfShade: round2(dark ? rnd(-0.7, -0.2) : rnd(0.2, 0.7)),
    cfTo: pickOne(["transparent", "transparent", "dark", "light", "bg", "complement"]), cfAngle: pickOne([90, 90, 45, 135, 0]), cfOpacity: round2(rnd(0.5, 0.95)), cfGap: pickOne([0, 0.04, 0.08]), cfRound: pickOne([0, 0.2, 0.5]),
    cfSpread: round2(rnd(1, 3)), cfBlend: pickOne(["normal", "normal", "screen", "multiply"]), cfGlitch: chance(0.3) ? round2(rnd(0.03, 0.15)) : 0, cfLines: chance(0.25) ? round2(rnd(0.2, 0.6)) : 0, cfGrain: chance(0.3) ? round2(rnd(0.1, 0.4)) : 0,
  });
  if (S.outlineOn) Object.assign(S, { outlineWidth: pickOne([1, 1, 2, 3]), outlinePos: pickOne(["outside", "center", "inside"]), outlineStyle: chance(0.6) ? "lines" : "chars", outlineColor: accent, outlineFill: pickOne(["image", "none", "text"]), outlineFillMode: pickOne(["ramp", "words", "phrase"]),
    outlineRingOn: chance(0.2), outlineRingScale: round2(rnd(1.4, 3)), outlineRingFill: pickOne(["text", "rays", "rain"]), outlineRingDensity: round2(rnd(0.3, 0.8)), outlineRingTwist: chance(0.3) ? round2(rnd(-0.4, 0.4)) : 0 });
  if (chance(0.12)) glitchRecipe(); else S.glitchOn = false;
  lastRandom = JSON.stringify(S);
  syncUI(); schedulePreview(0);
  status("Random look. ↶ goes back; save it under Look to keep it.");
}
function undoRandomize() {
  if (!undoStack.length) return;
  const picture = pictureOf(S);
  S = freshSettings(JSON.parse(undoStack.pop()));
  Object.assign(S, picture); // Randomize doesn't touch the picture, so neither does going back
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
const SELECTS = ["charset", "msgColorFrom", "fillColorFrom", "textMode", "sizeMode", "dither", "colorMode", "bgMode", "gSortDir", "gChannelSwap", "outlinePos", "outlineStyle", "outlineFill", "outlineFillMode", "outlineColorFrom", "outlineRingFill", "outlineRingDir", "outlineRingColorFrom", "outlineRingTextColorFrom", "rainDir", "rainCentre", "cfFill", "cfFrom", "cfTo", "cfBlend", "cfGradShape", "cfGradSpan", "echoDir", "echoCentre", "echoColorMode", "rainFrom", "rainCharset", "rainColorMode", "rrCharset", "rrColorMode"];
const CHECKS = ["textArtFit", "sortByDensity", "invert", "serpentine", "glitchOn", "gradientMid", "keepAlpha", "phraseShade", "phraseWrap", "dropOn", "longOn", "offOn", "glowOn", "glowTextColor", "outlineOn", "outlineRingOn", "outlineRingStroke", "cfOn", "cfOnlyGlyphs", "cfGradMidOn", "cfGradReverse", "echoOn", "echoOutline", "echoRain", "echoText", "rainOn", "rainHead", "rainGradientMid", "rrHead", "rrGradientMid"];
const TEXTS = ["customChars", "extraChars", "outlineChars", "outlineFillChars", "outlineRingChars", "rainChars", "rrChars"];
const APPLY_TEXTS = { customChars: "customApply", extraChars: "extraApply", rainChars: "rainApply", outlineChars: "outlineApply", outlineFillChars: "outlineFillApply", outlineRingChars: "outlineRingApply", rrChars: "rrApply" }; // text box → its Apply button
function refreshApply() {
  for (const [k, btn] of Object.entries(APPLY_TEXTS)) {
    const pending = $(k).value !== S[k];
    $(btn).disabled = !pending; $(btn).classList.toggle("primary", pending);
    const t = pending ? "Apply text" : "Applied"; if ($(btn).textContent !== t) $(btn).textContent = t;
  }
}
let markHidden = loadJSON("gf:markHidden", false); // preview only: show where hidden messages went
let extraOpen = false; // the box for messages and a fill on a built-in character set, opened by its button

// Sections with a badge (plugin/icons/sections/<id>.png, made by tools/make_section_icons.swift)
const SECTION_ICONS = new Set(["taStyle", "taText", "taFont", "taLayout", "taShape", "look", "chars", "outline", "rain", "depth", "edit", "grid", "tone", "color", "shadow", "cells", "glitch", "output", "batch", "inkType", "inkInk", "inkPaper", "inkLayers", "lnStyle", "lnHeight", "lnLines", "lnWidth", "lnColour", "lnUnder", "lnLabels", "lnLayers", "mpArea", "mpLook", "mpAreas", "mpLines", "mpBg", "mpLayers"]);
function buildUI() {
  for (const [key, [label, min, max, step, fmt]] of Object.entries(SLIDERS)) {
    const host = $("sl-" + key);
    host.innerHTML = `<div class="row"><span class="label" title="Double-click the name or the handle to reset">${label}</span>${SLIDER_HTML}<span class="val"></span></div>`;
    const val = host.querySelector(".val"), reset = () => { S[key] = Engine.DEFAULTS[key]; syncUI(); schedulePreview(); };
    const input = makeSlider(host.querySelector(".slider"), min, max, step, (v) => { S[key] = v; val.textContent = fmt(v); schedulePreview(); }, reset);
    onDoubleClick(host.querySelector(".label"), reset);
    onDoubleClick(val, reset);
    sliderEls[key] = { input, val, fmt, row: host };
  }
  let html = "", group = null;
  for (const c of CHARSETS) {
    if (c.group !== group) { group = c.group; html += `<option value="" disabled>— ${group} —</option>`; }
    html += `<option value="${c.id}">${c.name}</option>`;
  }
  $("charset").innerHTML = html;
  $("rainCharset").innerHTML = html; // the rain picks from the same character sets
  $("rrCharset").innerHTML = html; // and so does the outline ring's rain

  for (const k of SELECTS) $(k).addEventListener("change", () => { S[k] = $(k).value; refreshVisibility(); schedulePreview(); });
  $("glitchSeed").addEventListener("change", () => { const v = parseInt($("glitchSeed").value, 10); if (v > 0) S.glitchSeed = v; syncUI(); schedulePreview(0); });
  $("glitchReseed").addEventListener("click", () => { S.glitchSeed = Math.floor(Math.random() * 99999) + 1; syncUI(); schedulePreview(0); });
  $("glitchReset").addEventListener("click", () => { for (const k of GLITCH_KEYS) S[k] = Engine.DEFAULTS[k]; syncUI(); schedulePreview(0); });
  $("glitchRandom").addEventListener("click", randomGlitch);
  const captureRainArt = () => { S.rainArtLook = {}; for (const k of ["colorMode", "fg", "gradient", "gradientMid", "saturation", "colorBoost"]) S.rainArtLook[k] = JSON.parse(JSON.stringify(S[k])); refreshVisibility(); schedulePreview(0); };
  $("rainArtCapture").addEventListener("click", () => { captureRainArt(); status("The rain now keeps the characters' current colours."); });
  $("rainArtLive").addEventListener("click", () => { S.rainArtLook = null; refreshVisibility(); schedulePreview(0); status("The rain follows the characters' colours as they change."); });
  $("rainColorMode").addEventListener("change", () => { if (S.rainColorMode === "art" && !S.rainArtLook) captureRainArt(); });
  $("rainSeed").addEventListener("change", () => { const v = parseInt($("rainSeed").value, 10); if (v > 0) S.rainSeed = v; syncUI(); schedulePreview(0); });
  $("rainReseed").addEventListener("click", () => { S.rainSeed = Math.floor(Math.random() * 99999) + 1; syncUI(); schedulePreview(0); });
  $("rrSeed").addEventListener("change", () => { const v = parseInt($("rrSeed").value, 10); if (v > 0) S.rrSeed = v; syncUI(); schedulePreview(0); });
  $("rrReseed").addEventListener("click", () => { S.rrSeed = Math.floor(Math.random() * 99999) + 1; syncUI(); schedulePreview(0); });
  $("textArtEdit").addEventListener("click", () => showTab("text"));
  $("textArtOff").addEventListener("click", () => { S.textArtOn = false; src = null; syncUI(); fitLayout(true); schedulePreview(0); status("Converting the document's image again. The text art stays in the Text art tab."); });
  $("rrCopy").addEventListener("click", () => { // the Matrix rain's look, into the ring's own settings
    for (const [k, rk] of Object.entries(Engine.RING_RAIN)) S[rk] = JSON.parse(JSON.stringify(S[k]));
    syncUI(); schedulePreview(0); status("The ring's rain now looks like the Matrix rain.");
  });
  $("fillShuffle").addEventListener("click", () => { S.fillSeed = Math.floor(Math.random() * 99999) + 1; schedulePreview(0); });
  for (const k of CHECKS) onCheck($(k), (v) => { S[k] = v; if (v) visibleShadow(k); refreshVisibility(); schedulePreview(); });
  // custom text waits for Apply (half-typed {…} or […] would redraw on every key); the rest is live
  for (const k of TEXTS) if (!APPLY_TEXTS[k]) $(k).addEventListener("input", () => { S[k] = $(k).value; refreshVisibility(); schedulePreview(120); });
  for (const [k, btn] of Object.entries(APPLY_TEXTS)) {
    const apply = () => { S[k] = $(k).value; refreshVisibility(); refreshApply(); schedulePreview(0); };
    $(k).addEventListener("input", refreshApply);
    $(btn).addEventListener("click", apply);
    if (String($(k).tagName).toUpperCase() === "INPUT") $(k).addEventListener("keydown", (e) => { if (e.key === "Enter") setTimeout(apply, 0); }); // one-line boxes: Enter applies
  }
  $("extraOpen").addEventListener("click", () => { extraOpen = true; refreshVisibility(); });
  $("extraClear").addEventListener("click", () => { S.extraChars = ""; extraOpen = false; syncUI(); schedulePreview(0); });
  $("hideMark").checked = markHidden;
  onCheck($("hideMark"), (v) => { markHidden = v; saveJSON("gf:markHidden", v); schedulePreview(0); });
  $("hideMove").addEventListener("click", () => { S.hideSeed = Math.floor(Math.random() * 99999) + 1; schedulePreview(0); });
  $("cfShuffle").addEventListener("click", () => { S.cfSeed = Math.floor(Math.random() * 99999) + 1; schedulePreview(0); });
  $("randomize").addEventListener("click", randomizeAll);
  $("undoRandom").addEventListener("click", undoRandomize);
  onCheck($("editOn"), (v) => setEditMode(v));
  $("editOp").addEventListener("change", () => { tool.op = $("editOp").value; saveTool(); refreshEditUI(); });
  $("editText").addEventListener("input", () => { tool.text = $("editText").value; saveTool(); });
  onCheck($("editUseColor"), (v) => { if (tool.op !== "color") { tool.useColor = v; saveTool(); } });
  onCheck($("editColorUnder"), (v) => { tool.colorUnder = v; saveTool(); refreshEditUI(); });
  $("editDrag").addEventListener("change", () => { tool.drag = $("editDrag").value; saveTool(); setEditMode(tool.on); });
  $("editFromSel").addEventListener("click", editFromSelection);
  $("editApply").addEventListener("click", applySelection);
  onCheck($("editFill"), (v) => { tool.fill = v; saveTool(); });
  $("editRainLen").addEventListener("input", () => { tool.rainLen = $("editRainLen").value.trim(); saveTool(); });
  $("editDeselect").addEventListener("click", () => { cellSel = null; refreshEditUI(); });
  $("editText").addEventListener("keydown", (e) => { if (e.key === "Enter" && cellSel) setTimeout(applySelection, 0); });
  $("editUndo").addEventListener("click", () => { if (!(S.cellEdits || []).length) return; S.cellEdits = S.cellEdits.slice(0, -1); refreshEditUI(); schedulePreview(0); });
  $("editClear").addEventListener("click", () => { S.cellEdits = []; refreshEditUI(); schedulePreview(0); status("Removed all symbol edits."); });

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
  $("refresh").addEventListener("click", () => { src = null; csCache.key = null; forgetArtboards(); schedulePreview(0); scheduleUnder(0); });
  if (typeof document.addEventListener === "function") document.addEventListener("keydown", onUndoKey, true);
  // back in the panel after adding or hiding a layer in the live .psb: show it under the characters
  const backInPanel = () => { if (live && !live.closing) { const d = docById(live.docId); if (d && liveLayerSig(d) !== live.underSig) scheduleUnder(0); } };
  const root = document.body || document.documentElement;
  if (root && root.addEventListener) for (const t of ["mouseenter", "pointerenter"]) root.addEventListener(t, backInPanel);
  $("liveBtn").addEventListener("click", toggleLive);
  $("undoAll").addEventListener("click", undoLast);
  $("resetAll").addEventListener("click", () => {
    S = freshSettings(); editing = null; $("editBox").classList.add("hidden");
    $("fontSearch").value = ""; fillFontSelect(); syncUI(); looks.build(); fitLayout(true);
    status("All settings reset to defaults"); schedulePreview(0);
  });
  fontPicker = makePicker({
    ids: { button: "fontPicker", current: "fontCurrent", chev: "fontChev", panel: "fontPanel", search: "fontSearch", list: "fontList" },
    label: () => (S.font ? S.fontName || S.font : "Built-in (Menlo)"), items: fontItems, selected: () => S.font || "",
    onPick: (ps, it) => setFont(ps, it ? it.label : ps), none: () => "No installed font matches", onToggle: () => fitLayout(true),
  });
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
  setSelect($("applyLayers"), loadJSON("gf:applyLayers", "one"));
  $("applyLayers").addEventListener("change", () => saveJSON("gf:applyLayers", $("applyLayers").value));
  $("batch").addEventListener("click", runBatch);

  looks = makePresetBox({
    $, loadJSON, saveJSON, setSelect, status, errMsg, lfs, formats,
    ids: { select: "preset", reset: "resetBtn", name: "presetName", save: "savePreset", del: "deletePreset", exp: "exportPresets", imp: "importPresets" },
    storeKey: "gf:userPresets", builtIns: PRESETS, builtInLabel: "Built-in looks", fileName: "ascii-by-star-presets.json", fileTag: "asciiByStar",
    current: () => lookOnly(S), apply: applyLook, fresh: freshSettings, onChange: noteChange, undoHint: "↶ Undo brings it back.",
  });

  // the controls under each preview can fold away, leaving more room for the settings
  for (const id of ["ctl", "textCtl", "inkCtl", "lnCtl", "mpCtl"]) {
    const head = $(id + "Head"), body = $(id + "Body"), key = "gf:" + id + "Folded";
    const apply = (f) => { body.classList.toggle("hidden", f); head.querySelector(".chev").textContent = f ? "▸" : "▾"; head.querySelector(".ctlLabel").textContent = f ? "Controls (source, apply, live smart object)" : "Controls"; fitLayout(true); };
    head.addEventListener("click", () => { const f = !body.classList.contains("hidden"); saveJSON(key, f); apply(f); });
    apply(!!loadJSON(key, false));
  }
  setupSections();
}

// ---------- sections ----------
// Each tab's settings are sections that fold (remembered), can be dragged into another order by the grip on
// their heading (remembered per tab), and fold or unfold all at once from buttons in the controls under the preview.
function setupSections() {
  const collapsed = loadJSON("gf:collapsed", { batch: true });
  const sectionsOf = (box) => Array.from(box.childNodes || []).filter((el) => el.classList && el.classList.contains("section"));
  const restripe = (box) => sectionsOf(box).forEach((sec, i) => sec.classList.toggle("alt", i % 2 === 1)); // light and dark bands alternate
  const orderKey = (box) => "gf:sectionOrder:" + box.id;
  const fold = (sec, f) => { collapsed[sec.dataset.section] = f; sec.classList.toggle("collapsed", f); sec.querySelector(".chev").textContent = f ? "▸" : "▾"; };
  for (const [box, controls] of [[$("scroller"), $("ctlBody")], [$("textScroller"), $("textCtlBody")], [$("inkScroller"), $("inkCtlBody")], [$("lnScroller"), $("lnCtlBody")], [$("mpScroller"), $("mpCtlBody")]]) {
    const secs = sectionsOf(box), original = secs.map((x) => x.dataset.section), last = secs[secs.length - 1], after = last ? last.nextSibling : null;
    const place = (order) => { // order: section ids; ones not listed keep their usual place after them
      const byId = new Map(secs.map((x) => [x.dataset.section, x]));
      for (const id of order.concat(original)) if (byId.has(id)) { box.insertBefore(byId.get(id), after); byId.delete(id); }
      restripe(box);
    };
    for (const sec of secs) {
      const k = sec.dataset.section, head = sec.querySelector(".head");
      if (SECTION_ICONS.has(k)) { // a coloured badge, so sections are easy to spot while scrolling
        const b = document.createElement("img");
        b.className = "sicon"; b.setAttribute("src", "icons/sections/" + k + ".png"); b.setAttribute("alt", "");
        head.insertBefore(b, head.querySelector(".chev").nextSibling);
      }
      const grip = document.createElement("span");
      grip.className = "sgrip"; grip.textContent = "⠿"; grip.title = "Drag to move this section";
      head.appendChild(grip);
      grip.addEventListener("click", (e) => { if (e.stopPropagation) e.stopPropagation(); }); // a drag is not a fold
      trackDrag(grip, {
        down: (e) => { sec.classList.add("dragging"); if (e.preventDefault) e.preventDefault(); },
        move: (e) => { // the section goes before the first other section whose middle is below the pointer
          const others = sectionsOf(box).filter((x) => x !== sec);
          const target = others.find((x) => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
          const ref = target || (others.length ? others[others.length - 1].nextSibling : after);
          if (ref !== sec && sec.nextSibling !== ref) { box.insertBefore(sec, ref); restripe(box); }
        },
        up: () => { sec.classList.remove("dragging"); saveJSON(orderKey(box), sectionsOf(box).map((x) => x.dataset.section)); },
      });
      head.addEventListener("click", () => { fold(sec, !collapsed[k]); saveJSON("gf:collapsed", collapsed); });
      fold(sec, !!collapsed[k]);
    }
    place(loadJSON(orderKey(box), []));
    // the buttons for all sections, at the end of the controls under the preview (they fold away with them)
    const bar = document.createElement("div"), btn = (t, tip, fn) => { const x = document.createElement("button"); x.textContent = t; x.title = tip; x.addEventListener("click", fn); bar.appendChild(x); };
    bar.className = "row secBar";
    btn("▸ Collapse all", "Fold every section (handy before dragging them into a new order)", () => { for (const x of sectionsOf(box)) fold(x, true); saveJSON("gf:collapsed", collapsed); });
    btn("▾ Expand all", "Unfold every section", () => { for (const x of sectionsOf(box)) fold(x, false); saveJSON("gf:collapsed", collapsed); });
    btn("Reset order", "Put the sections back in their usual order", () => { saveJSON(orderKey(box), []); place(original); });
    const label = document.createElement("div"); // says what the buttons act on
    label.className = "subhead"; label.textContent = "Settings sections below";
    controls.appendChild(label);
    controls.appendChild(bar);
  }
}

// colour keys: g0..g2 are the gradient stops, rg0..rg2 the rain's, rrg0..rrg2 the ring rain's, anything else is a setting name (fg, bg, dropColor, …)
const GRADIENTS = { g: "gradient", rg: "rainGradient", rrg: "rrGradient" };
const gradKey = (k) => { const m = /^(g|rg|rrg)(\d)$/.exec(k); return m ? [GRADIENTS[m[1]], Number(m[2])] : null; };
function getColor(k) { if (k === "editColor") return tool.color; const g = gradKey(k); return g ? S[g[0]][g[1]] : S[k]; }
function setColor(k, hex) {
  if (k === "editColor") { tool.color = hex; saveTool(); syncUI(); return; } // the edit tool's colour, not the look's
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
  refreshApply();
  $("glitchSeed").value = String(S.glitchSeed);
  $("rainSeed").value = String(S.rainSeed);
  $("rrSeed").value = String(S.rrSeed);
  $("undoRandom").disabled = !undoStack.length;
  if (allFonts.length) fillFontSelect();
  document.querySelectorAll(".swatch").forEach((el) => { el.style.backgroundColor = getColor(el.dataset.color); });
  document.querySelectorAll(".hex").forEach((el) => { el.value = getColor(el.dataset.hex); });
  refreshEditUI();
  refreshVisibility();
}
function refreshVisibility() {
  const show = (el, on) => el.classList.toggle("hidden", !on);
  const custom = S.charset === "custom", mode = custom ? S.textMode : "ramp";
  show($("customRows"), custom);
  const parsed = Engine.customOf(S), extra = !custom && (extraOpen || !!S.extraChars || $("extraChars").value !== "");
  show($("extraRows"), !custom); show($("extraOpenRow"), !custom && !extra); show($("extraBox"), extra);
  show($("hideRow"), !!parsed && parsed.messages.length > 0);
  show($("fillRows"), !!(parsed && parsed.fill));
  show(sliderEls.fillLevel.row, !!(parsed && parsed.fill && (!custom || parsed.text.trim())));
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
  show($("msgColorRow"), S.msgColorFrom === "own"); show($("fillColorRow"), S.fillColorFrom === "own");
  show($("gradRows"), S.colorMode === "gradient");
  for (const id of ["gradMidSwatch", "gradMidHex"]) $(id).style.opacity = S.gradientMid ? "" : "0.35";
  show($("outlineRows"), !!S.outlineOn);
  show($("outlineCharsRow"), S.outlineStyle === "chars");
  show($("outlineFillRows"), S.outlineFill === "text");
  show(sliderEls.outlineFillOpacity.row, S.outlineFill !== "none");
  show($("origRows"), S.colorMode === "original");
  show($("bgRow"), S.bgMode !== "transparent");
  show($("keepAlphaRow"), S.bgMode !== "transparent");
  show($("dropRows"), !!S.dropOn); show($("longRows"), !!S.longOn); show($("offRows"), !!S.offOn); show($("glowRows"), !!S.glowOn);
  show($("cfRows"), !!S.cfOn);
  show($("cfToRows"), S.cfFill === "gradient"); show($("cfGradRows"), S.cfFill === "gradient"); show($("cfDepthRows"), S.cfFill === "depth");
  show($("cfFadeRows"), S.cfFill === "gradient" || S.cfFill === "depth"); show($("cfToColorRow"), S.cfTo === "custom"); show($("cfGradMidRow"), !!S.cfGradMidOn);
  show($("echoRows"), !!S.echoOn); show($("echoPointRows"), S.echoCentre === "point"); show($("echoColorRow"), S.echoColorMode === "tint");
  show(sliderEls.cfAngle.row, S.cfGradShape === "linear" || S.cfGradShape === "reflected" || S.cfGradShape === "angle"); show(sliderEls.cfSpread.row, S.cfFill === "bleed"); show($("cfTileRows"), S.cfFill !== "bleed");
  show(sliderEls.cfLineCount.row, S.cfLines > 0); show(sliderEls.cfGrainSize.row, S.cfGrain > 0); show($("cfSeedRow"), S.cfGlitch > 0 || S.cfGrain > 0);
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
  show($("textArtBox"), !!S.textArtOn); show(sliderEls.textArtMargin.row, !!S.textArtFit);
  if (S.textArtOn) $("textArtLabel").textContent = `Text art${S.textArtFont ? " · " + S.textArtFont : ""} (instead of the image)`;
  show($("rainCharsRow"), S.rainCharset === "custom");
  show(sliderEls.rainDistance.row, S.rainFrom !== "everywhere");
  const radial = S.rainDir === "out" || S.rainDir === "in";
  show($("rainRadialRows"), radial); show($("rainPointRows"), S.rainCentre === "point"); show(sliderEls.rainAngle.row, !radial);
  show($("outlineRingRows"), !!S.outlineRingOn); show($("outlineRingTextRows"), S.outlineRingFill === "text" || S.outlineRingFill === "rays");
  show($("outlineRingRayRows"), S.outlineRingFill === "rays" || S.outlineRingFill === "rain"); show(sliderEls.outlineRingDensity.row, S.outlineRingFill !== "none");
  show(sliderEls.rainOutside.row, S.rainFrom === "everywhere");
  show($("rainColorRow"), S.rainColorMode === "own");
  show($("outlineColorRow"), S.outlineColorFrom === "own");
  show($("rainArtRow"), S.rainColorMode === "art");
  $("rainArtInfo").textContent = S.rainArtLook ? `Kept: ${{ mono: "single colour", original: "the image's colours", gradient: "gradient" }[S.rainArtLook.colorMode] || ""}` : "Following the Colour section";
  $("rainArtLive").disabled = !S.rainArtLook;
  show($("rainGradRows"), S.rainColorMode === "gradient");
  for (const id of ["rainMidSwatch", "rainMidHex"]) $(id).style.opacity = S.rainGradientMid ? "" : "0.35";
  show($("outlineRingRainRows"), S.outlineRingFill === "rain");
  show($("outlineRingStrokeRows"), !!S.outlineRingStroke); show($("outlineRingColorRow"), S.outlineRingColorFrom === "own");
  show($("outlineRingTextColorRows"), S.outlineRingFill === "text" || S.outlineRingFill === "rays"); show($("outlineRingTextColorRow"), S.outlineRingTextColorFrom === "own");
  show($("outlineRingBandRows"), S.outlineRingFill !== "none"); show($("rrCharsRow"), S.rrCharset === "custom");
  show($("rrColorRow"), S.rrColorMode === "own"); show($("rrGradRows"), S.rrColorMode === "gradient");
  for (const id of ["rrMidSwatch", "rrMidHex"]) $(id).style.opacity = S.rrGradientMid ? "" : "0.35";
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
// Font picker (picker.js): every installed font, recent ones first, or those the search finds.
let fontPicker = null;
function fontItems(q) {
  const recent = loadJSON("gf:recentFonts", []), it = (f) => ({ id: f.ps, label: f.name, font: `'${f.ps}', '${f.family || f.name}'` });
  if (q) return allFonts.filter((f) => f.name.toLowerCase().includes(q) || f.ps.toLowerCase().includes(q)).map(it);
  const rec = recent.map((ps) => allFonts.find((f) => f.ps === ps)).filter(Boolean);
  return [{ id: "", label: "Built-in (Menlo, fastest)" }].concat(rec.concat(allFonts.filter((f) => !recent.includes(f.ps))).map(it));
}
const fillFontSelect = () => { if (fontPicker) fontPicker.fill(); };
function setFont(ps, name) {
  S.font = ps || ""; S.fontName = ps ? name || ps : "";
  if (ps) saveJSON("gf:recentFonts", [ps].concat(loadJSON("gf:recentFonts", []).filter((x) => x !== ps)).slice(0, 8));
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
  el.syncChecked = () => { last = el.checked; if (el.ckUpdate) el.ckUpdate(); };
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
  const ids = TAB_IDS[tab], top = $(ids.top), other = tab === "ink" ? ink : tab === "lines" ? lines : tab === "map" ? mapTab : tab === "text" ? textTab : null;
  const setH = (el, prop, px) => { const v = px + "px"; if (el.style[prop] !== v) el.style[prop] = v; };
  const v = tab === "ascii" ? viewer : other && other.viewer;
  if (v) v.layout(H);
  if (!force && H === lastH && top.offsetHeight === lastTop) return;
  lastH = H; lastTop = top.offsetHeight;
  setH($(ids.scroller), "height", Math.max(60, H - ($("tabs").offsetHeight || 0) - top.offsetHeight));
  if (other) other.relayout(); else if (viewer) viewer.relayout(); // keep the preview centred in the new size
}

// Each tab's top area, settings scroller, tab button and tool.
const TAB_IDS = {
  ascii: { top: "top", scroller: "scroller", btn: "tabAscii", tool: "asciiTool" },
  text: { top: "textTop", scroller: "textScroller", btn: "tabText", tool: "textTool" },
  ink: { top: "inkTop", scroller: "inkScroller", btn: "tabInk", tool: "inkTool" },
  lines: { top: "lnTop", scroller: "lnScroller", btn: "tabLines", tool: "lnTool" },
  map: { top: "mpTop", scroller: "mpScroller", btn: "tabMap", tool: "mapTool" },
};
function showTab(t) {
  tab = TAB_IDS[t] ? t : "ascii";
  saveJSON("gf:tab", tab);
  for (const [k, ids] of Object.entries(TAB_IDS)) { $(ids.btn).classList.toggle("on", k === tab); $(ids.tool).classList.toggle("hidden", k !== tab); }
  fitLayout(true);
  if (ink) { if (tab === "ink") ink.activate(); else ink.deactivate(); }
  if (lines) { if (tab === "lines") lines.activate(); else lines.deactivate(); }
  if (mapTab) { if (tab === "map") mapTab.activate(); else mapTab.deactivate(); }
  if (textTab) { if (tab === "text") textTab.activate(); else textTab.deactivate(); }
  if (tab === "ascii") { if (src) src.stale = true; schedulePreview(0); }
}

// ---------- Photoshop events ----------
let staleTimer = null;
function onPsEvent(evt, desc) {
  if (evt === "historyStateChanged") { // only watched for the live .psb (see readLiveUnder)
    const id = desc && (desc.documentID != null ? desc.documentID : desc.documentId);
    if (live && !live.closing && !busy && Date.now() > underQuietUntil && (id != null ? id === live.docId : (activeDoc() || {}).id === live.docId) && !/^Live update$/.test(String((desc && desc.name) || ""))) scheduleUnder();
    return;
  }
  forgetArtboards(); // a document or layer changed: look at the artboards again
  if (live && evt === "close" && !docById(live.docId)) { live = null; updateLiveBtn(); }
  if (tab === "ink") { if (src) src.stale = true; if (ink) ink.onPsEvent(evt, desc); return; }
  if (tab === "lines") { if (src) src.stale = true; if (lines) lines.onPsEvent(evt, desc); return; }
  if (tab === "map") { if (src) src.stale = true; if (mapTab) mapTab.onPsEvent(evt, desc); return; }
  if (tab === "text") { if (src) src.stale = true; return; } // the lettering doesn't depend on the document
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
  enhanceAllFields(); // likewise
  viewer = makeViewer();
  buildUI();
  syncUI();
  ink = setupInk({ $, loadJSON, saveJSON, errMsg, toRGBA8, makeImageData, convertOut, createLayer, findLayers, findLayerById, bitDepth, isGray, checkDoc, activeDoc, askColor, selectLayer, docBaseName, fitLayout, onCheck, refreshFields });
  lines = setupLines({ $, loadJSON, saveJSON, errMsg, setSelect, baseAtlas: () => baseAtlas, mapArea: () => mapTab && mapTab.area(), showTab, createLayer, bitDepth, isGray, checkDoc, activeDoc, askColor, selectLayer, docBaseName, fitLayout, onCheck, refreshFields });
  mapTab = setupMap({ $, loadJSON, saveJSON, errMsg, setSelect, baseAtlas: () => baseAtlas, createLayer, bitDepth, isGray, activeDoc, askColor, docBaseName, fitLayout, onCheck, refreshFields, onAreaToLines: () => { lines.useMap(); showTab("lines"); } });
  textTab = setupTextArt({ $, loadJSON, saveJSON, errMsg, setSelect, fitLayout, onCheck, refreshFields, atlasFor, baseAtlas: () => baseAtlas, useArt });
  for (const k of Object.keys(TAB_IDS)) $(TAB_IDS[k].btn).addEventListener("click", () => showTab(k));
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
  try { await action.addNotificationListener(["historyStateChanged"], onPsEvent); } catch (e) { console.error(e); } // apart: older builds may refuse it
  if (tab === "ascii") schedulePreview(0); // the other tabs started their own previews in showTab
  else if (tab === "text") textTab.activate(); // now that the glyphs are here
  setTimeout(() => loadFonts(), 300);
}
init();
