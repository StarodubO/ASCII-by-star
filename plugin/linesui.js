// "Lines" tab: panel UI and Photoshop I/O for the line art in lines.js (topographic contours, ridge lines).
// Reads the source (a layer or the visible image) once at the analysis size, builds the height field from its
// brightness, from another layer (a depth map) or from a place on the map (map.js), and writes one pixel layer "<source> Line Art" right above
// the source. The source layer itself is never changed.
"use strict";
const { core, imaging, constants } = require("photoshop");
const uxp = require("uxp");
const lfs = uxp.storage.localFileSystem, formats = uxp.storage.formats;
const Lines = require("./lines.js");
const { CHARSETS } = require("./charsets.js");
const MapHeights = require("./map.js");
const { makeSlider, onDoubleClick, SLIDER_HTML } = require("./slider.js");
const Glitch = require("./glitch.js");
const { setupGlitchUI } = require("./glitchui.js");
const { createViewer } = require("./viewer.js");
const { makePresetBox } = require("./presetbox.js");
const { makeHistory } = require("./history.js");
const { createLive, isSmart } = require("./live.js");
const { findLayers, findLayerById, frameOf, fillArtboardSelect, convertOut, makeImageData, makeReader, throwawayStep, withoutSelection } = require("./pixels.js");

const OUT_RE = /\s*Line Art$/;
const TILE = 1024;

const pct = (v) => Math.round(v * 100) + "%";
const signed = (v) => (v > 0 ? "+" : "") + Math.round(v * 100) + "%";
const deg = (v) => Math.round(v) + "°";
// [label, min, max, step, format, tooltip]; format "px" shows reference sizes in this document's pixels
const SLIDERS = {
  smooth: ["Smoothing", 0, 60, 0.5, "px", "Blurs the height before the lines are traced. More smoothing gives rounder, calmer lines; less follows every detail."],
  levels: ["Lines", 2, 250, 1, (v) => String(Math.round(v)), "How many contour lines run from the lowest to the highest point. Fewer lines = wider gaps."],
  mapInterval: ["Every", 0, 1000, 5, (v) => (v ? Math.round(v) + " m" : "off"), "A line every so many metres, on round heights (like a real map). Off uses the Lines count."],
  offset: ["Shift", 0, 1, 0.01, pct, "Slides every line up or down the slope, to move them off or onto an edge."],
  declutter: ["Declutter", 0, 30, 0.5, "px", "Lines closer together than this fade out on steep slopes (index lines stay), as on a printed map."],
  rows: ["Rows", 4, 300, 1, (v) => String(Math.round(v)), "Number of ridge lines from top to bottom. Fewer rows = wider gaps."],
  amp: ["Ridge height", 0, 30, 0.1, (v) => v.toFixed(1) + " rows", "How far the highest points lift a line, in row spacings."],
  lineWidth: ["Line width", 0, 20, 0.1, "px", "Thickness of the lines."],
  toneWeight: ["Width from tone", -1, 1, 0.01, signed, "Plus: lines get thicker where the source is dark. Minus: where it is light."],
  heightWeight: ["Width from height", -1, 1, 0.01, signed, "Plus: lines get thicker higher up. Minus: lower down."],
  indexEvery: ["Index line every", 0, 20, 1, (v) => (Math.round(v) ? Math.round(v) + "" : "off"), "Every Nth line is drawn thicker, like the index contours of a map."],
  indexWidth: ["Index width", 1, 5, 0.1, (v) => "×" + v.toFixed(1), "How much thicker the index lines are."],
  lineAngle: ["Angle", -180, 180, 1, deg, "Direction of the gradient: 90° runs from the bottom (start) to the top (end)."],
  lineGradFrom: ["Start", 0, 1, 0.01, pct, "Where the low (start) colour begins: the part of the height below it stays that colour."],
  lineGradTo: ["End", 0, 1, 0.01, pct, "Where the high (end) colour is reached: the part above it stays that colour."],
  lineGradMid: ["Middle at", 0.05, 0.95, 0.01, pct, "Where the middle colour sits between the start and the end."],
  lineGradCurve: ["Curve", -1, 1, 0.01, signed, "Plus: more of the high colour. Minus: more of the low colour."],
  lineGradSteps: ["Steps", 0, 24, 1, (v) => (Math.round(v) >= 2 ? Math.round(v) + "" : "smooth"), "Hard colour bands instead of a smooth blend."],
  lineGradRepeat: ["Repeats", 1, 20, 1, (v) => "×" + Math.round(v), "Runs the colours this many times from low to high."],
  sampleSat: ["Saturation", 0, 2, 0.01, pct, "Saturation of the colours sampled from the image."],
  sampleBright: ["Brightness", -1, 1, 0.01, signed, "Lighter or darker sampled colours."],
  lineOpacity: ["Opacity", 0, 1, 0.01, pct, "Opacity of the lines."],
  bgAngle: ["Angle", -180, 180, 1, deg, "Direction of the background gradient: 90° runs from the bottom (colour) to the top (end colour)."],
  bandOpacity: ["Fill opacity", 0, 1, 0.01, pct, "How strongly the fill covers the background."],
  shade: ["Shading", 0, 1, 0.01, pct, "Hill shading: slopes facing the light get lighter, the others darker."],
  shadeAngle: ["Light from", -180, 180, 1, deg, "Where the light comes from (Photoshop's angles: 90° = top, 135° = top left)."],
  labelEvery: ["Label every", 1, 10, 1, (v) => (Math.round(v) === 1 ? "line" : Math.round(v) + "th line"), "Labels on every index line, or only on every 2nd, 3rd…"],
  labelSpacing: ["Label spacing", 100, 3000, 10, "px", "The least distance between two labels."],
  labelSize: ["Size", 6, 150, 0.5, "px", "Height of the numbers."],
  peaks: ["Spot heights", 0, 40, 1, (v) => (Math.round(v) ? Math.round(v) + "" : "off"), "Marks the highest points with ▲ and their height."],
  peakSpacing: ["Spot spacing", 100, 3000, 10, "px", "The least distance between two spot heights."],
  shadeRelief: ["Relief", 0.2, 20, 0.1, (v) => "×" + v.toFixed(1), "How steep the shading treats the slopes."],
  ptSize: ["Size", 4, 200, 0.5, "px", "Height of the characters on the lines."],
  ptSpacing: ["Spacing", 0.5, 4, 0.01, (v) => "×" + v.toFixed(2), "Space between the characters along a line (×1 = like monospaced text)."],
  ptRoom: ["Room", 0, 3, 0.01, (v) => (v > 0 ? "×" + v.toFixed(2) : "off"), "No characters where the lines run closer together than this (× the size), so the text doesn't pile up on steep slopes."],
  mzSpacing: ["Spacing", 2, 60, 0.5, "px", "Space between the lines where the height is lowest (dark areas, or far in a depth map)."],
  mzRange: ["Contrast", 1, 12, 0.1, (v) => "×" + v.toFixed(1), "How much wider apart the lines are where the height is highest (light areas): ×1 = the same everywhere."],
  mzCurve: ["Balance", 0.25, 4, 0.01, (v) => v.toFixed(2), "Above 1: more of the picture gets the close lines. Below 1: more gets the wide ones."],
  pcSpacing: ["Spacing", 1, 60, 0.1, "px", "Distance between neighbouring points before any are left out. Smaller = more points."],
  pcJitter: ["Scatter", 0, 1, 0.01, pct, "0 = points on a regular grid, 100% = scattered at random."],
  pcToneDensity: ["Density from tone", -1, 1, 0.01, signed, "Plus: more points where the source is dark. Minus: where it is light."],
  pcHeightDensity: ["Density from height", -1, 1, 0.01, signed, "Plus: more points high up (near, in a depth map). Minus: low down."],
  pcCut: ["Cut below", 0, 1, 0.01, (v) => (v > 0 ? pct(v) : "off"), "No points lower than this height: drops the background of a depth map."],
  pcDepth: ["Depth", 0, 1.5, 0.01, pct, "How far the highest points come towards you (× the picture's long side)."],
  pcYaw: ["Turn", -90, 90, 1, deg, "Turns the view left or right."],
  pcPitch: ["Tilt", -90, 90, 1, deg, "Tilts the view up or down."],
  pcPersp: ["Perspective", 0, 1, 0.01, (v) => (v > 0 ? pct(v) : "flat"), "0 = flat (no perspective); more = near points spread out and grow, like a wide-angle lens."],
  pcZoom: ["Zoom", 0.2, 3, 0.01, (v) => "×" + v.toFixed(2), "The size of the cloud in the picture."],
  pcSizeNear: ["Near points", 0, 2, 0.01, (v) => "×" + v.toFixed(2), "How much bigger near points are: ×1 = as the perspective gives, 0 = all the same size."],
  pcFog: ["Fog", 0, 1, 0.01, pct, "Far points fade out."],
  ptLineOpacity: ["Lines under", 0, 1, 0.01, pct, "The lines themselves under the text: 0 = only the text."],
  prLength: ["Stream length", 2, 60, 1, (v) => Math.round(v) + " chars", "How many characters a stream of rain has (on average)."],
  prLengthVar: ["Length varies", 0, 1, 0.01, pct, "How much the streams' lengths differ."],
  prGaps: ["Gaps", 0, 4, 0.01, (v) => "×" + v.toFixed(2), "The empty stretch after each stream, × its length. 0 = streams touch."],
  prFade: ["Tail fade", 0, 1, 0.01, pct, "The tail of each stream fades out: 0 = every character as bright as the head."],
};
const CONTOUR_ONLY = ["offset", "declutter", "indexEvery", "indexWidth"];
const RIDGE_ONLY = ["rows", "amp"];
const MAZE_ONLY = ["mzSpacing", "mzRange", "mzCurve"];
const POINTS_ONLY = ["pcSpacing", "pcJitter", "pcToneDensity", "pcHeightDensity", "pcCut"];
// setting → swatch/hex id prefix
const COLOURS = { lineColor: "lnLine", lineA: "lnLineA", lineMid: "lnLineMid", lineB: "lnLineB", indexColor: "lnIndex", bgColor: "lnBg", bgColor2: "lnBg2", bandA: "lnBandA", bandMid: "lnBandMid", bandB: "lnBandB", labelColor: "lnLabel", ptMsgColor: "lnPtMsg", prColor: "lnPr", prHeadColor: "lnPrHead" };
const CHECKS = { lnInvert: "invert", lnEqualize: "equalize", lnFollow: "followShape", lnSeaFloor: "seaFloor", lnRidgeLocal: "ridgeLocal", lnLineMidOn: "lineMidOn", lnIndexColorOn: "indexColorOn", lnBandMidOn: "bandMidOn", lnLabelsOn: "labelsOn", lnLabelUphill: "labelUphill", lnLabelGap: "labelGap", lnLabelColorOn: "labelColorOn", lnTextOn: "textOn", lnPtRotate: "ptRotate", lnPtVertical: "ptVertical", lnPtReadable: "ptReadable", lnPtMsgColorOn: "ptMsgColorOn", lnPrReverse: "prReverse", lnPrColorOn: "prColorOn", lnPrHead: "prHead", lnLineGradMirror: "lineGradMirror", lnLineGradReverse: "lineGradReverse" };
// The picture's own settings: where the height comes from. Presets and Randomize leave them alone.
// The lines you chose (ptPicks) belong to the picture too.
const PICTURE_KEYS = ["heightFrom", "heightLayer", "mapPlace", "mapLat", "mapLon", "mapName", "mapWidthKm", "seaFloor", "mapInterval", "invert", "equalize", "followShape", "ptPicks"];
// The text on the lines and its rain: kept by looks (and Randomize) that don't set them.
const TEXT_KEYS = Object.keys(Lines.DEFAULTS).filter((k) => k === "textOn" || k === "textMode" || (/^p[tr][A-Z]/.test(k) && k !== "ptPicks"));
const PICK_MODES = { text: "own text", rain: "Matrix rain", line: "line only", hide: "hidden" };
// Colour sets for Randomize: background, line, gradient start / middle / end
const PALETTES = [
  ["#f6f1e3", "#5a3a1e", "#5e8c61", "#e9dfb4", "#f8f4ee"], ["#ffffff", "#111111", "#1b3a4b", "#c1666b", "#e8c170"],
  ["#07071a", "#4cc9f0", "#3a0ca3", "#f72585", "#4cc9f0"], ["#0b0b0e", "#e5e5e5", "#2b2d42", "#8d99ae", "#edf2f4"],
  ["#fdf0d5", "#003049", "#003049", "#c1121f", "#fdf0d5"], ["#10002b", "#e0aaff", "#240046", "#7b2cbf", "#e0aaff"],
  ["#f1faee", "#1d3557", "#1d3557", "#457b9d", "#a8dadc"], ["#000000", "#ffffff", "#264653", "#e9c46a", "#e76f51"],
  ["#eae2b7", "#3d405b", "#3d405b", "#81b29a", "#f2cc8f"], ["#1a1a1a", "#ff6b35", "#004e89", "#ff6b35", "#f7c59f"],
];
const SELECTS = { lnPcShape: "pcShape", lnStyle: "style", lnHeightFrom: "heightFrom", lnLineFrom: "lineFrom", lnBgMode: "bgMode", lnBands: "bands", lnLabelUnits: "labelUnits", lnTextMode: "textMode", lnPtWhich: "ptWhich", lnPtSet: "ptSet" };

module.exports = function setupLines(h) {
  const { $, loadJSON, saveJSON, errMsg, createLayer, bitDepth, isGray, checkDoc, askColor, selectLayer, docBaseName } = h;
  // the document the tab works on: the active one, or the live window's source while the .psb is in front
  const activeDoc = () => live.sourceDoc(h.activeDoc());

  const fresh = (over) => {
    const s = JSON.parse(JSON.stringify(Lines.DEFAULTS));
    if (over) for (const k of Object.keys(s)) if (over[k] !== undefined) s[k] = over[k];
    return Lines.migrate(s);
  };
  let L = fresh(loadJSON("gf:lines:last", null));
  let active = false, busy = false, editing = null; // editing: {docId, layerId, name, sourceLayerId}
  let stale = 0, docLong = Lines.REF, viewer = null;
  let reads = null; // {key, img, height}: the source (and height layer) at the analysis size
  let field = null; // {key, F}
  let mapData = null; // {key, grid}: the map region's heights at the analysis size
  const sliderEls = {};
  let pickerSync = null; // shows the font in the font picker
  let picking = false, curPick = 0, pickShown = -1; // choosing lines on the preview; the chosen line the panel shows

  function status(msg, isErr) { const el = $("lnStatus"); el.textContent = msg || ""; el.style.color = isErr ? "#ff7070" : ""; }
  // every change is saved and noted for ↶ Undo (slider drags make one step per pause)
  const hist = makeHistory({
    state: () => JSON.stringify(L),
    restore: (st) => { L = fresh(JSON.parse(st)); saveJSON("gf:lines:last", L); sync(); schedule(0); },
    onAvail: (can) => { $("lnUndo").disabled = !can; },
  });
  const save = () => { saveJSON("gf:lines:last", L); hist.note(); };
  // the glyphs: the built-in atlas, or one that also has the characters typed for the text on the lines
  let textAtlas = null;
  const atlas = () => (Lines.textChars(L) && textAtlas) || (h.baseAtlas ? h.baseAtlas() : null);
  const markAtlas = () => (L.ptFont && h.baseAtlas ? h.baseAtlas() : null); // height labels stay in the built-in font
  // The glitch: on the picture before the lines (glitchImg on the analysis image), or on the result (draw)
  const glitchBefore = (s) => s.glWhere === "before" && Glitch.active(s);
  function glitchImg(img, frame, s) {
    if (!img || !glitchBefore(s)) return img;
    const d = new Uint8Array(img.data);
    Glitch.apply(d, img.w, img.h, 0, 0, img.w / frame.w, frame.w, frame.h, s);
    return { w: img.w, h: img.h, data: d };
  }
  const draw = (F, s, rect, z, frame, cache) => (!glitchBefore(s) && Glitch.active(s)
    ? Glitch.renderWith((r, zz) => Lines.render(F, s, r, zz, atlas(), markAtlas()), rect, z, frame.w, frame.h, s, cache)
    : Lines.render(F, s, rect, z, atlas(), markAtlas()));
  const pvStrips = new Map(); // the glitch's full-width strips for the preview
  let glitchUI = null;
  async function readyText() { // outside executeAsModal: may render the font in Photoshop
    const chars = Lines.textChars(L);
    if (!chars || !h.atlasFor) return;
    try { textAtlas = await h.atlasFor(chars, L.ptFont || "", L.ptFontName || ""); }
    catch (e) { console.error(e); textAtlas = null; if (L.ptFont) status(`Couldn't render ${L.ptFontName || L.ptFont}: ${errMsg(e)}. Using the built-in font.`, true); }
  }
  const live = createLive({ btn: $("lnLive"), label: "Line art", status, errMsg });
  const isGroup = (l) => l && (l.kind === constants.LayerKind.GROUP || String(l.kind) === "group");
  const isOurs = (l) => l && !isGroup(l) && OUT_RE.test(String(l.name));
  const recKey = (doc, id) => `gf:lines:${doc.title}:${id}`;
  function remember(doc, layer, sourceLayerId) {
    const rec = { settings: L, source: $("lnSource").value, sourceLayerId };
    saveJSON(recKey(doc, layer.id), rec);
    saveJSON("gf:linesName:" + layer.name, rec);
  }
  const recall = (doc, l) => loadJSON(recKey(doc, l.id), null) || loadJSON("gf:linesName:" + l.name, null);
  const artboardPick = () => $("lnArtboard").value || "auto";

  // ---------- source ----------
  // {layerId, name}: layerId null = the visible image
  function resolveSource(doc) {
    if (editing && editing.docId === doc.id) {
      if (editing.sourceLayerId == null) return { layerId: null, name: docBaseName(doc) };
      const l = findLayerById(doc, editing.sourceLayerId);
      if (l) return { layerId: l.id, name: String(l.name) };
      throw new Error("The layer this line art was made from no longer exists.");
    }
    if ($("lnSource").value === "merged") return { layerId: null, name: docBaseName(doc) };
    const al = doc.activeLayers && doc.activeLayers[0];
    if (!al) throw new Error("Select the layer to draw lines from.");
    if (isOurs(al)) {
      const rec = recall(doc, al), l = rec && rec.sourceLayerId != null ? findLayerById(doc, rec.sourceLayerId) : null;
      if (l) return { layerId: l.id, name: String(l.name) };
      throw new Error("Select the layer to draw lines from (not a Line Art layer).");
    }
    if (isGroup(al)) throw new Error("Select a single layer, not a group, or use Source: Visible.");
    return { layerId: al.id, name: String(al.name) };
  }
  // The height layer, when the height comes from another layer.
  function heightLayerOf(doc) {
    if (L.heightFrom === "map") return null;
    if (L.heightFrom !== "layer") return null;
    const l = L.heightLayer != null ? findLayerById(doc, L.heightLayer) : null;
    if (!l) throw new Error("Choose the layer to take the height from (a depth map, for example).");
    return l;
  }
  // Fills the height layer menu with the document's pixel layers (not groups, not our own output).
  function fillHeightLayers(doc) {
    const sel = $("lnHeightLayer"), esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const layers = doc ? findLayers(doc.layers, (l) => !isGroup(l) && !isOurs(l)) : [];
    const html = '<option value="">Choose a layer…</option>' + layers.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("");
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = L.heightLayer != null && layers.some((l) => l.id === L.heightLayer) ? String(L.heightLayer) : "";
    if (sel.ddUpdate) sel.ddUpdate();
  }

  // Runs fn with every Line Art layer hidden, so reads of the visible image don't include earlier output.
  async function withOutputsHidden(doc, fn) {
    const hidden = findLayers(doc.layers, (l) => isOurs(l) && l.visible);
    for (const l of hidden) l.visible = false;
    try { return await fn(); } finally { for (const l of hidden) { try { l.visible = true; } catch (e) { /* deleted */ } } }
  }
  // Reads the source (and the height layer) over the frame at the analysis size. Inside executeAsModal.
  async function readSources(doc, src, frame) {
    const z = Lines.analysisZ(frame.w, frame.h), R = { x: frame.x * z, y: frame.y * z, w: Math.max(1, Math.round(frame.w * z)), h: Math.max(1, Math.round(frame.h * z)) };
    const read = async (layerId) => { const r = makeReader(doc, layerId); try { return { w: R.w, h: R.h, data: await r.read(R, z) }; } finally { await r.close(); } };
    const hl = heightLayerOf(doc);
    return withOutputsHidden(doc, async () => ({ img: await read(src.layerId), height: hl ? await read(hl.id) : null }));
  }
  // ---------- the map ----------
  const mapKeyOf = (frame) => { const z = Lines.analysisZ(frame.w, frame.h); return [L.mapLat, L.mapLon, L.mapWidthKm, Math.max(1, Math.round(frame.w * z)), Math.max(1, Math.round(frame.h * z))].join("|"); };
  // The heights of the map region at the analysis size of `frame` (loaded once per place, size and frame).
  // The area comes from the Map tab (h.mapArea): copied into L, so a saved Line Art layer keeps its own.
  function takeArea() {
    const a = h.mapArea && h.mapArea();
    if (!a || a.lat == null || (editing && L.mapLat != null)) return;
    Object.assign(L, { mapPlace: a.place || "", mapLat: a.lat, mapLon: a.lon, mapName: a.name || "", mapWidthKm: a.widthKm });
  }
  async function mapGrid(frame) {
    takeArea();
    if (L.mapLat == null) throw new Error("Choose an area in the Map tab first (Height ▸ Choose the area).");
    const key = mapKeyOf(frame);
    if (mapData && mapData.key === key) return mapData.grid;
    const z = Lines.analysisZ(frame.w, frame.h), w = Math.max(1, Math.round(frame.w * z)), hh = Math.max(1, Math.round(frame.h * z));
    const grid = await MapHeights.loadRegion({ lat: L.mapLat, lon: L.mapLon, widthKm: L.mapWidthKm, w, h: hh, fetchFn: fetch, onProgress: (d, n) => status(`Loading the map… ${d}/${n} tiles`) });
    mapData = { key, grid };
    showMapInfo();
    return grid;
  }
  function showMapInfo() {
    const g = mapData && mapData.grid, where = L.mapName || (L.mapLat != null ? `${L.mapLat.toFixed(4)}, ${L.mapLon.toFixed(4)}` : "");
    $("lnMapInfo").textContent = !where ? "No area yet: choose one in the Map tab."
      : `${where} · ${L.mapWidthKm < 10 ? L.mapWidthKm.toFixed(1) : Math.round(L.mapWidthKm)} km wide${g ? ` · ${Math.round(L.seaFloor ? g.min : Math.max(0, g.min))}–${Math.round(g.max)} m` : ""}`;
  }
  const fieldKey = (readKey, mapKey) => [readKey, mapKey, L.invert, L.equalize, L.smooth, L.seaFloor, L.mapInterval > 0, L.shade > 0, glitchBefore(L) ? Glitch.keyOf(L) : ""].join("|");
  function fieldFor(readKey, frame, mapHeights) {
    const key = fieldKey(readKey, mapHeights ? mapData.key : "");
    if (!field || field.key !== key) field = { key, F: Lines.prepare(glitchImg(reads.img, frame, L), mapHeights || reads.height, L, frame.w, frame.h) };
    return field.F;
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

  let pv = null; // {doc, src, srcKey, frame, F}
  async function renderPreview() {
    const doc = activeDoc();
    if (!doc) { viewer.showMessage("Open a document to begin"); status(""); return; }
    checkDoc(doc);
    fillHeightLayers(doc);
    const src = resolveSource(doc);
    await fillArtboardSelect($("lnArtboard"), $("lnArtboardRow"), doc);
    const frame = await frameOf(doc, src.layerId, artboardPick());
    docLong = Math.max(frame.w, frame.h);
    refreshPx();
    const srcKey = [doc.id, src.layerId, frame.x, frame.y, frame.w, frame.h].join("|");
    const readKey = [srcKey, doc.width, doc.height, stale, L.heightFrom === "layer" ? L.heightLayer : ""].join("|");
    if (!reads || reads.key !== readKey) {
      busy = true;
      try { reads = Object.assign({ key: readKey }, await core.executeAsModal((ctx) => throwawayStep(ctx, doc, () => readSources(doc, src, frame)), { commandName: "Line art: read pixels" })); }
      finally { busy = false; }
    }
    const heights = L.heightFrom === "map" ? await mapGrid(frame) : null;
    await readyText();
    const t0 = Date.now(), F = fieldFor(readKey, frame, heights);
    if (!pv || pv.srcKey !== srcKey) viewer.setCentre(frame.w / 2, frame.h / 2);
    pv = { doc, src, srcKey, frame, F, prepMs: Date.now() - t0 };
    if ((L.ptPicks || []).length) fillPickList(); // (the heights of the chosen lines)
    pvStrips.clear(); // the settings may have changed
    await viewer.refresh();
    if (live.on && live.info().sourceDocId === doc.id) { const s = JSON.parse(JSON.stringify(L)); const c = new Map(), fr = pv.frame; live.update((v) => draw(F, s, v, 1, fr, c)); }
  }

  // ---------- live smart object ----------
  // The line art as a smart object above the source, its contents open as the live window (live.js).
  async function toggleLive() {
    if (live.on) return live.close();
    const doc = activeDoc();
    try { checkDoc(doc); } catch (e) { return status(e.message, true); }
    clearTimeout(pvTimer);
    while (pvRunning) await pvRunning;
    try { if (!pv || pv.doc.id !== doc.id) await renderPreview(); } catch (e) { return status(errMsg(e), true); }
    if (!pv) return;
    const { src, frame, F } = pv, s = JSON.parse(JSON.stringify(L)), old = editing && editing.docId === doc.id ? findLayerById(doc, editing.layerId) : null;
    busy = true;
    let so = null;
    try {
      so = await live.open({
        doc, frame, name: `${src.name.replace(OUT_RE, "").trim() || docBaseName(doc)} Line Art`, reuse: isSmart(old) ? old : null, draw: ((c) => (v) => draw(F, s, v, 1, frame, c))(new Map()),
        place: async (layer) => { // right above the source (or at the top)
          const sl = src.layerId != null ? findLayerById(doc, src.layerId) : null, board = frame.artboardId != null ? findLayerById(doc, frame.artboardId) : null;
          if (sl) await layer.move(sl, constants.ElementPlacement.PLACEBEFORE);
          else if (board && board.layers && board.layers.length) await layer.move(board.layers[0], constants.ElementPlacement.PLACEBEFORE);
          else if (doc.layers[0].id !== layer.id) await layer.move(doc.layers[0], constants.ElementPlacement.PLACEBEFORE);
        },
      });
    } finally { busy = false; }
    if (!so) return;
    remember(doc, so, src.layerId);
    editing = { docId: doc.id, layerId: so.id, name: String(so.name), sourceLayerId: src.layerId };
    showEditing();
  }
  // The preview of frame rect `rect` at scale z, as RGB (over the source, as the layer would sit above it).
  async function renderRegion(rect, z) {
    if (!pv) return null;
    const s = picking && L.ptPicks[curPick] ? Object.assign({}, L, { _pickHi: curPick }) : L; // the chosen line outlined while choosing
    const t0 = Date.now(), px = draw(pv.F, s, rect, z, pv.frame, pvStrips), W = Math.max(1, Math.round(rect.w * z)), H = Math.max(1, Math.round(rect.h * z));
    const rgb = Lines.composite(px, Lines.sourceRGB(pv.F, rect, z), W * H);
    status(`${L.heightFrom === "map" ? mapLabel(pv.F) : pv.src.layerId == null ? "Visible image" : "“" + pv.src.name + "”"}${L.heightFrom === "layer" ? " · height from a layer" : ""} · ${Date.now() - t0 + pv.prepMs} ms`);
    return { rgb, w: W, h: H };
  }

  // "Map · 750–4062 m · a line every 100 m"
  function mapLabel(F) {
    if (!F.metres) return "Map";
    const span = F.metres.hi - F.metres.lo, every = L.mapInterval > 0 ? L.mapInterval : span / Math.max(1, L.levels);
    return `Map · ${Math.round(F.metres.lo)}–${Math.round(F.metres.hi)} m${L.style === "contours" ? ` · a line every ${every < 10 ? every.toFixed(1) : Math.round(every)} m` : ""}`;
  }

  // ---------- apply ----------
  async function apply(update) {
    const doc = activeDoc();
    try { checkDoc(doc); } catch (e) { return status(e.message, true); }
    if (update && (!editing || editing.docId !== doc.id)) return status("The line art being edited is in another document. Switch back to it.", true);
    clearTimeout(pvTimer);
    while (pvRunning) await pvRunning;
    const t0 = Date.now();
    let heights = null;
    if (L.heightFrom === "map") { // loaded outside executeAsModal: it waits on the network
      try { heights = await mapGrid(await frameOf(doc, resolveSource(doc).layerId, artboardPick())); } catch (e) { return status(errMsg(e), true); }
    }
    await readyText();
    busy = true;
    try {
      await core.executeAsModal(async (ctx) => {
        const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: update ? "Line art update" : "Line art" });
        try {
          const src = resolveSource(doc), frame = await frameOf(doc, src.layerId, artboardPick());
          let layer = update ? findLayerById(doc, editing.layerId) : null;
          if (update && !layer) throw new Error("The Line Art layer being edited no longer exists.");
          if (update && isSmart(layer)) throw new Error("This Line Art is a smart object: change it with Open live smart object.");
          const r = await readSources(doc, src, frame);
          if (heights && mapData.key !== mapKeyOf(frame)) throw new Error("The area changed while the map was loading. Press Apply again.");
          const F = Lines.prepare(glitchImg(r.img, frame, L), heights || r.height, L, frame.w, frame.h), strips = new Map();
          if (!layer) {
            const sl = src.layerId != null ? findLayerById(doc, src.layerId) : null;
            if (sl) await selectLayer(sl); // the new layer appears above the selection
            layer = await createLayer(doc, `${src.name.replace(OUT_RE, "").trim() || docBaseName(doc)} Line Art`);
            const board = frame.artboardId != null ? findLayerById(doc, frame.artboardId) : null;
            if (sl) { if (layer.id !== sl.id) await layer.move(sl, constants.ElementPlacement.PLACEBEFORE); }
            else if (board && board.layers && board.layers.length) { if (board.layers[0].id !== layer.id) await layer.move(board.layers[0], constants.ElementPlacement.PLACEBEFORE); }
            else if (doc.layers[0].id !== layer.id) await layer.move(doc.layers[0], constants.ElementPlacement.PLACEBEFORE);
          }
          const depth = bitDepth(doc), gray = isGray(doc);
          let profile = null;
          try { profile = doc.colorProfileName || null; } catch (e) { profile = null; }
          const nT = Math.ceil(frame.w / TILE) * Math.ceil(frame.h / TILE);
          let k = 0;
          await withoutSelection(doc, async () => {
            for (let ty = 0; ty < frame.h; ty += TILE) for (let tx = 0; tx < frame.w; tx += TILE) {
              status(`Drawing lines… tile ${++k}/${nT}`);
              const tw = Math.min(TILE, frame.w - tx), th = Math.min(TILE, frame.h - ty);
              const px = draw(F, L, { x: tx, y: ty, w: tw, h: th }, 1, frame, strips);
              const id = await makeImageData(convertOut(new Uint8Array(px.buffer), tw * th, depth, gray), tw, th, gray, profile);
              try { await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: id, replace: k === 1, targetBounds: { left: frame.x + tx, top: frame.y + ty }, commandName: "Line art" }); }
              finally { id.dispose(); }
            }
          });
          remember(doc, layer, src.layerId);
          editing = { docId: doc.id, layerId: layer.id, name: String(layer.name), sourceLayerId: src.layerId };
        } finally { await ctx.hostControl.resumeHistory(sid, true); }
      }, { commandName: "Line art" });
      showEditing();
      status(`${update ? "Updated" : "Added"} “${editing.name}” · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(e); status(errMsg(e), true);
    } finally { busy = false; }
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
      const { src, F } = pv;
      const svg = Lines.toSVG(F, L, atlas(), markAtlas());
      const name = `${src.name.replace(OUT_RE, "").trim() || docBaseName(doc)}-line-art.svg`;
      const file = await lfs.getFileForSaving(name, { types: ["svg"] });
      if (!file) return;
      await file.write(svg, { format: formats.utf8 });
      status(`Saved ${file.name}`);
    } catch (e) { console.error(e); status(errMsg(e), true); }
  }

  // ---------- editing ----------
  function showEditing() {
    $("lnEditLabel").textContent = editing ? "Editing: " + editing.name : "";
    $("lnEditBox").classList.toggle("hidden", !editing);
    h.fitLayout(true);
  }
  function loadSelected() {
    const doc = activeDoc(), al = doc && doc.activeLayers && doc.activeLayers[0];
    if (!isOurs(al)) return status("Select a Line Art layer.", true);
    const rec = recall(doc, al);
    if (!rec) return status("No saved settings for this layer on this computer.", true);
    L = fresh(rec.settings);
    $("lnSource").value = rec.source || "layer";
    if ($("lnSource").ddUpdate) $("lnSource").ddUpdate();
    editing = { docId: doc.id, layerId: al.id, name: String(al.name), sourceLayerId: rec.sourceLayerId == null ? null : rec.sourceLayerId };
    sync(); showEditing(); schedule(0);
    status("Loaded the settings of “" + al.name + "”.");
  }
  function stopEditing() { editing = null; showEditing(); pv = null; schedule(0); }

  // ---------- UI ----------
  const fmtPx = (v) => { const p = (v * docLong) / Lines.REF; return (p < 10 ? p.toFixed(1) : Math.round(p)) + " px"; };
  function refreshPx() { for (const [k, el] of Object.entries(sliderEls)) if (el.px) el.val.textContent = fmtPx(L[k]); }
  const setSel = (id, v) => { const el = $(id); el.value = String(v); if (el.ddUpdate) el.ddUpdate(); };
  const setChk = (id, v) => { const el = $(id); el.checked = !!v; if (el.syncChecked) el.syncChecked(); };
  const show = (id, on) => $(id).classList.toggle("hidden", !on);
  function sync() {
    for (const [k, el] of Object.entries(sliderEls)) { el.input.value = String(L[k]); el.val.textContent = el.px ? fmtPx(L[k]) : el.fmt(L[k]); }
    for (const [id, k] of Object.entries(SELECTS)) setSel(id, L[k]);
    for (const [id, k] of Object.entries(CHECKS)) setChk(id, L[k]);
    for (const [k, id] of Object.entries(COLOURS)) { $(id + "Swatch").style.backgroundColor = L[k]; $(id + "Hex").value = L[k]; }
    const ridges = L.style === "ridges", maze = L.style === "maze", points = L.style === "points", contours = !ridges && !maze && !points;
    const map = L.heightFrom === "map", interval = map && L.mapInterval > 0, grad = L.lineFrom === "height" || L.lineFrom === "across";
    for (const k of CONTOUR_ONLY) show("lsl-" + k, contours);
    for (const k of RIDGE_ONLY) show("lsl-" + k, ridges);
    for (const k of MAZE_ONLY) show("lsl-" + k, maze);
    for (const k of POINTS_ONLY) show("lsl-" + k, points);
    show("lnMzSeedRow", maze);
    show("lnPcSeedRow", points);
    show("lnViewBox", points);
    const wl = sliderEls.lineWidth && sliderEls.lineWidth.label;
    if (wl && wl.textContent !== (points ? "Point size" : "Line width")) wl.textContent = points ? "Point size" : "Line width";
    show("lnRidgeLocalRow", ridges);
    show("lsl-levels", contours && !interval);
    show("lsl-mapInterval", contours && map);
    show("lsl-indexWidth", contours && !!L.indexEvery);
    show("lnHeightLayerRow", L.heightFrom === "layer");
    show("lnMapBox", map);
    show("lnDepthHint", !map);
    $("lnInvertText").textContent = map ? "Low is high (flip the terrain)" : "Dark is high";
    show("lnLineColorRow", L.lineFrom === "own");
    show("lnLineGradRows", grad);
    show("lnLineMidRow", grad && L.lineMidOn);
    show("lsl-lineAngle", L.lineFrom === "across");
    show("lsl-lineGradMid", L.lineMidOn);
    show("lnLineGradMirrorRow", L.lineGradRepeat > 1);
    show("lnSampleRows", L.lineFrom === "image");
    show("lnIndexBox", contours && !!L.indexEvery);
    show("lnIndexColorRow", L.indexColorOn);
    show("lnBgColorRow", L.bgMode !== "transparent");
    show("lnBgGradRows", L.bgMode === "gradient");
    show("lnBandsBox", contours || maze);
    show("lnShadeBox", contours);
    show("lnLabelsBox", contours);
    show("lnBandRows", L.bands !== "none");
    show("lnBandMidBox", L.bands === "steps" || L.bands === "smooth");
    show("lnBandMidRow", L.bandMidOn);
    show("lnFollowRow", !map);
    show("lnEqualizeRow", !map);
    show("lnLabelRows", L.labelsOn);
    show("lsl-peakSpacing", L.peaks > 0);
    show("lnMarkRows", L.labelsOn || L.peaks > 0);
    show("lnLabelColorRow", L.labelColorOn);
    show("lnUnitsRow", map);
    show("lnTextBox", contours);
    show("lnTextRows", L.textOn);
    show("lnPtTextRows", L.textMode === "text");
    show("lnPtSetRows", L.textMode === "set");
    show("lnPtMsgColorRow", L.ptMsgColorOn);
    show("lnPtTurnRows", L.textMode !== "direction");
    if ($("lnPtText").value !== L.ptText) $("lnPtText").value = L.ptText;
    refreshTextApply();
    // single lines
    const picks = L.ptPicks || [];
    if (curPick >= picks.length) curPick = Math.max(0, picks.length - 1);
    show("lnPicksBox", contours);
    show("lnPickRows", picks.length > 0);
    fillPickList();
    const pk = picks[curPick];
    if (pk) {
      setSel("lnPickMode", pk.mode); setChk("lnPickAll", pk.all); setChk("lnPickColorOn", pk.colorOn);
      $("lnPickSwatch").style.backgroundColor = pk.color; $("lnPickHex").value = pk.color;
      if (pickShown !== curPick) { $("lnPickText").value = pk.text || ""; pickShown = curPick; }
    }
    show("lnPickTextRows", !!pk && pk.mode === "text");
    show("lnPickColorRow", !!pk && pk.colorOn);
    refreshPickApply();
    const pb = $("lnPickBtn"), pbl = picking ? "Done choosing" : "Choose lines on the preview";
    if (pb.textContent !== pbl) pb.textContent = pbl;
    pb.classList.toggle("primary", picking);
    // Matrix rain on the lines
    show("lnRainBox", contours && ((L.textOn && L.textMode === "rain") || picks.some((p) => p.mode === "rain")));
    show("lnPrColorRow", L.prColorOn);
    show("lnPrHeadRow", L.prHead);
    if ($("lnPrChars").value !== L.prChars) $("lnPrChars").value = L.prChars;
    refreshRainApply();
    if (pickerSync) pickerSync();
    showMapInfo();
    if (glitchUI) glitchUI.sync();
    if (h.refreshFields) h.refreshFields();
  }
  // A look (built-in or saved): every setting from it, except the picture's own (PICTURE_KEYS).
  // full (Reset): the text on the lines goes back to the look's too.
  function applyLook(st, full) {
    const keep = {};
    for (const k of PICTURE_KEYS) keep[k] = L[k];
    if (!full) for (const k of TEXT_KEYS) if (st[k] === undefined) keep[k] = L[k]; // the text on the lines stays unless the look has its own
    L = fresh(Object.assign({}, Lines.DEFAULTS, st, keep));
    sync(); schedule(0);
  }
  const useLook = (id) => { const st = Lines.STYLES.find((x) => x.id === id); if (st) applyLook(st.s); };
  const lookOnly = () => { const o = JSON.parse(JSON.stringify(L)); for (const k of PICTURE_KEYS) delete o[k]; return o; };
  const lookFrom = (st) => { const o = {}; for (const k of Object.keys(Lines.DEFAULTS)) if (!PICTURE_KEYS.includes(k) && st[k] !== undefined) o[k] = st[k]; return o; };

  // A random look: line style, spacing, widths, colours, fill and shading. The height settings stay.
  function randomize() {
    const R = Math.random, pick = (a) => a[Math.floor(R() * a.length)], between = (a, b) => a + (b - a) * R(), round = (v, d) => Math.round(v * d) / d;
    const [bg, line, a, m, b] = pick(PALETTES), dark = Lines.hexToRgb(bg).reduce((x, y) => x + y) < 300;
    const roll = R(), style = roll < 0.2 ? "ridges" : roll < 0.35 ? "maze" : roll < 0.5 ? "points" : "contours", ridges = style !== "contours";
    const lineFrom = pick(["own", "own", "image", "height", "across"]);
    const st = {
      style,
      mzSpacing: round(between(5, 14), 2), mzRange: round(between(2, 7), 10), mzCurve: round(between(0.7, 1.5), 100),
      pcSpacing: round(between(5, 14), 10), pcJitter: R() < 0.8 ? 1 : round(R(), 100), pcToneDensity: round(between(-0.3, 0.8), 100), pcHeightDensity: 0,
      pcDepth: round(between(0.15, 0.5), 100), pcYaw: Math.round(between(-40, 40)), pcPitch: Math.round(between(-25, 30)), pcPersp: round(between(0.2, 0.8), 100),
      pcZoom: 0.85, pcSizeNear: 1, pcFog: round(between(0, 0.6), 100), pcShape: R() < 0.8 ? "round" : "square",
      levels: Math.round(between(15, 120)), offset: round(R(), 100), declutter: R() < 0.3 ? round(between(1, 6), 2) : 0,
      rows: Math.round(between(30, 110)), amp: round(between(3, 14), 10), ridgeLocal: R() < 0.8,
      smooth: round(between(3, 18), 2),
      lineWidth: style === "points" ? round(between(2, 6), 10) : round(between(0.8, 4), 10), toneWeight: R() < 0.4 ? round(between(-0.5, 1), 100) : 0, heightWeight: R() < 0.3 ? round(between(-0.8, 0.8), 100) : 0,
      indexEvery: R() < 0.4 ? pick([4, 5, 10]) : 0, indexWidth: round(between(1.5, 3), 10),
      lineFrom, lineColor: line, lineA: a, lineMid: m, lineMidOn: R() < 0.5, lineB: b, lineAngle: Math.round(between(-180, 180)),
      sampleSat: round(between(0.8, 1.6), 100), sampleBright: dark ? round(between(0, 0.4), 100) : round(between(-0.4, 0), 100),
      lineOpacity: 1, indexColorOn: false,
      bgMode: R() < 0.2 ? "gradient" : "color", bgColor: bg, bgColor2: pick([a, m, b]), bgAngle: Math.round(between(-180, 180)),
      bands: style === "maze" ? (R() < 0.3 ? "alternate" : "none") : ridges || R() < 0.6 ? "none" : pick(["steps", "smooth", "alternate"]), bandA: a, bandMid: m, bandMidOn: R() < 0.5, bandB: b, bandOpacity: round(between(0.4, 1), 100),
      shade: !ridges && R() < 0.3 ? round(between(0.3, 0.8), 100) : 0, shadeAngle: 135, shadeRelief: round(between(2, 6), 10),
    };
    applyLook(st);
    status("Randomized. ↶ Undo goes back.");
  }
  function refreshTextApply() {
    const pending = $("lnPtText").value !== L.ptText, b = $("lnPtApply"), label = pending ? "Apply text" : "Applied";
    b.disabled = !pending; b.classList.toggle("primary", pending);
    if (b.textContent !== label) b.textContent = label;
  }
  function setColour(k, hex) { L[k] = hex; sync(); schedule(0); }
  function refreshRainApply() {
    const pending = $("lnPrChars").value !== L.prChars, b = $("lnPrApply"), label = pending ? "Apply characters" : "Applied";
    b.disabled = !pending; b.classList.toggle("primary", pending);
    if (b.textContent !== label) b.textContent = label;
  }

  // ---------- single lines (L.ptPicks) ----------
  const curPk = () => (L.ptPicks || [])[curPick];
  function refreshPickApply() {
    const pk = curPk(), pending = !!pk && $("lnPickText").value !== (pk.text || ""), b = $("lnPickApply"), label = pending ? "Apply text" : "Applied";
    b.disabled = !pending; b.classList.toggle("primary", pending);
    if (b.textContent !== label) b.textContent = label;
  }
  function fillPickList() {
    const sel = $("lnPickList"), picks = L.ptPicks || [], info = pv && pv.F && picks.length ? Lines.picksInfo(pv.F, L) : [];
    const html = picks.map((p, i) => {
      const f = info[i], where = !f ? "line" : !f.found ? "no line here now" : pv.F.metres ? `line at ${f.height} ${L.labelUnits === "ft" ? "ft" : "m"}` : `line ${f.height}`;
      return `<option value="${i}">${i + 1}. ${where}${p.all ? " (all at this height)" : ""} · ${PICK_MODES[p.mode] || p.mode}</option>`;
    }).join("");
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = String(curPick);
    if (sel.ddUpdate) sel.ddUpdate();
  }
  // Click on the preview: chooses the contour line nearest the click (or selects it when it's chosen already).
  const pickEditor = {
    down(p) {
      if (!pv || !pv.F) return;
      if (["ridges", "maze", "points"].includes(L.style)) return status("Single lines work on contour lines (Style ▸ Contours).", true);
      const hit = Lines.lineAt(pv.F, L, p.x, p.y);
      if (!hit || hit.d > Math.max(pv.frame.w, pv.frame.h) * 0.04) return status("No contour line there: click closer to a line.", true);
      const info = Lines.picksInfo(pv.F, L), had = info.findIndex((f) => f.line === hit.line);
      if (had >= 0) curPick = had;
      else {
        L.ptPicks = (L.ptPicks || []).concat([{ x: hit.x / pv.frame.w, y: hit.y / pv.frame.h, all: false, mode: "text", text: "", colorOn: false, color: "#e63946" }]);
        curPick = L.ptPicks.length - 1;
      }
      pickShown = -1;
      sync(); schedule(0);
      status(had >= 0 ? `Line ${curPick + 1} selected.` : `Chose the line ${pv.F.metres ? "at " + hit.height + " " + (L.labelUnits === "ft" ? "ft" : "m") : hit.height}. Set what it gets under Single lines.`);
    },
    move() {}, up() {},
  };
  function setPicking(on) {
    picking = !!on;
    if (viewer) { viewer.setEditor(picking ? pickEditor : null); viewer.refresh(); }
    sync();
    if (picking) status("Click a contour line in the preview to choose it. Option/Alt-drag moves the view.");
  }
  function changePick(fn) { const pk = curPk(); if (!pk) return; fn(pk); L.ptPicks = L.ptPicks.slice(); sync(); schedule(0); }

  function build() {
    for (const [key, [label, min, max, step, fmt, tip]] of Object.entries(SLIDERS)) {
      const host = $("lsl-" + key);
      host.innerHTML = `<div class="row" title="${tip}"><span class="label" title="${tip} Double-click the name or the handle to reset.">${label}</span>${SLIDER_HTML}<span class="val"></span></div>`;
      const val = host.querySelector(".val"), px = fmt === "px";
      const reset = () => { L[key] = Lines.DEFAULTS[key]; sync(); schedule(); };
      const input = makeSlider(host.querySelector(".slider"), min, max, step, (v) => { L[key] = v; val.textContent = px ? fmtPx(v) : fmt(v); if (key === "indexEvery" || key === "mapInterval" || key === "peaks" || key === "lineGradRepeat") sync(); schedule(); }, reset);
      onDoubleClick(host.querySelector(".label"), reset);
      onDoubleClick(val, reset);
      sliderEls[key] = { input, val, fmt, px, label: host.querySelector(".label") };
    }
    makePresetBox({
      $, loadJSON, saveJSON, setSelect: h.setSelect, status, errMsg, lfs, formats,
      ids: { select: "lnPreset", name: "lnPresetName", save: "lnPresetSave", del: "lnPresetDelete", exp: "lnPresetExport", imp: "lnPresetImport" },
      storeKey: "gf:linesPresets", builtIns: Lines.STYLES.map((x) => ({ id: x.id, name: x.name, settings: x.s })), builtInLabel: "Built-in looks",
      fileName: "ascii-by-star-line-looks.json", fileTag: "asciiByStarLines", current: lookOnly, apply: applyLook, fresh: lookFrom,
    });
    // Reset: the chosen look again, all of it (picking a look keeps the text on the lines)
    $("lnPresetReset").addEventListener("click", () => {
      const v = $("lnPreset").value, st = v.startsWith("b:") ? (Lines.STYLES.find((x) => x.id === v.slice(2)) || {}).s : v.startsWith("u:") ? (loadJSON("gf:linesPresets", [])[Number(v.slice(2))] || {}).settings : null;
      applyLook(st || {}, true);
      status("Back to the look.");
    });
    // Reset all: every setting to its default; only the map area (the Map tab's) stays
    $("lnResetAll").addEventListener("click", () => {
      const keep = {};
      for (const k of ["mapPlace", "mapLat", "mapLon", "mapName", "mapWidthKm"]) keep[k] = L[k];
      L = fresh(keep);
      sync(); schedule(0);
      status("Every setting is back to its default. ↶ Undo brings them back.");
    });
    $("lnRandom").addEventListener("click", randomize);
    $("lnUndo").addEventListener("click", () => { if (hist.undo()) status("Undone." + (hist.canUndo() ? "" : " Nothing more to undo.")); });
    for (const [id, k] of Object.entries(SELECTS)) $(id).addEventListener("change", () => { L[k] = $(id).value; sync(); schedule(0); });
    for (const [id, k] of Object.entries(CHECKS)) h.onCheck($(id), (v) => { L[k] = v; sync(); schedule(0); });
    const applyText = () => { L.ptText = $("lnPtText").value; sync(); schedule(0); };
    $("lnPtText").addEventListener("input", refreshTextApply);
    $("lnPtText").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) setTimeout(applyText, 0); }); // ⌘/Ctrl+Enter applies (Enter = a new row)
    $("lnPtRows").addEventListener("click", () => { // one row per line height, with the height written out
      const hs = pv && pv.F ? Lines.lineHeights(pv.F, L) : [];
      if (!hs.length) { status("No contour lines to list yet."); return; }
      const rows = String(L.ptText || "").split(/\r?\n/).filter((r) => r.trim()), first = rows[0] || "%h";
      L.ptText = hs.map((hgt, i) => (rows.length === hs.length ? rows[i] : first).replace(/%h/g, hgt)).join("\n");
      $("lnPtText").value = L.ptText; h.refreshFields && h.refreshFields();
      sync(); schedule(0);
      status(hs.length + " rows, one per line height, lowest first. Change any row and apply.");
    });
    $("lnPtSetReseed").addEventListener("click", () => { L.ptSeed = Math.floor(Math.random() * 99999) + 1; schedule(0); });
    $("lnPtApply").addEventListener("click", applyText);
    const fontPicker = h.makeFontPicker ? h.makeFontPicker("ln", () => ({ font: L.ptFont, name: L.ptFontName }), (ps, name) => { L.ptFont = ps; L.ptFontName = name; sync(); schedule(0); }) : null;
    pickerSync = () => fontPicker && fontPicker.fill();
    $("lnPtReseed").addEventListener("click", () => { L.ptSeed = Math.floor(Math.random() * 99999) + 1; schedule(0); });
    $("lnMzSeed").addEventListener("click", () => { L.mzSeed = Math.floor(Math.random() * 99999) + 1; schedule(0); });
    // Matrix rain on the lines
    const applyRain = () => { L.prChars = $("lnPrChars").value; sync(); schedule(0); };
    $("lnPrChars").addEventListener("input", refreshRainApply);
    $("lnPrChars").addEventListener("keydown", (e) => { if (e.key === "Enter") setTimeout(applyRain, 0); });
    $("lnPrApply").addEventListener("click", applyRain);
    $("lnPrPreset").addEventListener("change", () => {
      const id = $("lnPrPreset").value;
      if (!id) return;
      const cs = CHARSETS.find((c) => c.id === id);
      $("lnPrChars").value = id === "matrix" ? Lines.DEFAULTS.prChars : Array.from(new Set(Array.from(cs ? cs.chars : ""))).filter((ch) => ch.trim()).join("");
      $("lnPrPreset").value = "";
      h.refreshFields && h.refreshFields();
      applyRain();
    });
    $("lnPrSeed").addEventListener("click", () => { L.prSeed = Math.floor(Math.random() * 99999) + 1; schedule(0); });
    // single lines
    $("lnPickBtn").addEventListener("click", () => setPicking(!picking));
    $("lnPickList").addEventListener("change", () => { curPick = Number($("lnPickList").value) || 0; pickShown = -1; sync(); if (picking) viewer.refresh(); });
    $("lnPickMode").addEventListener("change", () => changePick((pk) => { pk.mode = $("lnPickMode").value; }));
    h.onCheck($("lnPickAll"), (v) => changePick((pk) => { pk.all = v; }));
    h.onCheck($("lnPickColorOn"), (v) => changePick((pk) => { pk.colorOn = v; }));
    const applyPickText = () => changePick((pk) => { pk.text = $("lnPickText").value; });
    $("lnPickText").addEventListener("input", refreshPickApply);
    $("lnPickText").addEventListener("keydown", (e) => { if (e.key === "Enter") setTimeout(applyPickText, 0); });
    $("lnPickApply").addEventListener("click", applyPickText);
    $("lnPickSwatch").addEventListener("click", async () => {
      const pk = curPk();
      if (!pk) return;
      try { const v = await askColor(pk.color); if (v) changePick((p) => { p.color = v; }); } catch (e) { console.error(e); status("Colour picker unavailable — type a hex value instead.", true); }
    });
    $("lnPickHex").addEventListener("change", () => {
      const v = $("lnPickHex").value.trim().replace(/^#?/, "#");
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { const [r, g, b] = Lines.hexToRgb(v); changePick((p) => { p.color = "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); }); } else sync();
    });
    $("lnPickDel").addEventListener("click", () => { if (!curPk()) return; L.ptPicks = L.ptPicks.filter((_, i) => i !== curPick); pickShown = -1; sync(); schedule(0); status("Removed. ↶ Undo brings it back."); });
    $("lnPickClear").addEventListener("click", () => { L.ptPicks = []; pickShown = -1; sync(); schedule(0); status("No chosen lines. ↶ Undo brings them back."); });
    $("lnPcSeed").addEventListener("click", () => { L.pcSeed = Math.floor(Math.random() * 99999) + 1; schedule(0); });
    $("lnMapEdit").addEventListener("click", () => h.showTab && h.showTab("map"));
    $("lnHeightLayer").addEventListener("change", () => { const v = $("lnHeightLayer").value; L.heightLayer = v ? Number(v) : null; schedule(0); });
    for (const [k, id] of Object.entries(COLOURS)) {
      $(id + "Swatch").addEventListener("click", async () => {
        try { const v = await askColor(L[k]); if (v) setColour(k, v); } catch (e) { console.error(e); status("Colour picker unavailable — type a hex value instead.", true); }
      });
      $(id + "Hex").addEventListener("change", () => {
        const v = $(id + "Hex").value.trim().replace(/^#?/, "#");
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { const [r, g, b] = Lines.hexToRgb(v); setColour(k, "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)); } else sync();
      });
    }
    $("lnSource").addEventListener("change", () => { pv = null; schedule(0); });
    $("lnArtboard").addEventListener("change", () => { pv = null; schedule(0); });
    $("lnRefresh").addEventListener("click", () => { stale++; schedule(0); });
    viewer = createViewer({
      wrap: $("lnPreviewWrap"), img: $("lnPreview"), msg: $("lnPreviewMsg"), bar: $("lnZoomBar"), grip: $("lnPreviewGrip"), head: $("lnPreviewHead"), storeKey: "gf:zoom:lines", onLayout: () => h.fitLayout(true),
      docSize: () => (pv ? { w: pv.frame.w, h: pv.frame.h } : null), render: renderRegion,
      onError: (e) => { console.error(e); status(errMsg(e), true); },
      onEditToggle: () => setPicking(!picking), editTitle: "Choose contour lines: click a line in the preview to give it its own text, rain or colour",
    });
    glitchUI = setupGlitchUI({ prefix: "ln", $, get: () => L, changed: () => schedule(), onCheck: h.onCheck, before: true });
    $("lnApply").addEventListener("click", () => apply(false));
    $("lnLive").addEventListener("click", toggleLive);
    $("lnUse").addEventListener("click", () => {
      if (!pv || !pv.F) return status("Wait for the preview first.", true);
      const label = L.style === "ridges" ? `Ridge lines (${Math.round(L.rows || 25)} rows)`
        : L.style === "maze" ? "Labyrinth" : L.style === "points" ? "Point cloud"
        : `Contour lines (${Math.round(L.levels || 40)} lines)`;
      if (h.useLines) h.useLines({ label });
    });
    $("lnExportSvg").addEventListener("click", exportSVG);
    $("lnUpdate").addEventListener("click", () => apply(true));
    $("lnStopEdit").addEventListener("click", stopEditing);
    $("lnLoad").addEventListener("click", loadSelected);
    sync();
    hist.note(); // the starting point
  }
  build();

  return {
    apply, preview: renderPreview, stopEditing, exportSVG, settings: () => L, editing: () => editing, // used by the Photoshop tests
    // "Use with effects": the ASCII tab reads the lines through these. readyForAscii (outside executeAsModal)
    // makes sure the field is there for doc; asciiKey changes whenever the lines would look different.
    async readyForAscii(doc) {
      if (!pv || !pv.F || pv.doc.id !== doc.id) { clearTimeout(pvTimer); while (pvRunning) await pvRunning; await renderPreview(); }
      return !!(pv && pv.F && pv.doc.id === doc.id);
    },
    asciiKey: () => (pv && pv.F ? [pv.srcKey, field && field.key, JSON.stringify(L)].join("|") : ""),
    // The lines over ASCII frame `frame` (document px) at scale z, on transparent: {data RGBA, w, h}.
    renderForAscii(frame, z) {
      if (!pv || !pv.F) return null;
      const s = Object.assign({}, L, { bgMode: "transparent" }), rect = { x: frame.x - pv.frame.x, y: frame.y - pv.frame.y, w: frame.w, h: frame.h };
      const px = draw(pv.F, s, rect, z, pv.frame);
      return { data: new Uint8Array(px.buffer, px.byteOffset, px.byteLength), w: Math.max(1, Math.round(frame.w * z)), h: Math.max(1, Math.round(frame.h * z)) };
    },
    useLook, randomize, undo: () => hist.undo(), toggleLive, live: () => live,
    relayout: () => viewer && viewer.relayout(),
    get viewer() { return viewer; },
    useMap() { L.heightFrom = "map"; editing = null; takeArea(); mapData = null; sync(); showEditing(); }, // Map tab ▸ Contours of this area
    activate() { active = true; if (L.heightFrom === "map") { takeArea(); showMapInfo(); } schedule(0); },
    deactivate() { active = false; clearTimeout(pvTimer); },
    onPsEvent(evt, desc) {
      if (evt === "close") live.check();
      if (busy) return;
      if (live.on && live.isLiveDoc(h.activeDoc())) return; // looking at the live window doesn't change the source
      const ref = desc && desc._target && desc._target[0] && desc._target[0]._ref;
      if (evt === "select" && ref === "layer" && (editing || $("lnSource").value === "merged")) return;
      stale++;
      schedule(350);
    },
  };
};
