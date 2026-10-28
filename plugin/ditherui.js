// "Dither" tab: panel UI and Photoshop I/O for dither.js. Reads the source (a layer or the visible image) at one
// sample per cell, dithers it and writes one pixel layer "<source> Dither" (or a group with a layer per colour) right
// above the source. The source layer itself is never changed.
"use strict";
const { core, imaging, constants } = require("photoshop");
const uxp = require("uxp");
const lfs = uxp.storage.localFileSystem, formats = uxp.storage.formats;
const Dither = require("./dither.js");
const { makeSlider, onDoubleClick, SLIDER_HTML } = require("./slider.js");
const { setupGlitchUI } = require("./glitchui.js");
const { createViewer } = require("./viewer.js");
const { makePresetBox } = require("./presetbox.js");
const { makeHistory } = require("./history.js");
const { createLive, isSmart } = require("./live.js");
const { findLayers, findLayerById, frameOf, fillArtboardSelect, convertOut, makeImageData, makeReader, throwawayStep, withoutSelection } = require("./pixels.js");

const OUT_RE = /\s*Dither$/;
const TILE = 1024;

const pct = (v) => Math.round(v * 100) + "%";
const signed = (v) => (v > 0 ? "+" : "") + Math.round(v * 100) + "%";
const deg = (v) => Math.round(v) + "°";
const int = (v) => String(Math.round(v));
const cellsFmt = (v) => (v < 10 ? (Math.round(v * 10) / 10).toString() : Math.round(v)) + (Math.round(v) === 1 && v < 1.05 ? " cell" : " cells");
const KERNEL_NAMES = ["Right", "Right, 2 over", "Down-left, 2 over", "Down-left", "Down", "Down-right", "Down-right, 2 over", "Down, 2 rows"];
// [label, min, max, step, format, tooltip]
const SLIDERS = {
  pixel: ["Pixel size", 1, 64, 1, (v) => Math.round(v) + " px", "How big each dither pixel (cell) is, in document pixels."],
  gap: ["Gap", 0, 0.9, 0.01, pct, "Empty space around the shape in each cell."],
  autoCount: ["Colours", 2, 32, 1, int, "How many colours to find in the picture."],
  grayLevels: ["Levels", 2, 16, 1, int, "How many steps from the dark colour to the light one. 2 = pure 1-bit."],
  rgbLevels: ["Levels", 2, 8, 1, (v) => `${Math.round(v)} (${Math.round(v) ** 3} col.)`, "Steps per red, green and blue channel."],
  amount: ["Strength", 0, 1.5, 0.01, pct, "Error diffusion: how much of each pixel's error moves on (less = flatter, posterized). Patterns: how far they spread."],
  errThreshold: ["Ignore small", 0, 0.5, 0.01, pct, "Errors smaller than this share of a colour step are not passed on: flat areas stay clean, without stray pixels."],
  jitter: ["Jitter", 0, 1, 0.01, pct, "Random noise in each decision: breaks up the worm-like trails of error diffusion."],
  patternScale: ["Pattern size", 1, 16, 1, (v) => "×" + Math.round(v), "Each step of the pattern covers this many cells: chunkier patterns."],
  patternAngle: ["Pattern angle", -90, 90, 1, deg, "Turns the pattern (and the halftone screen)."],
  screenSize: ["Screen size", 2, 64, 0.5, cellsFmt, "The distance between two halftone dots, in cells."],
  brightness: ["Brightness", -1, 1, 0.01, signed, "Lighter or darker before dithering."],
  contrast: ["Contrast", -1, 1, 0.01, signed, "More or less contrast before dithering."],
  gamma: ["Gamma", 0.2, 3, 0.01, (v) => v.toFixed(2), "Midtones: above 1 lighter, below 1 darker."],
  saturation: ["Saturation", -1, 1, 0.01, signed, "More or less colourful before dithering."],
  hue: ["Hue", -180, 180, 1, deg, "Turns every colour round the colour wheel."],
  red: ["Red", -1, 1, 0.01, signed, "The red channel weaker or stronger."],
  green: ["Green", -1, 1, 0.01, signed, "The green channel weaker or stronger."],
  blue: ["Blue", -1, 1, 0.01, signed, "The blue channel weaker or stronger."],
  blur: ["Soften", 0, 10, 0.1, cellsFmt, "Blurs the picture first: calmer, more even patterns."],
  sharpen: ["Sharpen", 0, 3, 0.01, pct, "Crisper edges before dithering."],
  grain: ["Grain", 0, 0.5, 0.01, pct, "Adds noise first: a rougher, filmic dither."],
  brush: ["Brush", 1, 30, 1, cellsFmt, "The brush size, in cells."],
};
for (let i = 0; i < 8; i++) SLIDERS["k" + i] = [KERNEL_NAMES[i], 0, 16, 1, int, "How much of the error goes to this neighbour (the weights are shared out by their sum)."];
const SELECTS = { dtShape: "shape", dtBgMode: "bgMode", dtMode: "mode", dtPaletteFrom: "paletteFrom", dtMetric: "metric", dtAlgo: "algo", dtScreenShape: "screenShape", dtAlphaMode: "alphaMode" };
const CHECKS = { dtSerpentine: "serpentine", dtInvert: "invert" };
const COLOURS = { bgColor: "dtBg", grayDark: "dtGrayDark", grayLight: "dtGrayLight" };
const MODE_HINTS = {
  tone: "The palette is laid along the picture's brightness, first colour = darkest. Neighbouring colours dither into each other: posters, gradient maps, duotones.",
  palette: "Every pixel takes the nearest palette colour, so hues stay: retro consoles, limited inks.",
  gray: "Grey steps from the dark colour to the light one (pick any two colours for a duotone).",
  rgb: "Each channel on its own: 2 levels = 8 colours, 3 = 27, and so on.",
};
const GROUP_HINTS = {
  diffusion: "Error diffusion: each pixel's rounding error is passed on to its neighbours. Organic, detailed.",
  curve: "Riemersma: the error travels along a Hilbert curve, giving soft, organic clusters without row streaks.",
  ordered: "Ordered: a fixed threshold pattern. Regular, retro, and it doesn't crawl when the picture changes.",
  noise: "Noise: random thresholds. Blue noise is even and grain-free; white noise is rough; the others are in between.",
};
const PICTURE_KEYS = ["edits"];

module.exports = function setupDither(h) {
  const { $, loadJSON, saveJSON, errMsg, createLayer, bitDepth, isGray, checkDoc, askColor, selectLayer, docBaseName } = h;
  const activeDoc = () => live.sourceDoc(h.activeDoc());

  const fresh = (over) => {
    const s = JSON.parse(JSON.stringify(Dither.DEFAULTS));
    if (over) for (const k of Object.keys(s)) if (over[k] !== undefined) s[k] = JSON.parse(JSON.stringify(over[k]));
    return Dither.migrate(s);
  };
  let D = fresh(loadJSON("gf:dither:last", null));
  const B = Object.assign({ tool: "paint", size: 1, round: true, color: D.palette[0] || "#000000" }, loadJSON("gf:ditherBrush", {})); // the brush (not part of the look)
  let output = loadJSON("gf:ditherOutput", "one");
  let active = false, busy = false, editing = null; // editing: {docId, layerId, name, sourceLayerId}
  let stale = 0, viewer = null, reads = null, sel = 0, mode = null; // mode: null | "paint" | "pick"
  let shownPalette = []; // the colours the palette row shows (own, or found in the picture)
  const sliderEls = {};
  let glitchUI = null;

  function status(msg, isErr) { const el = $("dtStatus"); el.textContent = msg || ""; el.style.color = isErr ? "#ff7070" : ""; }
  const hist = makeHistory({
    state: () => JSON.stringify(D),
    restore: (st) => { D = fresh(JSON.parse(st)); saveJSON("gf:dither:last", D); sync(); schedule(0); },
    onAvail: (can) => { $("dtUndo").disabled = !can; },
  });
  const save = () => { saveJSON("gf:dither:last", D); hist.note(); };
  const saveBrush = () => saveJSON("gf:ditherBrush", B);
  const live = createLive({ btn: $("dtLive"), label: "Dither", status, errMsg });
  const isGroup = (l) => l && (l.kind === constants.LayerKind.GROUP || String(l.kind) === "group");
  // our output: a "… Dither" layer or group; a layer inside such a group counts as the group
  const outputOf = (l) => {
    for (let x = l, i = 0; x && i < 6; x = x.parent, i++) if (OUT_RE.test(String(x.name)) && (isGroup(x) || x === l)) return x;
    return null;
  };
  const recKey = (doc, id) => `gf:dither:${doc.title}:${id}`;
  function remember(doc, layer, sourceLayerId) {
    const rec = { settings: D, source: $("dtSource").value, sourceLayerId, output };
    saveJSON(recKey(doc, layer.id), rec);
    saveJSON("gf:ditherName:" + layer.name, rec);
  }
  const recall = (doc, l) => loadJSON(recKey(doc, l.id), null) || loadJSON("gf:ditherName:" + l.name, null);
  const artboardPick = () => $("dtArtboard").value || "auto";
  const pixelOf = () => Math.max(1, Math.round(D.pixel));

  // ---------- source ----------
  function resolveSource(doc) {
    if (editing && editing.docId === doc.id) {
      if (editing.sourceLayerId == null) return { layerId: null, name: docBaseName(doc) };
      const l = findLayerById(doc, editing.sourceLayerId);
      if (l) return { layerId: l.id, name: String(l.name) };
      throw new Error("The layer this dither was made from no longer exists.");
    }
    if ($("dtSource").value === "merged") return { layerId: null, name: docBaseName(doc) };
    const al = doc.activeLayers && doc.activeLayers[0];
    if (!al) throw new Error("Select the layer to dither.");
    const ours = outputOf(al);
    if (ours) {
      const rec = recall(doc, ours), l = rec && rec.sourceLayerId != null ? findLayerById(doc, rec.sourceLayerId) : null;
      if (l) return { layerId: l.id, name: String(l.name) };
      throw new Error("Select the layer to dither (not a Dither layer).");
    }
    if (isGroup(al)) throw new Error("Select a single layer, not a group, or use Source: Visible.");
    return { layerId: al.id, name: String(al.name) };
  }
  async function withOutputsHidden(doc, fn) {
    const hidden = findLayers(doc.layers, (l) => OUT_RE.test(String(l.name)) && l.visible);
    for (const l of hidden) l.visible = false;
    try { return await fn(); } finally { for (const l of hidden) { try { l.visible = true; } catch (e) { /* deleted */ } } }
  }
  // The source over the frame, one sample per cell. Inside executeAsModal.
  async function readCells(doc, src, frame) {
    const p = pixelOf(), z = 1 / p, c = Dither.cellsOf(frame.w, frame.h, p), R = { x: frame.x * z, y: frame.y * z, w: c.w, h: c.h };
    return withOutputsHidden(doc, async () => {
      const r = makeReader(doc, src.layerId);
      try { return { w: c.w, h: c.h, data: await r.read(R, z) }; } finally { await r.close(); }
    });
  }

  // ---------- preview ----------
  let pvTimer = null, pvRunning = null, pvAgain = false;
  function schedule(delay) {
    save();
    if (!active) return;
    clearTimeout(pvTimer);
    pvTimer = setTimeout(run, delay === undefined ? 60 : delay);
  }
  async function run() {
    if (busy) return;
    if (pvRunning) { pvAgain = true; return; }
    pvRunning = renderPreview().catch((e) => { console.error(e); viewer.showMessage(errMsg(e)); status(errMsg(e), true); });
    await pvRunning;
    pvRunning = null;
    if (pvAgain) { pvAgain = false; schedule(0); }
  }
  let pv = null; // {doc, src, srcKey, frame, F, ms}
  const pvStrips = new Map(); // the glitch's full-width strips for the preview
  async function renderPreview() {
    const doc = activeDoc();
    if (!doc) { viewer.showMessage("Open a document to begin"); status(""); return; }
    checkDoc(doc);
    const src = resolveSource(doc);
    await fillArtboardSelect($("dtArtboard"), $("dtArtboardRow"), doc);
    const frame = await frameOf(doc, src.layerId, artboardPick());
    const srcKey = [doc.id, src.layerId, frame.x, frame.y, frame.w, frame.h].join("|");
    const readKey = [srcKey, doc.width, doc.height, stale, pixelOf()].join("|");
    if (!reads || reads.key !== readKey) {
      busy = true;
      try { reads = { key: readKey, img: await core.executeAsModal((ctx) => throwawayStep(ctx, doc, () => readCells(doc, src, frame)), { commandName: "Dither: read pixels" }) }; }
      finally { busy = false; }
      reads.F = Dither.makeField(reads.img, frame.w, frame.h, pixelOf());
    }
    const t0 = Date.now(), F = reads.F, G = Dither.gridOf(F, D);
    if (!pv || pv.srcKey !== srcKey) viewer.setCentre(frame.w / 2, frame.h / 2);
    pv = { doc, src, srcKey, frame, F, ms: Date.now() - t0 };
    if (D.mode === "tone" || D.mode === "palette") {
      const was = shownPalette.join();
      shownPalette = G.palette.slice();
      if (was !== shownPalette.join()) syncPalette();
    }
    pvStrips.clear(); // the settings may have changed
    await viewer.refresh();
    if (live.on && live.info().sourceDocId === doc.id) { const s = JSON.parse(JSON.stringify(D)); const c = new Map(); live.update((v) => Dither.renderFx(F, s, v, 1, undefined, c)); }
  }
  async function renderRegion(rect, z) {
    if (!pv) return null;
    const t0 = Date.now(), W = Math.max(1, Math.round(rect.w * z)), H = Math.max(1, Math.round(rect.h * z));
    const rgb = Dither.flatten(Dither.renderFx(pv.F, D, rect, z, undefined, pvStrips), W, H);
    const G = Dither.gridOf(pv.F, D), n = D.mode === "rgb" ? Math.round(D.rgbLevels) ** 3 : G.palette.length;
    status(`${pv.src.layerId == null ? "Visible image" : "“" + pv.src.name + "”"} · ${G.w}×${G.h} cells · ${n} colours · ${Date.now() - t0 + pv.ms} ms`);
    return { rgb, w: W, h: H };
  }

  // ---------- writing ----------
  async function writeTiles(doc, layer, frame, draw, label) {
    const depth = bitDepth(doc), gray = isGray(doc);
    let profile = null;
    try { profile = doc.colorProfileName || null; } catch (e) { profile = null; }
    const nT = Math.ceil(frame.w / TILE) * Math.ceil(frame.h / TILE);
    let k = 0, any = false;
    await withoutSelection(doc, async () => {
      for (let ty = 0; ty < frame.h; ty += TILE) for (let tx = 0; tx < frame.w; tx += TILE) {
        status(`${label}… tile ${++k}/${nT}`);
        const tw = Math.min(TILE, frame.w - tx), th = Math.min(TILE, frame.h - ty), px = draw({ x: tx, y: ty, w: tw, h: th });
        for (let i = 3; !any && i < px.length; i += 4) if (px[i]) any = true;
        const id = await makeImageData(convertOut(px, tw * th, depth, gray), tw, th, gray, profile);
        try { await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: id, replace: k === 1, targetBounds: { left: frame.x + tx, top: frame.y + ty }, commandName: "Dither" }); }
        finally { id.dispose(); }
      }
    });
    return any;
  }
  // Puts layer (or group) right above the source, or at the top of the artboard / document.
  async function placeAbove(doc, layer, src, frame, old) {
    if (old) { await layer.move(old, constants.ElementPlacement.PLACEBEFORE); return; }
    const sl = src.layerId != null ? findLayerById(doc, src.layerId) : null, board = frame.artboardId != null ? findLayerById(doc, frame.artboardId) : null;
    if (sl) { if (layer.id !== sl.id) await layer.move(sl, constants.ElementPlacement.PLACEBEFORE); }
    else if (board && board.layers && board.layers.length) { if (board.layers[0].id !== layer.id) await layer.move(board.layers[0], constants.ElementPlacement.PLACEBEFORE); }
    else if (doc.layers[0].id !== layer.id) await layer.move(doc.layers[0], constants.ElementPlacement.PLACEBEFORE);
  }

  // ---------- apply ----------
  async function apply(update) {
    const doc = activeDoc();
    try { checkDoc(doc); } catch (e) { return status(e.message, true); }
    if (update && (!editing || editing.docId !== doc.id)) return status("The dither being edited is in another document. Switch back to it.", true);
    clearTimeout(pvTimer);
    while (pvRunning) await pvRunning;
    const t0 = Date.now();
    busy = true;
    try {
      await core.executeAsModal(async (ctx) => {
        const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: update ? "Dither update" : "Dither" });
        try {
          const src = resolveSource(doc), frame = await frameOf(doc, src.layerId, artboardPick());
          const old = update ? findLayerById(doc, editing.layerId) : null;
          if (update && !old) throw new Error("The Dither layer being edited no longer exists.");
          if (update && isSmart(old)) throw new Error("This dither is a smart object: change it with Open live smart object.");
          const img = await readCells(doc, src, frame), F = Dither.makeField(img, frame.w, frame.h, pixelOf()), s = JSON.parse(JSON.stringify(D)), strips = new Map();
          const name = `${src.name.replace(OUT_RE, "").trim() || docBaseName(doc)} Dither`;
          const sl = src.layerId != null ? findLayerById(doc, src.layerId) : null;
          if (!old && sl) await selectLayer(sl); // new layers appear above the selection
          let made;
          if (output === "colors") {
            const group = await doc.createLayerGroup({ name });
            await placeAbove(doc, group, src, frame, old);
            let below = null;
            const add = async (title, only) => {
              const layer = await createLayer(doc, title);
              if (!(await writeTiles(doc, layer, frame, (v) => Dither.renderFx(F, s, v, 1, only, strips), "Writing " + title))) { await layer.delete(); return; }
              if (below) await layer.move(below, constants.ElementPlacement.PLACEBEFORE); else await layer.move(group, constants.ElementPlacement.PLACEINSIDE);
              below = layer;
            };
            if (s.bgMode === "color") await add("Background", "bg");
            for (const c of Dither.colorsUsed(F, s)) await add(c.hex.toUpperCase(), c.color); // most cells at the bottom
            made = group;
          } else {
            const layer = await createLayer(doc, name);
            await placeAbove(doc, layer, src, frame, old);
            await writeTiles(doc, layer, frame, (v) => Dither.renderFx(F, s, v, 1, undefined, strips), "Dithering");
            made = layer;
          }
          if (old) await old.delete();
          remember(doc, made, src.layerId);
          editing = { docId: doc.id, layerId: made.id, name: String(made.name), sourceLayerId: src.layerId };
        } finally { await ctx.hostControl.resumeHistory(sid, true); }
      }, { commandName: "Dither" });
      showEditing();
      status(`${update ? "Updated" : "Added"} “${editing.name}” · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(e); status(errMsg(e), true);
    } finally { busy = false; }
  }

  // ---------- live smart object ----------
  async function toggleLive() {
    if (live.on) return live.close();
    const doc = activeDoc();
    try { checkDoc(doc); } catch (e) { return status(e.message, true); }
    clearTimeout(pvTimer);
    while (pvRunning) await pvRunning;
    try { if (!pv || pv.doc.id !== doc.id) await renderPreview(); } catch (e) { return status(errMsg(e), true); }
    if (!pv) return;
    const { src, frame, F } = pv, s = JSON.parse(JSON.stringify(D)), old = editing && editing.docId === doc.id ? findLayerById(doc, editing.layerId) : null;
    busy = true;
    let so = null;
    try {
      so = await live.open({
        doc, frame, name: `${src.name.replace(OUT_RE, "").trim() || docBaseName(doc)} Dither`, reuse: isSmart(old) ? old : null, draw: ((c) => (v) => Dither.renderFx(F, s, v, 1, undefined, c))(new Map()),
        place: (layer) => placeAbove(doc, layer, src, frame, null),
      });
    } finally { busy = false; }
    if (!so) return;
    remember(doc, so, src.layerId);
    editing = { docId: doc.id, layerId: so.id, name: String(so.name), sourceLayerId: src.layerId };
    showEditing();
  }

  // ---------- export SVG ----------
  async function exportSVG() {
    const doc = activeDoc();
    try { checkDoc(doc); } catch (e) { return status(e.message, true); }
    clearTimeout(pvTimer);
    while (pvRunning) await pvRunning;
    try { if (!pv || pv.doc.id !== doc.id) await renderPreview(); } catch (e) { return status(errMsg(e), true); }
    if (!pv) return;
    try {
      const svg = Dither.toSVG(pv.F, D), name = `${pv.src.name.replace(OUT_RE, "").trim() || docBaseName(doc)}-dither.svg`;
      const file = await lfs.getFileForSaving(name, { types: ["svg"] });
      if (!file) return;
      await file.write(svg, { format: formats.utf8 });
      status(`Saved ${file.name} (${Math.round(svg.length / 1024)} KB)`);
    } catch (e) { console.error(e); status(errMsg(e), true); }
  }

  // ---------- editing a saved layer ----------
  function showEditing() {
    $("dtEditLabel").textContent = editing ? "Editing: " + editing.name : "";
    $("dtEditBox").classList.toggle("hidden", !editing);
    h.fitLayout(true);
  }
  function loadSelected() {
    const doc = activeDoc(), al = doc && doc.activeLayers && doc.activeLayers[0], ours = al && outputOf(al);
    if (!ours) return status("Select a Dither layer (or its group).", true);
    const rec = recall(doc, ours);
    if (!rec) return status("No saved settings for this layer on this computer.", true);
    D = fresh(rec.settings);
    if (rec.output) { output = rec.output; saveJSON("gf:ditherOutput", output); }
    $("dtSource").value = rec.source || "layer";
    if ($("dtSource").ddUpdate) $("dtSource").ddUpdate();
    editing = { docId: doc.id, layerId: ours.id, name: String(ours.name), sourceLayerId: rec.sourceLayerId == null ? null : rec.sourceLayerId };
    sync(); showEditing(); schedule(0);
    status("Loaded the settings of “" + ours.name + "”.");
  }
  function stopEditing() { editing = null; showEditing(); pv = null; schedule(0); }

  // ---------- painting and picking on the preview ----------
  const cellRect = (x, y, size) => { // the brush's cells around frame point (x, y), in document px
    const p = pixelOf(), r = size / 2, cx = x / p, cy = y / p;
    const x0 = size === 1 ? Math.floor(cx) : Math.floor(cx - r + 0.5), y0 = size === 1 ? Math.floor(cy) : Math.floor(cy - r + 0.5);
    return { x: x0 * p, y: y0 * p, w: size * p, h: size * p };
  };
  let stroke = null;
  const editor = {
    down(p) {
      if (!pv) return;
      if (mode === "pick") {
        const c = Dither.sourceAt(pv.F, p.x, p.y);
        if (D.paletteFrom !== "own") { D.palette = shownPalette.slice(); D.paletteFrom = "own"; }
        D.palette = D.palette.slice();
        D.palette.splice(Math.min(D.palette.length, sel + 1), 0, c);
        sel = Math.min(D.palette.length - 1, sel + 1);
        sync(); schedule(0);
        status(`Added ${c.toUpperCase()} to the palette (${D.palette.length} colours). Click again for more, or press Done.`);
        return;
      }
      stroke = { op: B.tool, color: B.color, size: Math.round(B.size), round: B.round, pts: [p.x / pv.frame.w, p.y / pv.frame.h] };
      D.edits = D.edits.concat([stroke]);
      schedule(0);
    },
    move(p) {
      if (!stroke || !pv) return;
      const n = stroke.pts.length, px = p.x / pv.frame.w, py = p.y / pv.frame.h;
      if (Math.hypot((px - stroke.pts[n - 2]) * pv.frame.w, (py - stroke.pts[n - 1]) * pv.frame.h) < pixelOf() * 0.5) return;
      stroke.pts.push(px, py);
      D.edits = D.edits.slice(); // a new array: the grid cache sees the change
      schedule(30);
      this.hover(p);
    },
    up() { if (stroke) { stroke = null; sync(); } },
    hover(p) { if (viewer) viewer.setMarks(p && mode === "paint" ? [cellRect(p.x, p.y, Math.round(B.size))] : []); },
  };
  function setMode(m) {
    mode = mode === m ? null : m;
    if (viewer) { viewer.setEditor(mode ? editor : null); if (!mode) viewer.setMarks([]); }
    sync();
    if (mode === "paint") status("Click or drag on the preview to paint. Option/Alt-drag moves the view.");
    if (mode === "pick") status("Click the preview to add the colour there to the palette.");
  }

  // ---------- palette ----------
  const ownPalette = () => D.mode === "tone" || D.mode === "palette" ? D.paletteFrom === "own" : false;
  function syncPalette() {
    const pal = ownPalette() ? D.palette : shownPalette, box = $("dtPalette");
    if (sel >= pal.length) sel = Math.max(0, pal.length - 1);
    const html = pal.map((c, i) => `<div class="palSw${i === sel ? " on" : ""}${i === D.clearColor ? " clear" : ""}" data-i="${i}" style="background-color:${c}" title="${c.toUpperCase()}${i === D.clearColor ? " (left empty)" : ""}"></div>`).join("");
    if (box.innerHTML !== html) {
      box.innerHTML = html;
      for (const el of box.querySelectorAll(".palSw")) el.addEventListener("click", () => clickSwatch(Number(el.getAttribute("data-i"))));
    }
    const cur = pal[sel] || "#000000";
    $("dtSelSwatch").style.backgroundColor = cur; $("dtSelHex").value = cur;
    // Empty colour: none or one of the colours
    const cl = $("dtClear"), opts = '<option value="-1">None</option>' + pal.map((c, i) => `<option value="${i}">${i + 1}. ${c.toUpperCase()}</option>`).join("");
    if (cl.innerHTML !== opts) cl.innerHTML = opts;
    cl.value = String(D.clearColor < pal.length ? D.clearColor : -1);
    if (cl.ddUpdate) cl.ddUpdate();
  }
  async function clickSwatch(i) {
    const pal = ownPalette() ? D.palette : shownPalette;
    if (i === sel && ownPalette()) { // the selected one again: change it
      try { const v = await askColor(D.palette[i]); if (v) { D.palette = D.palette.slice(); D.palette[i] = v; B.color = v; saveBrush(); sync(); schedule(0); } }
      catch (e) { console.error(e); status("Colour picker unavailable — type a hex value instead.", true); }
      return;
    }
    sel = i;
    if (pal[i]) { B.color = pal[i]; saveBrush(); }
    sync();
  }
  function editPalette(fn) {
    if (!ownPalette()) { D.palette = shownPalette.slice(); D.paletteFrom = "own"; }
    D.palette = D.palette.slice();
    fn(D.palette);
    if (D.clearColor >= D.palette.length) D.clearColor = -1;
    sync(); schedule(0);
  }
  const validHex = (v) => { v = String(v).trim().replace(/^#?/, "#"); if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return null; const [r, g, b] = Dither.hexToRgb(v); return Dither.rgbToHex(r, g, b); };

  // ---------- UI ----------
  const setSel = (id, v) => { const el = $(id); el.value = String(v); if (el.ddUpdate) el.ddUpdate(); };
  const setChk = (id, v) => { const el = $(id); el.checked = !!v; if (el.syncChecked) el.syncChecked(); };
  const show = (id, on) => $(id).classList.toggle("hidden", !on);
  const getV = (k) => (k === "brush" ? B.size : /^k\d$/.test(k) ? D.kernel[Number(k[1])] : D[k]);
  function setV(k, v) {
    if (k === "brush") { B.size = v; saveBrush(); return; }
    if (/^k\d$/.test(k)) { D.kernel = D.kernel.slice(); D.kernel[Number(k[1])] = v; return; }
    D[k] = v;
  }
  function sync() {
    for (const [k, el] of Object.entries(sliderEls)) { el.input.value = String(getV(k)); el.val.textContent = el.fmt(getV(k)); }
    for (const [id, k] of Object.entries(SELECTS)) setSel(id, D[k]);
    for (const [id, k] of Object.entries(CHECKS)) setChk(id, D[k]);
    for (const [k, id] of Object.entries(COLOURS)) { $(id + "Swatch").style.backgroundColor = D[k]; $(id + "Hex").value = D[k]; }
    setSel("dtOutput", output); setSel("dtBrushTool", B.tool); setChk("dtBrushRound", B.round);
    $("dtToolSwatch").style.backgroundColor = B.color; $("dtToolHex").value = B.color;
    const pal = D.mode === "tone" || D.mode === "palette", own = pal && D.paletteFrom === "own", g = (Dither.ALGOS[D.algo] || [])[1];
    const diff = g === "diffusion", curve = g === "curve", screen = D.algo === "screen";
    $("dtModeHint").textContent = MODE_HINTS[D.mode] || "";
    $("dtAlgoHint").textContent = GROUP_HINTS[g] || "";
    show("dtPalRows", pal); show("dtAutoRows", pal && !own); show("dtOwnRows", own); show("dtPalEditRows", own); show("dtMetricRow", D.mode === "palette");
    show("dtGrayRows", D.mode === "gray"); show("dtRgbRows", D.mode === "rgb");
    show("dtBgRow", D.bgMode === "color"); show("dsl-gap", true);
    show("dtDiffRows", diff || curve); show("dtSerpRow", diff); show("dtKernelRows", D.algo === "custom");
    show("dtPatternRows", !diff && !curve && D.algo !== "threshold"); show("dsl-patternScale", !screen); show("dtScreenRows", screen);
    const al = sliderEls.amount && sliderEls.amount.label, lbl = diff || curve ? "Strength" : "Spread";
    if (al && al.textContent !== lbl) al.textContent = lbl;
    show("dtToolColorRow", B.tool === "paint");
    const pb = $("dtPaintBtn"), pl = mode === "paint" ? "Done painting" : "Paint on the preview";
    if (pb.textContent !== pl) pb.textContent = pl;
    pb.classList.toggle("primary", mode === "paint");
    const kb = $("dtPalPick"), kl = mode === "pick" ? "Done picking" : "Pick colours from the preview";
    if (kb.textContent !== kl) kb.textContent = kl;
    kb.classList.toggle("primary", mode === "pick");
    $("dtEditUndo").disabled = !D.edits.length; $("dtEditClear").disabled = !D.edits.length;
    $("dtEditInfo").textContent = D.edits.length ? `${D.edits.length} stroke${D.edits.length === 1 ? "" : "s"} painted by hand. They stay when you change the look and follow the picture when the pixel size changes.`
      : "Fix single pixels by hand: draw with a palette colour, erase or bring the dither back. Edits stay when you change the look and follow the picture when the pixel size changes.";
    syncPalette();
    if (glitchUI) glitchUI.sync();
    if (h.refreshFields) h.refreshFields();
  }
  function applyLook(st, full) {
    const keep = {};
    if (!full) for (const k of PICTURE_KEYS) keep[k] = D[k];
    D = fresh(Object.assign({}, Dither.DEFAULTS, st, keep));
    sync(); schedule(0);
  }
  const lookOnly = () => { const o = JSON.parse(JSON.stringify(D)); for (const k of PICTURE_KEYS) delete o[k]; return o; };
  const lookFrom = (st) => { const o = {}; for (const k of Object.keys(Dither.DEFAULTS)) if (!PICTURE_KEYS.includes(k) && st[k] !== undefined) o[k] = st[k]; return o; };

  function randomize() {
    const R = Math.random, pick = (a) => a[Math.floor(R() * a.length)], between = (a, b) => a + (b - a) * R(), round = (v, d) => Math.round(v * d) / d;
    const pal = pick(Dither.PALETTES)[2], algos = Object.keys(Dither.ALGOS).filter((a) => a !== "custom" && a !== "threshold");
    const algo = pick(algos), big = R() < 0.25;
    const st = {
      mode: pick(["tone", "tone", "palette", "gray"]), palette: pal.slice(), paletteFrom: R() < 0.15 ? "image" : "own", autoCount: Math.round(between(3, 10)),
      grayLevels: R() < 0.7 ? 2 : Math.round(between(3, 5)), grayDark: pal[0], grayLight: pal[pal.length - 1],
      algo, amount: round(between(0.7, 1.1), 100), serpentine: R() < 0.7, patternScale: R() < 0.8 ? 1 : 2, patternAngle: R() < 0.7 ? 0 : pick([15, 30, 45, -45]),
      screenSize: round(between(4, 12), 2), screenShape: pick(["round", "round", "ellipse", "line", "diamond", "cross"]),
      pixel: big ? Math.round(between(8, 18)) : Math.round(between(1, 6)), shape: big ? pick(["circle", "square", "diamond", "hline", "plus"]) : "square",
      gap: big ? round(between(0.08, 0.35), 100) : 0, bgMode: big && R() < 0.7 ? "color" : "transparent", bgColor: pal[0],
      contrast: round(between(-0.05, 0.3), 100), saturation: round(between(-0.1, 0.4), 100), seed: Math.floor(R() * 99999) + 1,
    };
    applyLook(st);
    status("Randomized. ↶ Undo goes back.");
  }

  function build() {
    // the algorithm and palette menus
    const groups = [["diffusion", "Error diffusion"], ["curve", "Along a curve"], ["ordered", "Ordered patterns"], ["noise", "Noise"]];
    $("dtAlgo").innerHTML = groups.map(([g, title]) => `<option value="" disabled>— ${title} —</option>` + Object.entries(Dither.ALGOS).filter(([, a]) => a[1] === g).map(([id, a]) => `<option value="${id}">${a[0]}</option>`).join("")).join("");
    $("dtPalPreset").innerHTML = '<option value="">Choose a palette…</option>' + Dither.PALETTES.map(([id, name, cols]) => `<option value="${id}">${name} (${cols.length})</option>`).join("");
    for (const [key, [label, min, max, step, fmt, tip]] of Object.entries(SLIDERS)) {
      const host = $("dsl-" + key);
      host.innerHTML = `<div class="row" title="${tip}"><span class="label" title="${tip} Double-click the name or the handle to reset.">${label}</span>${SLIDER_HTML}<span class="val"></span></div>`;
      const val = host.querySelector(".val"), def = key === "brush" ? 1 : /^k\d$/.test(key) ? Dither.DEFAULTS.kernel[Number(key[1])] : Dither.DEFAULTS[key];
      const reset = () => { setV(key, def); sync(); schedule(); };
      const input = makeSlider(host.querySelector(".slider"), min, max, step, (v) => { setV(key, v); val.textContent = fmt(v); if (key === "brush") { editor.hover(null); return; } schedule(); }, reset);
      onDoubleClick(host.querySelector(".label"), reset);
      onDoubleClick(val, reset);
      sliderEls[key] = { input, val, fmt, label: host.querySelector(".label") };
    }
    makePresetBox({
      $, loadJSON, saveJSON, setSelect: h.setSelect, status, errMsg, lfs, formats,
      ids: { select: "dtPreset", name: "dtPresetName", save: "dtPresetSave", del: "dtPresetDelete", exp: "dtPresetExport", imp: "dtPresetImport" },
      storeKey: "gf:ditherPresets", builtIns: Dither.STYLES.map((x) => ({ id: x.id, name: x.name, settings: x.s })), builtInLabel: "Built-in looks",
      fileName: "ascii-by-star-dither-looks.json", fileTag: "asciiByStarDither", current: lookOnly, apply: applyLook, fresh: lookFrom,
    });
    $("dtPresetReset").addEventListener("click", () => {
      const v = $("dtPreset").value, st = v.startsWith("b:") ? (Dither.STYLES.find((x) => x.id === v.slice(2)) || {}).s : v.startsWith("u:") ? (loadJSON("gf:ditherPresets", [])[Number(v.slice(2))] || {}).settings : null;
      applyLook(st || {});
      status("Back to the look.");
    });
    $("dtResetAll").addEventListener("click", () => { D = fresh(null); sync(); schedule(0); status("Every setting is back to its default. ↶ Undo brings them back."); });
    $("dtRandom").addEventListener("click", randomize);
    $("dtUndo").addEventListener("click", () => { if (hist.undo()) status("Undone." + (hist.canUndo() ? "" : " Nothing more to undo.")); });
    for (const [id, k] of Object.entries(SELECTS)) $(id).addEventListener("change", () => { if (!$(id).value) return sync(); D[k] = $(id).value; sync(); schedule(0); });
    for (const [id, k] of Object.entries(CHECKS)) h.onCheck($(id), (v) => { D[k] = v; sync(); schedule(0); });
    for (const [k, id] of Object.entries(COLOURS)) {
      $(id + "Swatch").addEventListener("click", async () => {
        try { const v = await askColor(D[k]); if (v) { D[k] = v; sync(); schedule(0); } } catch (e) { console.error(e); status("Colour picker unavailable — type a hex value instead.", true); }
      });
      $(id + "Hex").addEventListener("change", () => { const v = validHex($(id + "Hex").value); if (v) { D[k] = v; schedule(0); } sync(); });
    }
    // palette
    $("dtPalPreset").addEventListener("change", () => {
      const p = Dither.PALETTES.find((x) => x[0] === $("dtPalPreset").value);
      setSel("dtPalPreset", "");
      if (!p) return;
      D.palette = p[2].slice(); D.paletteFrom = "own"; D.clearColor = -1; sel = 0;
      sync(); schedule(0);
      status(`Palette: ${p[1]}.`);
    });
    $("dtAutoKeep").addEventListener("click", () => { if (!shownPalette.length) return; D.palette = shownPalette.slice(); D.paletteFrom = "own"; sync(); schedule(0); status("These colours are your palette now: change them one by one."); });
    $("dtSelSwatch").addEventListener("click", () => clickSwatch(sel));
    $("dtSelHex").addEventListener("change", () => { const v = validHex($("dtSelHex").value); if (v) editPalette((p) => { p[sel] = v; }); else sync(); });
    $("dtSelLeft").addEventListener("click", () => { if (sel > 0) editPalette((p) => { [p[sel - 1], p[sel]] = [p[sel], p[sel - 1]]; sel--; }); });
    $("dtSelRight").addEventListener("click", () => { if (sel < D.palette.length - 1) editPalette((p) => { [p[sel + 1], p[sel]] = [p[sel], p[sel + 1]]; sel++; }); });
    $("dtPalAdd").addEventListener("click", () => editPalette((p) => {
      const a = Dither.hexToRgb(p[sel] || "#808080"), b = Dither.hexToRgb(p[sel + 1] || "#ffffff"); // halfway to the next colour
      p.splice(sel + 1, 0, Dither.rgbToHex((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)); sel++;
    }));
    $("dtPalDel").addEventListener("click", () => { if (D.palette.length <= 2) return status("A palette needs at least two colours.", true); editPalette((p) => { p.splice(sel, 1); if (D.clearColor === sel) D.clearColor = -1; else if (D.clearColor > sel) D.clearColor--; sel = Math.max(0, sel - 1); }); });
    $("dtPalSort").addEventListener("click", () => editPalette((p) => { const c = p[sel]; p.sort((x, y) => Dither.luma(...Dither.hexToRgb(x)) - Dither.luma(...Dither.hexToRgb(y))); sel = p.indexOf(c); D.clearColor = -1; }));
    $("dtPalRev").addEventListener("click", () => editPalette((p) => { p.reverse(); sel = p.length - 1 - sel; if (D.clearColor >= 0) D.clearColor = p.length - 1 - D.clearColor; }));
    $("dtPalPick").addEventListener("click", () => setMode("pick"));
    $("dtClear").addEventListener("change", () => { D.clearColor = Number($("dtClear").value); sync(); schedule(0); });
    $("dtSeed").addEventListener("click", () => { D.seed = Math.floor(Math.random() * 99999) + 1; schedule(0); });
    $("dtOutput").addEventListener("change", () => { output = $("dtOutput").value; saveJSON("gf:ditherOutput", output); });
    // edit pixels
    $("dtPaintBtn").addEventListener("click", () => setMode("paint"));
    $("dtBrushTool").addEventListener("change", () => { B.tool = $("dtBrushTool").value; saveBrush(); sync(); });
    h.onCheck($("dtBrushRound"), (v) => { B.round = v; saveBrush(); });
    $("dtToolSwatch").addEventListener("click", async () => {
      try { const v = await askColor(B.color); if (v) { B.color = v; saveBrush(); sync(); } } catch (e) { console.error(e); status("Colour picker unavailable — type a hex value instead.", true); }
    });
    $("dtToolHex").addEventListener("change", () => { const v = validHex($("dtToolHex").value); if (v) { B.color = v; saveBrush(); } sync(); });
    $("dtEditUndo").addEventListener("click", () => { D.edits = D.edits.slice(0, -1); sync(); schedule(0); });
    $("dtEditClear").addEventListener("click", () => { D.edits = []; sync(); schedule(0); status("No hand edits. ↶ Undo brings them back."); });
    $("dtSource").addEventListener("change", () => { pv = null; schedule(0); });
    $("dtArtboard").addEventListener("change", () => { pv = null; schedule(0); });
    $("dtRefresh").addEventListener("click", () => { stale++; schedule(0); });
    viewer = createViewer({
      wrap: $("dtPreviewWrap"), img: $("dtPreview"), msg: $("dtPreviewMsg"), bar: $("dtZoomBar"), grip: $("dtPreviewGrip"), head: $("dtPreviewHead"), storeKey: "gf:zoom:dither", onLayout: () => h.fitLayout(true),
      docSize: () => (pv ? { w: pv.frame.w, h: pv.frame.h } : null), render: renderRegion,
      onError: (e) => { console.error(e); status(errMsg(e), true); },
      onEditToggle: () => setMode("paint"), editTitle: "Paint pixels: click or drag on the preview with the brush from Edit pixels",
    });
    glitchUI = setupGlitchUI({ prefix: "dt", $, get: () => D, changed: () => schedule(), onCheck: h.onCheck, before: true });
    $("dtApply").addEventListener("click", () => apply(false));
    $("dtLive").addEventListener("click", toggleLive);
    $("dtExportSvg").addEventListener("click", exportSVG);
    $("dtUpdate").addEventListener("click", () => apply(true));
    $("dtStopEdit").addEventListener("click", stopEditing);
    $("dtLoad").addEventListener("click", loadSelected);
    sync();
    hist.note();
  }
  build();

  return {
    apply, preview: renderPreview, stopEditing, exportSVG, settings: () => D, editing: () => editing, setOutput: (o) => { output = o; }, // used by the Photoshop tests
    useLook: (id) => { const st = Dither.STYLES.find((x) => x.id === id); if (st) applyLook(st.s); }, randomize, undo: () => hist.undo(), toggleLive, live: () => live,
    relayout: () => viewer && viewer.relayout(),
    get viewer() { return viewer; },
    activate() { active = true; schedule(0); },
    deactivate() { active = false; clearTimeout(pvTimer); },
    onPsEvent(evt, desc) {
      if (evt === "close") live.check();
      if (busy) return;
      if (live.on && live.isLiveDoc(h.activeDoc())) return;
      const ref = desc && desc._target && desc._target[0] && desc._target[0]._ref;
      if (evt === "select" && ref === "layer" && (editing || $("dtSource").value === "merged")) return;
      stale++;
      schedule(350);
    },
  };
};
