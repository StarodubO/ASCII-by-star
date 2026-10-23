// Pixel and layer helpers shared by both tabs: finding layers, the area to work on (the artboard holding a
// layer, or the whole canvas), reading a layer or the visible image at the document's own bit depth, and
// converting to and from 8-bit RGBA.
"use strict";
const { action, imaging } = require("photoshop");

const errText = (e) => (e && (e.message || e.toString())) || "unknown error";

function findLayers(layers, pred, out = []) {
  for (const l of layers) { if (pred(l)) out.push(l); if (l.layers && l.layers.length) findLayers(l.layers, pred, out); }
  return out;
}
function findLayerById(doc, id) { return findLayers(doc.layers, (l) => l.id === id)[0] || null; }

// ---------- the area to work on ----------
const fullFrame = (doc) => ({ x: 0, y: 0, w: doc.width, h: doc.height, artboardId: null });
const sameFrame = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
// The artboards of a document: [{id, name, x, y, w, h}] (empty without artboards). Every top-level group is
// asked in one batchPlay call, and the answer is reused for a moment, because each preview asks twice
// (frameOf and the artboard menu) and a slider drag previews many times a second.
const ARTBOARD_TTL = 1000;
let artboardCache = null; // {docId, w, h, t, boards}
function forgetArtboards() { artboardCache = null; }
async function listArtboards(doc) {
  const c = artboardCache;
  if (c && c.docId === doc.id && c.w === doc.width && c.h === doc.height && Date.now() - c.t < ARTBOARD_TTL) return c.boards;
  const out = [], groups = (doc.layers || []).filter((l) => String(l.kind) === "group");
  let res = [];
  if (groups.length) {
    try { res = await action.batchPlay(groups.map((l) => ({ _obj: "get", _target: [{ _ref: "layer", _id: l.id }, { _ref: "document", _id: doc.id }] })), {}); }
    catch (e) { res = []; }
  }
  groups.forEach((l, i) => {
    const r = res && res[i], a = r && r.artboardEnabled && r.artboard && r.artboard.artboardRect;
    if (!a) return; // not an artboard (or an error result)
    const x0 = Math.max(0, Math.round(a.left)), y0 = Math.max(0, Math.round(a.top));
    const x1 = Math.min(doc.width, Math.round(a.right)), y1 = Math.min(doc.height, Math.round(a.bottom));
    if (x1 - x0 >= 2 && y1 - y0 >= 2) out.push({ id: l.id, name: String(l.name), x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  });
  artboardCache = { docId: doc.id, w: doc.width, h: doc.height, t: Date.now(), boards: out };
  return out;
}
// The area to work on. pick: "auto" = the artboard that holds the layer (or the selected layer when layerId
// is null), "all" = the whole canvas, or an artboard's layer id. Documents without artboards: the whole canvas.
async function frameOf(doc, layerId, pick) {
  if (pick === "all") return fullFrame(doc);
  const boards = await listArtboards(doc);
  if (!boards.length) return fullFrame(doc);
  let id = pick && pick !== "auto" ? Number(pick) : null;
  if (id == null) {
    let l = null;
    try { l = layerId != null ? findLayerById(doc, layerId) : doc.activeLayers && doc.activeLayers[0]; } catch (e) { l = null; }
    try { while (l && l.parent) l = l.parent; } catch (e) { /* top level */ }
    id = l ? l.id : null;
  }
  const b = boards.find((x) => x.id === id) || (pick && pick !== "auto" ? null : boards[0]);
  return b ? { x: b.x, y: b.y, w: b.w, h: b.h, artboardId: b.id } : fullFrame(doc);
}
// Fills an artboard <select> (Auto, each artboard, Whole canvas) for a document; hides its row without artboards.
async function fillArtboardSelect(sel, row, doc) {
  const boards = doc ? await listArtboards(doc) : [];
  row.classList.toggle("hidden", !boards.length);
  const keep = sel.value || "auto", esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = '<option value="auto">Artboard: auto (follows the layer)</option>' + boards.map((b) => `<option value="${b.id}">Artboard: ${esc(b.name)}</option>`).join("") + '<option value="all">Whole canvas (all artboards)</option>';
  if (sel.innerHTML !== html) sel.innerHTML = html;
  sel.value = boards.some((b) => String(b.id) === keep) || keep === "all" ? keep : "auto";
  if (sel.ddUpdate) sel.ddUpdate();
}

// ---------- 8-bit RGBA ----------
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

// ---------- reading ----------
// Reads output-pixel rect R = {x, y, w, h} (world = document px × z, z ≤ 1, may reach past the canvas)
// of a layer (or the composite when layerId is null) into RGBA8, transparent where there is nothing.
// Inside executeAsModal.
async function readRect(doc, layerId, R, z) {
  const out = new Uint8Array(R.w * R.h * 4);
  let L = Math.max(0, Math.floor(R.x / z)), T = Math.max(0, Math.floor(R.y / z));
  let Rr = Math.min(doc.width, Math.ceil((R.x + R.w) / z)), B = Math.min(doc.height, Math.ceil((R.y + R.h) / z));
  if (layerId != null) {
    const l = findLayerById(doc, layerId), b = l && l.bounds;
    if (!b) return out;
    L = Math.max(L, Math.floor(b.left)); T = Math.max(T, Math.floor(b.top)); Rr = Math.min(Rr, Math.ceil(b.right)); B = Math.min(B, Math.ceil(b.bottom));
  }
  if (Rr <= L || B <= T) return out;
  // native depth: asking Photoshop 27 to convert 16/32-bit to 8 fails ("Could not create a new document")
  const opts = { documentID: doc.id, sourceBounds: { left: L, top: T, right: Rr, bottom: B }, applyAlpha: false };
  if (layerId != null) opts.layerID = layerId;
  if (z < 1) opts.targetSize = { width: Math.max(1, Math.round((Rr - L) * z)), height: Math.max(1, Math.round((B - T) * z)) };
  const res = await imaging.getPixels(opts);
  const id = res.imageData, iw = id.width, ih = id.height, px = await toRGBA8(id);
  id.dispose();
  // with targetSize, Photoshop reports sourceBounds in a downscaled pyramid level, not in document pixels;
  // the request is already clipped to the layer, so the result covers exactly what was asked for
  const sb = z < 1 || !res.sourceBounds ? opts.sourceBounds : res.sourceBounds, sw = Math.max(1e-6, sb.right - sb.left), sh = Math.max(1e-6, sb.bottom - sb.top);
  const x0 = Math.max(0, Math.ceil(sb.left * z - R.x - 0.5)), x1 = Math.min(R.w, Math.ceil(sb.right * z - R.x - 0.5));
  const y0 = Math.max(0, Math.ceil(sb.top * z - R.y - 0.5)), y1 = Math.min(R.h, Math.ceil(sb.bottom * z - R.y - 0.5));
  const sxOf = new Int32Array(Math.max(0, x1 - x0));
  for (let x = x0; x < x1; x++) sxOf[x - x0] = Math.min(iw - 1, Math.max(0, Math.floor((((R.x + x + 0.5) / z - sb.left) / sw) * iw)));
  for (let y = y0; y < y1; y++) {
    const sy = Math.min(ih - 1, Math.max(0, Math.floor((((R.y + y + 0.5) / z - sb.top) / sh) * ih)));
    for (let x = x0; x < x1; x++) {
      const s = (sy * iw + sxOf[x - x0]) * 4, o = (y * R.w + x) * 4;
      out[o] = px[s]; out[o + 1] = px[s + 1]; out[o + 2] = px[s + 2]; out[o + 3] = px[s + 3];
    }
  }
  return out;
}
// Reader for a layer or the visible image. Composite reads fail on some documents (artboards, smart objects
// that need updating); then a temporary merged copy is read instead. close() removes it.
function makeReader(doc, layerId) {
  let stamp = null;
  return {
    async read(R, z) {
      if (layerId != null) {
        try { return await readRect(doc, layerId, R, z); }
        catch (e) { throw new Error("Reading the layer failed (" + errText(e) + "). Try the visible image as the source."); }
      }
      if (!stamp) {
        try { return await readRect(doc, null, R, z); }
        catch (e) {
          try {
            await action.batchPlay([{ _obj: "mergeVisible", duplicate: true }], { synchronousExecution: true });
            stamp = doc.activeLayers && doc.activeLayers[0];
          } catch (e2) { stamp = null; }
          if (!stamp) throw new Error(`Photoshop couldn't read the visible image (${errText(e)}). This can happen when the scratch disk is nearly full. Try a single layer as the source.`);
        }
      }
      return readRect(doc, stamp.id, R, z);
    },
    get stamped() { return !!stamp; },
    async close() { if (stamp) { try { await stamp.delete(); } catch (e) { /* history rollback removes it */ } stamp = null; } },
  };
}

if (typeof module !== "undefined") module.exports = { findLayers, findLayerById, fullFrame, sameFrame, listArtboards, forgetArtboards, frameOf, fillArtboardSelect, toRGBA8, convertOut, makeImageData, readRect, makeReader };
