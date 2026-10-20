"use strict";
const { app, core, action, imaging, constants } = require("photoshop");
const uxp = require("uxp");
const lfs = uxp.storage.localFileSystem;
const formats = uxp.storage.formats;
const Engine = require("./engine.js");
const { CHARSETS } = require("./charsets.js");
const { PRESETS } = require("./presets.js");

const $ = (id) => document.getElementById(id);
const TAG_RE = /#([a-z0-9]{6})$/;
const ANALYSIS_MAX = 1600; // long side of the cached analysis image
const PREVIEW_MAX = 560;

let atlas = null;
let S = freshSettings(loadJSON("gf:last", null));
let src = null; // cached analysis pixels {docId, layerId, scale, docW, docH, w, h, data, stale}
let busy = false;
let editing = null; // {docId, layerId, tag, name, sourceLayerId}
let focus = { x: 0.5, y: 0.5 };
let lastView = null;
let userPresets = loadJSON("gf:userPresets", []);

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
function setSelect(el, v) { for (const o of el.options) o.selected = o.value === String(v); el.value = String(v); }
function activeDoc() { try { return app.activeDocument || null; } catch (e) { return null; } }
function bitDepth(doc) { const b = String(doc.bitsPerChannel); return b.includes("32") ? 32 : b.includes("16") ? 16 : 8; }
function isGray(doc) { return /gray/i.test(String(doc.mode)); }
function checkDoc(doc) {
  if (!doc) throw new Error("Open a document first.");
  if (!/rgb|gray/i.test(String(doc.mode))) throw new Error("ASCII by Star needs an RGB or Grayscale document (Image ▸ Mode ▸ RGB Color).");
}
function findLayers(layers, pred, out = []) {
  for (const l of layers) { if (pred(l)) out.push(l); if (l.layers && l.layers.length) findLayers(l.layers, pred, out); }
  return out;
}
function findLayerById(doc, id) { return findLayers(doc.layers, (l) => l.id === id)[0] || null; }
function newTag() { let t = ""; for (let i = 0; i < 6; i++) t += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]; return t; }
function charsetInfo() { return CHARSETS.find((c) => c.id === S.charset) || CHARSETS[0]; }
function docBaseName(doc) { return String((doc && doc.title) || "ascii").replace(/\.[^.]+$/, ""); }

let csCache = { key: null, cs: null };
function currentCharset() {
  const info = charsetInfo();
  const chars = info.id === "custom" ? S.customChars : info.chars;
  const key = info.id + "|" + chars + "|" + S.sortByDensity;
  if (csCache.key !== key) csCache = { key, cs: Engine.buildCharset(atlas, chars, S.sortByDensity) };
  return csCache.cs;
}

async function loadAtlas() {
  const folder = await lfs.getPluginFolder();
  const meta = JSON.parse(await (await folder.getEntry("atlas.json")).read({ format: formats.utf8 }));
  const bin = await (await folder.getEntry("atlas.bin")).read({ format: formats.binary });
  return Engine.prepareAtlas(meta, new Uint8Array(bin));
}

// ---------- pixel I/O ----------
async function toRGBA8(id) {
  const raw = await id.getData({ chunky: true });
  const n = id.width * id.height, c = id.components, out = new Uint8ClampedArray(n * 4);
  const cs = id.componentSize || (raw instanceof Float32Array ? 32 : raw instanceof Uint16Array ? 16 : 8);
  const conv = cs === 16 ? (v) => (v * 255) / 32768 : cs === 32 ? (v) => 255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) : (v) => v;
  const convA = cs === 16 ? (v) => (v * 255) / 32768 : cs === 32 ? (v) => v * 255 : (v) => v;
  const hasA = c === 2 || c === 4, gray = c <= 2;
  for (let i = 0, b = 0, o = 0; i < n; i++, b += c, o += 4) {
    if (gray) { const g = conv(raw[b]); out[o] = out[o + 1] = out[o + 2] = g; }
    else { out[o] = conv(raw[b]); out[o + 1] = conv(raw[b + 1]); out[o + 2] = conv(raw[b + 2]); }
    out[o + 3] = hasA ? convA(raw[b + c - 1]) : 255;
  }
  return out;
}

// Reads the document (merged, without ASCII by Star layers) or one layer into a doc-sized RGBA buffer.
// Must run inside executeAsModal. ownHistory: wrap temporary visibility changes in a history suspension.
async function capture(ctx, doc, layerId, scale, ownHistory) {
  const docW = doc.width, docH = doc.height;
  const aw = Math.max(1, Math.round(docW * scale)), ah = Math.max(1, Math.round(docH * scale));
  let hidden = [], sid = null;
  if (layerId === null) {
    hidden = findLayers(doc.layers, (l) => TAG_RE.test(l.name) && l.visible);
    if (hidden.length && ownHistory) { try { sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "ASCII by Star sample" }); } catch (e) { sid = null; } }
    for (const l of hidden) l.visible = false;
  }
  try {
    const opts = { documentID: doc.id, componentSize: 8, applyAlpha: false };
    if (layerId !== null) opts.layerID = layerId;
    if (scale < 1) opts.targetSize = { width: aw, height: ah };
    let res;
    try { res = await imaging.getPixels(opts); }
    catch (e) {
      // Some documents (artboards, smart objects that need refreshing) refuse a composite read.
      // Fall back to a temporary "stamp visible" layer and read that instead.
      if (layerId !== null) throw new Error("Reading the layer failed (" + errMsg(e) + "). Try Source: Visible (merged).");
      res = await readViaStamp(ctx, doc, opts, ownHistory);
    }
    const id = res.imageData, iw = id.width, ih = id.height;
    const px = await toRGBA8(id);
    id.dispose();
    const b = res.sourceBounds || { left: 0, top: 0, right: docW, bottom: docH };
    const out = new Uint8Array(aw * ah * 4);
    const bx0 = b.left * scale, by0 = b.top * scale, bw = Math.max(1e-6, (b.right - b.left) * scale), bh = Math.max(1e-6, (b.bottom - b.top) * scale);
    const dx0 = Math.max(0, Math.floor(bx0)), dx1 = Math.min(aw, Math.ceil(bx0 + bw));
    const dy0 = Math.max(0, Math.floor(by0)), dy1 = Math.min(ah, Math.ceil(by0 + bh));
    const sxOf = new Int32Array(Math.max(0, dx1 - dx0));
    for (let dx = dx0; dx < dx1; dx++) sxOf[dx - dx0] = Math.min(iw - 1, Math.max(0, Math.floor(((dx + 0.5 - bx0) / bw) * iw)));
    for (let dy = dy0; dy < dy1; dy++) {
      const sy = Math.min(ih - 1, Math.max(0, Math.floor(((dy + 0.5 - by0) / bh) * ih)));
      for (let dx = dx0; dx < dx1; dx++) {
        const s = (sy * iw + sxOf[dx - dx0]) * 4, o = (dy * aw + dx) * 4;
        out[o] = px[s]; out[o + 1] = px[s + 1]; out[o + 2] = px[s + 2]; out[o + 3] = px[s + 3];
      }
    }
    return { docId: doc.id, layerId, scale, docW, docH, w: aw, h: ah, data: out, stale: false };
  } finally {
    for (const l of hidden) l.visible = true;
    if (sid !== null) { try { await ctx.hostControl.resumeHistory(sid, false); } catch (e) { try { await ctx.hostControl.resumeHistory(sid, true); } catch (e2) { /* ignore */ } } }
  }
}

async function readViaStamp(ctx, doc, opts, ownHistory) {
  let sid = null, stamp = null;
  if (ownHistory) { try { sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "ASCII by Star sample" }); } catch (e) { sid = null; } }
  try {
    await action.batchPlay([{ _obj: "mergeVisible", duplicate: true }], { synchronousExecution: true });
    stamp = doc.activeLayers && doc.activeLayers[0];
    if (!stamp) throw new Error("no merged layer");
    const o = Object.assign({}, opts, { layerID: stamp.id });
    return await imaging.getPixels(o);
  } catch (e) {
    throw new Error("Reading the image failed (" + errMsg(e) + "). Make sure at least one layer is visible.");
  } finally {
    if (stamp) { try { await stamp.delete(); } catch (e) { /* rolled back below */ } }
    if (sid !== null) { try { await ctx.hostControl.resumeHistory(sid, false); } catch (e) { try { await ctx.hostControl.resumeHistory(sid, true); } catch (e2) { /* ignore */ } } }
  }
}

function sourceLayerId(doc) {
  if ($("source").value !== "layer") return null;
  if (editing && editing.docId === doc.id && editing.sourceLayerId != null && findLayerById(doc, editing.sourceLayerId)) return editing.sourceLayerId;
  const al = doc.activeLayers && doc.activeLayers[0];
  if (al && !TAG_RE.test(al.name) && al.kind !== constants.LayerKind.GROUP && String(al.kind) !== "group") return al.id;
  if (src && src.docId === doc.id && src.layerId != null && findLayerById(doc, src.layerId)) return src.layerId;
  return al ? al.id : null;
}
function baseScale(doc) { return Math.min(1, ANALYSIS_MAX / Math.max(doc.width, doc.height)); }
// analysis resolution needed so every character cell gets ~3x3 real source pixels
function neededScale(doc) {
  const geo = Engine.computeGeometry(doc.width, doc.height, S, atlas);
  return Math.min(1, Math.max(baseScale(doc), (geo.cols * 4.5) / doc.width, (geo.rows * 4.5) / doc.height));
}

async function ensureSource(minScale) {
  const doc = activeDoc();
  if (!doc) { src = null; return false; }
  checkDoc(doc);
  const scale = Math.max(baseScale(doc), Math.min(1, minScale || 0));
  const layerId = sourceLayerId(doc);
  if (src && !src.stale && src.docId === doc.id && src.layerId === layerId && src.docW === doc.width && src.docH === doc.height && src.scale >= scale - 1e-6) return true;
  busy = true;
  try { src = await core.executeAsModal((ctx) => capture(ctx, doc, layerId, scale, true), { commandName: "ASCII by Star: read pixels" }); }
  finally { busy = false; }
  return true;
}

function convertOut(rgba, n, depth, gray) {
  if (gray) {
    const out = depth === 32 ? new Float32Array(n * 2) : depth === 16 ? new Uint16Array(n * 2) : new Uint8Array(n * 2);
    for (let i = 0; i < n; i++) {
      const L = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2], a = rgba[i * 4 + 3];
      if (depth === 32) { out[i * 2] = Math.pow(L / 255, 2.2); out[i * 2 + 1] = a / 255; }
      else if (depth === 16) { out[i * 2] = Math.round((L * 32768) / 255); out[i * 2 + 1] = Math.round((a * 32768) / 255); }
      else { out[i * 2] = Math.round(L); out[i * 2 + 1] = a; }
    }
    return out;
  }
  if (depth === 8) return rgba;
  if (depth === 16) { const out = new Uint16Array(n * 4); for (let i = 0; i < n * 4; i++) out[i] = Math.round((rgba[i] * 32768) / 255); return out; }
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) out[i] = (i & 3) === 3 ? rgba[i] / 255 : Math.pow(rgba[i] / 255, 2.2);
  return out;
}

async function makeImageData(buf, w, h, gray, profile) {
  const base = { width: w, height: h, components: gray ? 2 : 4, chunky: true, colorSpace: gray ? "Grayscale" : "RGB" };
  if (profile) { try { return await imaging.createImageDataFromBuffer(buf, Object.assign({ colorProfile: profile }, base)); } catch (e) { /* fall through */ } }
  return await imaging.createImageDataFromBuffer(buf, base);
}

// Renders the grid into a layer, in horizontal strips to keep memory low. Inside executeAsModal.
async function writeLayer(doc, layer, grid, cs) {
  const docW = doc.width, docH = doc.height, depth = bitDepth(doc), gray = isGray(doc);
  let profile = null;
  try { profile = doc.colorProfileName || null; } catch (e) { profile = null; }
  const stripH = Math.max(1, Math.min(docH, Math.floor(4e6 / docW)));
  for (let y0 = 0; y0 < docH; y0 += stripH) {
    const h = Math.min(stripH, docH - y0);
    const rgba = Engine.render(grid, cs, atlas, S, { x: 0, y: y0, w: docW, h, scale: 1 });
    const id = await makeImageData(convertOut(rgba, docW * h, depth, gray), docW, h, gray, profile);
    try { await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: id, replace: y0 === 0, targetBounds: { left: 0, top: y0 }, commandName: "ASCII by Star" }); }
    catch (e) { id.dispose(); throw new Error("Writing the layer failed (" + errMsg(e) + ")."); }
    id.dispose();
  }
}

async function createLayer(doc, name) {
  if (typeof doc.createPixelLayer === "function") return await doc.createPixelLayer({ name });
  return await doc.createLayer({ name });
}

// ---------- preview ----------
let pvTimer = null, pvRunning = false, pvAgain = false;
function schedulePreview(delay) {
  saveJSON("gf:last", S);
  clearTimeout(pvTimer);
  pvTimer = setTimeout(runPreview, delay === undefined ? 40 : delay);
}
async function runPreview() {
  if (pvRunning) { pvAgain = true; return; }
  pvRunning = true;
  try { await renderPreview(); } catch (e) { console.error(e); status(errMsg(e), true); }
  pvRunning = false;
  if (pvAgain) { pvAgain = false; schedulePreview(0); }
}
function showPreviewMsg(t) { const m = $("previewMsg"); m.textContent = t; m.classList.remove("hidden"); $("preview").classList.add("hidden"); }

async function renderPreview() {
  if (!atlas) return;
  const ok = await ensureSource(0);
  if (!ok) { showPreviewMsg("Open a document to begin"); status(""); return; }
  const cs = currentCharset();
  const geo = Engine.computeGeometry(src.docW, src.docH, S, atlas);
  const grid = Engine.computeGrid(src, geo, S, cs);
  const docW = src.docW, docH = src.docH, zoom = $("zoom").value;
  let view;
  if (zoom === "fit") {
    const sc = Math.min(PREVIEW_MAX / docW, PREVIEW_MAX / docH);
    view = { x: 0, y: 0, w: Math.max(1, Math.round(docW * sc)), h: Math.max(1, Math.round(docH * sc)), scale: sc };
  } else {
    const z = Number(zoom);
    const w = Math.max(1, Math.min(PREVIEW_MAX, Math.round(docW * z))), h = Math.max(1, Math.min(Math.round(PREVIEW_MAX * 0.8), Math.round(docH * z)));
    const vw = w / z, vh = h / z;
    view = { x: Math.max(0, Math.min(docW - vw, focus.x * docW - vw / 2)), y: Math.max(0, Math.min(docH - vh, focus.y * docH - vh / 2)), w, h, scale: z };
  }
  lastView = view;
  const rgb = Engine.flattenForPreview(Engine.render(grid, cs, atlas, S, view), view.w, view.h);
  const id = await imaging.createImageDataFromBuffer(rgb, { width: view.w, height: view.h, components: 3, chunky: true, colorProfile: "sRGB IEC61966-2.1", colorSpace: "RGB" });
  const b64 = await imaging.encodeImageData({ imageData: id, base64: true });
  id.dispose();
  const img = $("preview");
  img.src = "data:image/jpeg;base64," + b64;
  img.classList.remove("hidden");
  $("previewMsg").classList.add("hidden");
  const lowRes = src.scale < neededScale(activeDoc() || { width: docW, height: docH }) - 1e-6;
  status(`${geo.cols} × ${geo.rows} chars · ${geo.size.toFixed(1)}px · ${cs.n} glyphs${lowRes ? " · preview sampled at reduced res" : ""}`);
}

// ---------- actions ----------
function layerName(tag) { return `ASCII by Star · ${charsetInfo().name.replace("…", "")} #${tag}`; }
function rememberLayer(tag, sourceLayer) { saveJSON("gf:layer:" + tag, { settings: S, source: $("source").value, sourceLayerId: sourceLayer }); }

async function applyRaster(update) {
  const doc = activeDoc();
  try { checkDoc(doc); } catch (e) { return status(e.message, true); }
  if (update && (!editing || editing.docId !== doc.id)) return status("The edited layer is in another document. Switch back to it.", true);
  busy = true;
  status("Rendering…");
  const t0 = Date.now();
  try {
    let info = null;
    await core.executeAsModal(async (ctx) => {
      const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: update ? "ASCII by Star update" : "ASCII by Star" });
      try {
        const layerId = sourceLayerId(doc);
        src = await capture(ctx, doc, layerId, neededScale(doc), false);
        const cs = currentCharset();
        const geo = Engine.computeGeometry(doc.width, doc.height, S, atlas);
        const grid = Engine.computeGrid(src, geo, S, cs);
        let layer, tag;
        if (update) {
          layer = findLayerById(doc, editing.layerId);
          if (!layer) throw new Error("The layer being edited no longer exists.");
          tag = editing.tag;
        } else {
          tag = newTag();
          layer = await createLayer(doc, layerName(tag));
        }
        await writeLayer(doc, layer, grid, cs);
        rememberLayer(tag, layerId);
        info = `${geo.cols} × ${geo.rows} chars`;
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
  const doc = activeDoc();
  checkDoc(doc);
  await ensureSource(neededScale(doc));
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
          fontName: $("font").value || "Menlo-Regular",
          textColor: color,
          position: { x: (geo.cellW - geo.glyphW) / 2, y: baseline },
        });
        try { layer.name = `ASCII by Star text · ${charsetInfo().name.replace("…", "")}`; } catch (e) { /* keep default name */ }
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

async function copyText() {
  try {
    const { cs, grid } = await outputGrid();
    await navigator.clipboard.setContent({ "text/plain": Engine.toText(grid, cs) });
    status("Copied to clipboard");
  } catch (e) { console.error(e); status(errMsg(e), true); }
}

function loadSelectedLayer() {
  const doc = activeDoc();
  const l = doc && doc.activeLayers && doc.activeLayers[0];
  const m = l && String(l.name).match(TAG_RE);
  if (!m) return status("Select a layer made by ASCII by Star (its name ends in #xxxxxx).", true);
  const rec = loadJSON("gf:layer:" + m[1], null);
  if (!rec) return status("No saved settings for this layer on this computer.", true);
  S = freshSettings(rec.settings);
  setSelect($("source"), rec.source || "merged");
  editing = { docId: doc.id, layerId: l.id, tag: m[1], name: l.name, sourceLayerId: rec.sourceLayerId == null ? null : rec.sourceLayerId };
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
            const sample = await capture(ctx, d, null, neededScale(d), false);
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
};
const GLITCH_KEYS = Object.keys(Engine.DEFAULTS).filter((k) => /^g[A-Z]/.test(k));

function randomGlitch() {
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
  syncUI(); schedulePreview(0);
}
const sliderEls = {};

function buildUI() {
  for (const [key, [label, min, max, step, fmt]] of Object.entries(SLIDERS)) {
    const host = $("sl-" + key);
    host.innerHTML = `<div class="row"><span class="label" title="Double-click to reset">${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><span class="val"></span></div>`;
    const input = host.querySelector("input"), val = host.querySelector(".val");
    input.addEventListener("input", () => { S[key] = parseFloat(input.value); val.textContent = fmt(S[key]); schedulePreview(); });
    host.querySelector(".label").addEventListener("dblclick", () => { S[key] = Engine.DEFAULTS[key]; syncUI(); schedulePreview(); });
    sliderEls[key] = { input, val, fmt, row: host };
  }
  let html = "", group = null;
  for (const c of CHARSETS) {
    if (c.group !== group) { group = c.group; html += `<option value="" disabled>— ${group} —</option>`; }
    html += `<option value="${c.id}">${c.name}</option>`;
  }
  $("charset").innerHTML = html;

  const bindSelect = (id, key, after) => $(id).addEventListener("change", () => { S[key] = $(id).value; if (after) after(); refreshVisibility(); schedulePreview(); });
  bindSelect("charset", "charset");
  bindSelect("sizeMode", "sizeMode");
  bindSelect("dither", "dither");
  bindSelect("colorMode", "colorMode");
  bindSelect("bgMode", "bgMode");
  bindSelect("gSortDir", "gSortDir");
  bindSelect("gChannelSwap", "gChannelSwap");
  $("glitchSeed").addEventListener("change", () => { const v = parseInt($("glitchSeed").value, 10); if (v > 0) S.glitchSeed = v; syncUI(); schedulePreview(0); });
  $("glitchReseed").addEventListener("click", () => { S.glitchSeed = Math.floor(Math.random() * 99999) + 1; syncUI(); schedulePreview(0); });
  $("glitchReset").addEventListener("click", () => { for (const k of GLITCH_KEYS) S[k] = Engine.DEFAULTS[k]; syncUI(); schedulePreview(0); });
  $("glitchRandom").addEventListener("click", randomGlitch);
  const bindCheck = (id, key) => $(id).addEventListener("change", () => { S[key] = $(id).checked; refreshVisibility(); schedulePreview(); });
  bindCheck("sortByDensity", "sortByDensity");
  bindCheck("invert", "invert");
  bindCheck("serpentine", "serpentine");
  bindCheck("glitchOn", "glitchOn");
  bindCheck("gradientMid", "gradientMid");
  $("customChars").addEventListener("input", () => { S.customChars = $("customChars").value; schedulePreview(120); });

  document.querySelectorAll(".swatch").forEach((el) => el.addEventListener("click", () => pickColor(el.dataset.color)));
  document.querySelectorAll(".hex").forEach((el) => el.addEventListener("change", () => {
    const v = el.value.trim().replace(/^#?/, "#");
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) setColor(el.dataset.hex, Engine.rgbToHex(...Engine.hexToRgb(v)));
    else syncUI();
  }));
  $("useFg").addEventListener("click", () => { try { setColor("fg", "#" + app.foregroundColor.rgb.hexValue.toLowerCase()); } catch (e) { status(errMsg(e), true); } });
  $("useBg").addEventListener("click", () => { try { setColor("bg", "#" + app.backgroundColor.rgb.hexValue.toLowerCase()); } catch (e) { status(errMsg(e), true); } });

  $("zoom").addEventListener("change", () => schedulePreview(0));
  $("source").addEventListener("change", () => { src = null; schedulePreview(0); });
  $("refresh").addEventListener("click", () => { src = null; csCache.key = null; schedulePreview(0); });
  $("preview").addEventListener("click", (e) => {
    if (!lastView || !src) return;
    const img = $("preview"), r = img.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    focus = { x: (lastView.x + (fx * lastView.w) / lastView.scale) / src.docW, y: (lastView.y + (fy * lastView.h) / lastView.scale) / src.docH };
    if ($("zoom").value === "fit") setSelect($("zoom"), "1");
    schedulePreview(0);
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
  $("batch").addEventListener("click", runBatch);

  $("preset").addEventListener("change", () => applyPreset($("preset").value));
  $("resetBtn").addEventListener("click", () => { S = freshSettings(); syncUI(); schedulePreview(0); });
  $("savePreset").addEventListener("click", savePreset);
  $("deletePreset").addEventListener("click", deletePreset);
  $("exportPresets").addEventListener("click", exportPresets);
  $("importPresets").addEventListener("click", importPresets);

  const collapsed = loadJSON("gf:collapsed", { batch: true });
  document.querySelectorAll(".section").forEach((sec) => {
    const k = sec.dataset.section;
    const apply = () => { sec.classList.toggle("collapsed", !!collapsed[k]); sec.querySelector(".chev").textContent = collapsed[k] ? "▸" : "▾"; };
    sec.querySelector(".head").addEventListener("click", () => { collapsed[k] = !collapsed[k]; saveJSON("gf:collapsed", collapsed); apply(); });
    apply();
  });
  buildPresetSelect();
}

function getColor(k) { return k === "fg" ? S.fg : k === "bg" ? S.bg : S.gradient[Number(k[1])]; }
function setColor(k, hex) {
  if (k === "fg") S.fg = hex; else if (k === "bg") S.bg = hex; else S.gradient[Number(k[1])] = hex;
  syncUI(); schedulePreview(0);
}
async function pickColor(k) {
  const [r, g, b] = Engine.hexToRgb(getColor(k));
  try {
    const res = await core.executeAsModal(() => action.batchPlay([{ _obj: "showColorPicker", context: "ASCII by Star", color: { _obj: "RGBColor", red: r, grain: g, blue: b } }], {}), { commandName: "ASCII by Star colour" });
    const d = res && res[0];
    const c = d && (d.RGBFloatColor || d.color);
    if (c && c.red !== undefined) {
      const ch = (v) => Math.max(0, Math.min(255, Math.round(v)));
      setColor(k, Engine.rgbToHex(ch(c.red), ch(c.grain !== undefined ? c.grain : c.green), ch(c.blue)));
    }
  } catch (e) { console.error(e); status("Colour picker unavailable — type a hex value instead.", true); }
}

function syncUI() {
  for (const [key, el] of Object.entries(sliderEls)) { el.input.value = String(S[key]); el.val.textContent = el.fmt(Number(S[key])); }
  setSelect($("charset"), S.charset);
  setSelect($("sizeMode"), S.sizeMode);
  setSelect($("dither"), S.dither);
  setSelect($("colorMode"), S.colorMode);
  setSelect($("bgMode"), S.bgMode);
  $("sortByDensity").checked = !!S.sortByDensity;
  $("invert").checked = !!S.invert;
  $("glitchOn").checked = !!S.glitchOn;
  $("glitchSeed").value = String(S.glitchSeed);
  setSelect($("gSortDir"), S.gSortDir);
  setSelect($("gChannelSwap"), S.gChannelSwap);
  $("serpentine").checked = !!S.serpentine;
  $("gradientMid").checked = !!S.gradientMid;
  if ($("customChars").value !== S.customChars) $("customChars").value = S.customChars;
  document.querySelectorAll(".swatch").forEach((el) => { el.style.backgroundColor = getColor(el.dataset.color); });
  document.querySelectorAll(".hex").forEach((el) => { el.value = getColor(el.dataset.hex); });
  refreshVisibility();
}
function refreshVisibility() {
  const show = (el, on) => el.classList.toggle("hidden", !on);
  show($("customRow"), S.charset === "custom");
  show($("sortHint"), !S.sortByDensity);
  show(sliderEls.size.row, S.sizeMode === "px");
  show(sliderEls.columns.row, S.sizeMode === "cols");
  show($("fgRow"), S.colorMode === "mono");
  show($("gradRows"), S.colorMode === "gradient");
  show($("origRows"), S.colorMode === "original");
  show($("bgRow"), S.bgMode !== "transparent");
  show(sliderEls.mosaicAmount.row, S.bgMode === "mosaic");
  show(sliderEls.ditherStrength.row, S.dither !== "none");
  show($("serpRow"), !!Engine.DIFFUSION[S.dither]);
  show($("ditherHint"), S.dither !== "none");
  show($("glitchBody"), !!S.glitchOn);
}

async function loadFonts() {
  const el = $("font");
  const mono = /mono|menlo|courier|consol|monaco|code|fixed|terminal|typewriter|ocr/i;
  let list = [];
  try {
    // one batchPlay call is far faster than walking app.fonts (1000+ DOM proxies)
    const r = await action.batchPlay([{ _obj: "get", _target: [{ _property: "fontList" }, { _ref: "application", _enum: "ordinal", _value: "targetEnum" }] }], {});
    const fl = r && r[0] && r[0].fontList;
    const names = (fl && fl.fontName) || [], ps = (fl && fl.fontPostScriptName) || [];
    for (let i = 0; i < ps.length; i++) if (mono.test(names[i]) || mono.test(ps[i])) list.push({ ps: ps[i], name: names[i] || ps[i] });
  } catch (e) { console.error(e); list = []; }
  if (!list.find((f) => f.ps === "Menlo-Regular")) list.unshift({ ps: "Menlo-Regular", name: "Menlo Regular" });
  list.sort((a, b) => (a.ps === "Menlo-Regular" ? -1 : b.ps === "Menlo-Regular" ? 1 : a.name.localeCompare(b.name)));
  el.innerHTML = list.map((f) => `<option value="${f.ps}">${f.name}</option>`).join("");
  setSelect(el, loadJSON("gf:font", "Menlo-Regular"));
  el.addEventListener("change", () => saveJSON("gf:font", el.value));
  return list.length;
}

// ---------- layout ----------
// UXP panels don't scroll on their own: give the settings area an explicit height
// (panel height minus the pinned preview block) whenever the panel size changes.
let lastH = -1, lastTop = -1;
function fitLayout(force) {
  const H = window.innerHeight || document.documentElement.clientHeight || 0;
  if (!H) return;
  const top = $("top");
  if (!force && H === lastH && top.offsetHeight === lastTop) return;
  $("preview").style.maxHeight = Math.max(70, Math.round(H * 0.38)) + "px";
  lastH = H; lastTop = top.offsetHeight;
  $("scroller").style.height = Math.max(60, H - top.offsetHeight) + "px";
}

// ---------- Photoshop events ----------
let staleTimer = null;
function onPsEvent(evt, desc) {
  if (busy) return;
  const ref = desc && desc._target && desc._target[0] && desc._target[0]._ref;
  if (evt === "select" && ref === "layer" && $("source").value !== "layer") return;
  if (src) src.stale = true;
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => { if (!busy) schedulePreview(0); }, 350);
}

async function init() {
  buildUI();
  syncUI();
  window.addEventListener("resize", () => fitLayout(true));
  $("preview").addEventListener("load", () => fitLayout(true));
  setInterval(() => fitLayout(false), 400);
  fitLayout(true);
  try { atlas = await loadAtlas(); }
  catch (e) { console.error(e); showPreviewMsg("Failed to load glyph atlas: " + errMsg(e)); return; }
  try { await action.addNotificationListener(["select", "open", "close"], onPsEvent); } catch (e) { console.error(e); }
  schedulePreview(0);
  setTimeout(() => loadFonts(), 300);
}
init();
