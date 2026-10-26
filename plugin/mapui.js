// "Map" tab: an area on the map (shared with the Lines tab's map heights) and its streets, railways, rivers,
// water, buildings and land areas (map.js loadFeatures, drawn by features.js). Apply makes a group "<place> Map"
// at the top with one layer per kind of feature; Select turns one kind into a Photoshop selection.
"use strict";
const { core, imaging, constants } = require("photoshop");
const uxp = require("uxp");
const lfs = uxp.storage.localFileSystem, formats = uxp.storage.formats;
const Features = require("./features.js");
const MapHeights = require("./map.js");
const { makeSlider, onDoubleClick, SLIDER_HTML } = require("./slider.js");
const { createViewer } = require("./viewer.js");
const { makePresetBox } = require("./presetbox.js");
const { makeHistory } = require("./history.js");
const { createLive, isSmart } = require("./live.js");
const { findLayers, findLayerById, frameOf, fillArtboardSelect, convertOut, makeImageData, hasAlpha, withoutSelection } = require("./pixels.js");

const GROUP_RE = /\s*Map$/;
const TILE = 1024;
const NO_DOC = { x: 0, y: 0, w: 3000, h: 2000, artboardId: null }; // the preview's frame without a document

const pct = (v) => Math.round(v * 100) + "%";
// [label, min, max, step, format, tooltip]; "px" shows reference sizes in this document's pixels
const SLIDERS = {
  creditSize: ["Size", 8, 80, 0.5, "px", "Height of the credit line."],
  roadsCasingWidth: ["Outline width", 0, 6, 0.1, "px", "Width of the outline on each side of a road."],
  roadsTunnels: ["Tunnels", 0, 1, 0.01, pct, "Opacity of roads and railways in tunnels (0 hides them)."],
};
for (const c of Features.CATS) {
  SLIDERS[c.id + "Opacity"] = ["Opacity", 0, 1, 0.01, pct, `Opacity of ${c.name.toLowerCase()}.`];
  if (c.kind === "line") SLIDERS[c.id + "Width"] = ["Width", 0.2, 30, 0.1, "px", `Width of ${c.name.toLowerCase()} (main ones are wider, small ones thinner).`];
}
const COLOURS = { bgColor: "mp_bg", creditColor: "mp_credit", roadsCasingColor: "mp_roadsCasingColor", roadsMajorColor: "mp_roadsMajorColor" };
const CHECKS = { mp_roadsMinor: "roadsMinor", mp_roadsCasing: "roadsCasing", mp_roadsMajorOn: "roadsMajorOn", mp_riversStreams: "riversStreams", mp_creditOn: "creditOn" };
for (const c of Features.CATS) { COLOURS[c.id + "Color"] = "mp_" + c.id; CHECKS["mp_" + c.id + "On"] = c.id + "On"; }
// Colour sets for Randomize: background, built-up, green, bare, water, buildings, roads, outline, main roads, rail
const PALETTES = [
  ["#f4f1ea", "#e6e0d4", "#cfe3c1", "#e9e7e2", "#a9cbe3", "#d6cfc2", "#ffffff", "#b9ae9c", "#f5cf7a", "#6b6b6b"],
  ["#0d0f14", "#161a22", "#132018", "#1a1c20", "#0a1a2b", "#222833", "#3a4250", "#0d0f14", "#e0a64a", "#596273"],
  ["#123a6b", "#16447a", "#174a73", "#1b4a80", "#0e2f57", "#2c5a93", "#dbe9ff", "#123a6b", "#ffffff", "#9cc3ff"],
  ["#fbf5e6", "#f1e4c8", "#d9e2b5", "#efe8d8", "#9ec9c4", "#e4cfa8", "#7a4b2a", "#fbf5e6", "#c2410c", "#3d2b1f"],
  ["#ffffff", "#f2f2f2", "#e8f0e3", "#f5f5f5", "#d6e6f2", "#e3e3e3", "#111111", "#ffffff", "#111111", "#555555"],
  ["#1b1b2f", "#24243e", "#1f3b2c", "#2a2a40", "#162447", "#2e2e4a", "#e43f5a", "#1b1b2f", "#f9d56e", "#9a9ab0"],
  ["#eae2b7", "#e2d6a0", "#a3b18a", "#ddd5b0", "#669bbc", "#d4c591", "#003049", "#eae2b7", "#d62828", "#4a4a4a"],
];

module.exports = function setupMap(h) {
  const { $, loadJSON, saveJSON, errMsg, createLayer, bitDepth, isGray, askColor, docBaseName } = h;
  const activeDoc = () => live.sourceDoc(h.activeDoc()); // the live window's source while the .psb is in front
  const fresh = (over) => {
    const s = JSON.parse(JSON.stringify(Features.DEFAULTS));
    if (over) for (const k of Object.keys(s)) if (over[k] !== undefined) s[k] = over[k];
    return Features.migrate(s);
  };
  let M = fresh(loadJSON("gf:map:last", null));
  let area = loadJSON("gf:mapArea", null); // {place, lat, lon, name, widthKm}
  let active = false, busy = false, editing = null; // editing: {docId, groupId, name}
  let data = null; // {key, data, P, frameKey}
  const sliderEls = {};

  function status(msg, isErr) { const el = $("mpStatus"); el.textContent = msg || ""; el.style.color = isErr ? "#ff7070" : ""; }
  const hist = makeHistory({
    state: () => JSON.stringify(M),
    restore: (st) => { M = fresh(JSON.parse(st)); saveJSON("gf:map:last", M); sync(); schedule(0); },
    onAvail: (can) => { $("mpUndo").disabled = !can; },
  });
  const save = () => { saveJSON("gf:map:last", M); hist.note(); };
  const saveArea = () => saveJSON("gf:mapArea", area);
  const atlas = () => (h.baseAtlas ? h.baseAtlas() : null);
  const live = createLive({ btn: $("mpLive"), label: "Map", status, errMsg });
  const isGroup = (l) => l && (l.kind === constants.LayerKind.GROUP || String(l.kind) === "group");
  const isMapGroup = (l) => (isGroup(l) || isSmart(l)) && GROUP_RE.test(String(l.name)); // a group, or a live smart object
  const recKey = (doc, id) => `gf:mapGroup:${doc.title}:${id}`;
  const recall = (doc, g) => loadJSON(recKey(doc, g.id), null) || loadJSON("gf:mapGroupName:" + g.name, null);
  const artboardPick = () => $("mpArtboard").value || "auto";
  const placeName = () => (area && area.name ? String(area.name).split(",")[0].trim() : "Area"); // typed coordinates have no name

  // ---------- area ----------
  async function findPlace() {
    const text = $("mpPlace").value;
    let at;
    try {
      at = MapHeights.parseLocation(text);
      if (!at) return status("Type a place, coordinates or a Google Maps link.", true);
      if (at.query) { status("Looking up “" + at.query + "”…"); at = await MapHeights.geocode(at.query, fetch); }
    } catch (e) { console.error(e); return status(errMsg(e), true); }
    const widthKm = at.widthKm ? Math.round(Math.min(150, Math.max(0.2, at.widthKm)) * 10) / 10 : (area && area.widthKm) || 3;
    area = { place: text, lat: at.lat, lon: at.lon, name: at.name || "", widthKm };
    saveArea(); data = null; sync(); schedule(0);
  }
  function showAreaInfo(extra) {
    $("mpAreaInfo").textContent = !area ? "Paste a Google Maps link (its centre and zoom are used), coordinates, or a place name. The area takes the shape of your canvas (or artboard)."
      : `${area.name || `${area.lat.toFixed(4)}, ${area.lon.toFixed(4)}`}${extra ? " · " + extra : ""}`;
  }
  // The features of the area for a frame (loaded once per area and frame shape; tiles are cached in map.js).
  async function featuresFor(frame) {
    if (!area) throw new Error("Choose an area: type a place, coordinates or a Google Maps link, then press Find.");
    const key = [area.lat, area.lon, area.widthKm, (frame.h / frame.w).toFixed(5)].join("|"), frameKey = frame.w + "x" + frame.h;
    if (!data || data.key !== key) {
      const d = await MapHeights.loadFeatures({ lat: area.lat, lon: area.lon, widthKm: area.widthKm, aspect: frame.h / frame.w, fetchFn: fetch, onProgress: (k, n) => status(`Loading the map… ${k}/${n} tiles`) });
      data = { key, data: d, P: null, frameKey: null };
    }
    if (data.frameKey !== frameKey) { data.P = Features.prepare(data.data, frame.w, frame.h); data.frameKey = frameKey; }
    return data.P;
  }

  // ---------- preview ----------
  let pvTimer = null, pvRunning = null, pvAgain = false, pv = null, viewer = null;
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
  async function frameNow() {
    const doc = activeDoc();
    if (!doc) { $("mpArtboardRow").classList.add("hidden"); return { doc: null, frame: NO_DOC }; }
    await fillArtboardSelect($("mpArtboard"), $("mpArtboardRow"), doc);
    return { doc, frame: await frameOf(doc, null, artboardPick()) };
  }
  async function renderPreview() {
    if (!area) { viewer.showMessage("Choose an area: type a place or paste a Google Maps link, then press Find"); status(""); return; }
    const { frame } = await frameNow();
    const t0 = Date.now(), P = await featuresFor(frame);
    const first = !pv || pv.frame.w !== frame.w || pv.frame.h !== frame.h;
    pv = { frame, P, loadMs: Date.now() - t0 };
    if (first) viewer.setCentre(frame.w / 2, frame.h / 2);
    const n = Features.counts(P, M);
    showAreaInfo(`${area.widthKm < 10 ? area.widthKm.toFixed(1) : Math.round(area.widthKm)} km wide · ${P.items.length} features`);
    status(`${n.roads} roads · ${n.buildings} buildings · ${n.rivers + n.water} water · ${n.rail} rail`);
    await viewer.refresh();
    const doc = activeDoc();
    if (live.on && doc && live.info().sourceDocId === doc.id) { const s = JSON.parse(JSON.stringify(M)), P0 = P; live.update((v) => Features.render(P0, s, v, 1, null, atlas())); }
  }
  // The whole map as one smart object at the top, its contents open as the live window (live.js).
  async function toggleLive() {
    if (live.on) return live.close();
    const doc = activeDoc();
    if (!doc) return status("Open (or make) a document for the map first: the map fills its canvas.", true);
    let frame, P;
    try { frame = (await frameNow()).frame; P = await featuresFor(frame); } catch (e) { return status(errMsg(e), true); }
    const s = JSON.parse(JSON.stringify(M)), old = editing && editing.docId === doc.id ? findLayerById(doc, editing.groupId) : null;
    busy = true;
    let so = null;
    try {
      so = await live.open({
        doc, frame, name: `${placeName()} Map`, reuse: isSmart(old) ? old : null, draw: (v) => Features.render(P, s, v, 1, null, atlas()),
        place: async (layer) => {
          const board = frame.artboardId != null ? findLayerById(doc, frame.artboardId) : null;
          if (board && board.layers && board.layers.length) { if (board.layers[0].id !== layer.id) await layer.move(board.layers[0], constants.ElementPlacement.PLACEBEFORE); }
          else if (doc.layers[0].id !== layer.id) await layer.move(doc.layers[0], constants.ElementPlacement.PLACEBEFORE);
        },
      });
    } finally { busy = false; }
    if (!so) return;
    const rec = { settings: M, area };
    saveJSON(recKey(doc, so.id), rec); saveJSON("gf:mapGroupName:" + so.name, rec);
    editing = { docId: doc.id, groupId: so.id, name: String(so.name) };
    showEditing();
  }
  async function renderRegion(rect, z) {
    if (!pv) return null;
    const px = Features.render(pv.P, M, rect, z, null, atlas()), W = Math.max(1, Math.round(rect.w * z)), H = Math.max(1, Math.round(rect.h * z)), rgb = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) { const a = px[i * 4 + 3] / 255; for (let c = 0; c < 3; c++) rgb[i * 3 + c] = px[i * 4 + c] * a + 255 * (1 - a); }
    return { rgb, w: W, h: H };
  }

  // ---------- apply ----------
  async function apply(update) {
    const doc = activeDoc();
    if (!doc) return status("Open (or make) a document for the map first: the map fills its canvas.", true);
    if (update && (!editing || editing.docId !== doc.id)) return status("The map being edited is in another document. Switch back to it.", true);
    clearTimeout(pvTimer);
    while (pvRunning) await pvRunning;
    const t0 = Date.now();
    let frame, P;
    try { frame = (await frameNow()).frame; P = await featuresFor(frame); } catch (e) { return status(errMsg(e), true); }
    busy = true;
    try {
      await core.executeAsModal(async (ctx) => {
        const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: update ? "Map update" : "Map" });
        try {
          const old = update ? findLayerById(doc, editing.groupId) : null;
          if (update && !old) throw new Error("The Map group being edited no longer exists.");
          if (update && isSmart(old)) throw new Error("This map is a smart object: change it with Open live smart object.");
          const parts = Features.layerParts(M);
          if (!parts.length) throw new Error("Everything is switched off: turn on at least one kind of feature.");
          // the layers, bottom to top, then grouped
          const layers = [];
          for (const p of parts) layers.push(await createLayer(doc, p.name));
          for (let i = 1; i < layers.length; i++) await layers[i].move(layers[i - 1], constants.ElementPlacement.PLACEBEFORE);
          const group = await doc.createLayerGroup({ name: `${placeName()} Map`, fromLayers: layers });
          const board = frame.artboardId != null ? findLayerById(doc, frame.artboardId) : null;
          if (old) { await group.move(old, constants.ElementPlacement.PLACEBEFORE); await old.delete(); }
          else if (board && board.layers && board.layers.length) { if (board.layers[0].id !== group.id) await group.move(board.layers[0], constants.ElementPlacement.PLACEBEFORE); }
          else if (doc.layers[0].id !== group.id) await group.move(doc.layers[0], constants.ElementPlacement.PLACEBEFORE);
          const depth = bitDepth(doc), gray = isGray(doc);
          let profile = null;
          try { profile = doc.colorProfileName || null; } catch (e) { profile = null; }
          const nT = Math.ceil(frame.w / TILE) * Math.ceil(frame.h / TILE);
          await withoutSelection(doc, async () => {
            for (let li = 0; li < parts.length; li++) {
              let k = 0;
              for (let ty = 0; ty < frame.h; ty += TILE) for (let tx = 0; tx < frame.w; tx += TILE) {
                status(`Drawing ${parts[li].name.toLowerCase()}… ${++k}/${nT}`);
                const tw = Math.min(TILE, frame.w - tx), th = Math.min(TILE, frame.h - ty);
                const px = Features.render(P, M, { x: tx, y: ty, w: tw, h: th }, 1, parts[li].id, atlas());
                if (!hasAlpha(px)) continue;
                const id = await makeImageData(convertOut(new Uint8Array(px.buffer), tw * th, depth, gray), tw, th, gray, profile);
                try { await imaging.putPixels({ documentID: doc.id, layerID: layers[li].id, imageData: id, replace: false, targetBounds: { left: frame.x + tx, top: frame.y + ty }, commandName: "Map" }); } // replace: true would clear the tiles written before
                finally { id.dispose(); }
              }
            }
          });
          const rec = { settings: M, area };
          saveJSON(recKey(doc, group.id), rec);
          saveJSON("gf:mapGroupName:" + group.name, rec);
          editing = { docId: doc.id, groupId: group.id, name: String(group.name) };
        } finally { await ctx.hostControl.resumeHistory(sid, true); }
      }, { commandName: "Map" });
      showEditing();
      status(`${update ? "Updated" : "Added"} “${editing.name}” · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(e); status(errMsg(e), true);
    } finally { busy = false; }
  }

  // ---------- selection ----------
  async function selectFeatures() {
    const doc = activeDoc(), cat = $("mpSelectWhat").value;
    if (!doc) return status("Open a document first.", true);
    let frame, P;
    try { frame = (await frameNow()).frame; P = await featuresFor(frame); } catch (e) { return status(errMsg(e), true); }
    busy = true;
    try {
      await core.executeAsModal(async () => {
        const mask = Features.maskOf(P, M, cat, { x: 0, y: 0, w: frame.w, h: frame.h });
        const id = await imaging.createImageDataFromBuffer(mask, { width: frame.w, height: frame.h, components: 1, chunky: true, colorSpace: "Grayscale" });
        try { await imaging.putSelection({ documentID: doc.id, imageData: id, targetBounds: { left: frame.x, top: frame.y } }); }
        finally { id.dispose(); }
      }, { commandName: "Map: select" });
      status(`Selected the ${Features.CATS.find((c) => c.id === cat).name.toLowerCase()}.`);
    } catch (e) { console.error(e); status(errMsg(e), true); }
    finally { busy = false; }
  }

  // ---------- editing ----------
  function showEditing() {
    $("mpEditLabel").textContent = editing ? "Editing: " + editing.name : "";
    $("mpEditBox").classList.toggle("hidden", !editing);
    h.fitLayout(true);
  }
  function loadSelected() {
    const doc = activeDoc(), al = doc && doc.activeLayers && doc.activeLayers[0];
    let g = al;
    try { if (g && !isMapGroup(g) && g.parent && isMapGroup(g.parent)) g = g.parent; } catch (e) { /* top level */ }
    if (!isMapGroup(g)) return status("Select a Map group (or a layer in one).", true);
    const rec = recall(doc, g);
    if (!rec) return status("No saved settings for this map on this computer.", true);
    M = fresh(rec.settings);
    if (rec.area) { area = rec.area; saveArea(); data = null; }
    editing = { docId: doc.id, groupId: g.id, name: String(g.name) };
    sync(); showEditing(); schedule(0);
    status("Loaded the settings of “" + g.name + "”.");
  }
  function stopEditing() { editing = null; showEditing(); schedule(0); }

  // ---------- UI ----------
  let docLong = 3000;
  const fmtPx = (v) => { const p = (v * docLong) / Features.REF; return (p < 10 ? p.toFixed(1) : Math.round(p)) + " px"; };
  const show = (id, on) => $(id).classList.toggle("hidden", !on);
  function sync() {
    for (const [k, el] of Object.entries(sliderEls)) {
      const v = k === "widthKm" ? (area ? area.widthKm : 3) : M[k];
      el.input.value = String(v); el.val.textContent = el.px ? fmtPx(v) : el.fmt(v);
    }
    for (const [id, k] of Object.entries(CHECKS)) { const el = $(id); el.checked = !!M[k]; if (el.syncChecked) el.syncChecked(); }
    for (const [k, id] of Object.entries(COLOURS)) { $(id + "Swatch").style.backgroundColor = M[k]; $(id + "Hex").value = M[k]; }
    const bg = $("mpBgMode"); bg.value = M.bgMode; if (bg.ddUpdate) bg.ddUpdate();
    if (area && !$("mpPlace").value) $("mpPlace").value = area.place || "";
    for (const c of Features.CATS) show("mp_" + c.id + "Rows", M[c.id + "On"]);
    show("mp_casingColorRow", M.roadsCasing); show("msl-roadsCasingWidth", M.roadsCasing);
    show("mp_majorColorRow", M.roadsMajorOn);
    show("mp_bgRow", M.bgMode !== "transparent");
    show("mp_creditRows", M.creditOn);
    showAreaInfo();
    if (h.refreshFields) h.refreshFields();
  }
  function applyLook(st) { M = fresh(Object.assign({}, Features.DEFAULTS, st)); sync(); schedule(0); }
  function randomize() {
    const R = Math.random, pick = (a) => a[Math.floor(R() * a.length)], between = (a, b) => Math.round((a + (b - a) * R()) * 10) / 10;
    const [bg, built, green, bare, water, bld, road, casing, major, rail] = pick(PALETTES);
    applyLook({
      bgMode: R() < 0.15 ? "transparent" : "color", bgColor: bg, builtColor: built, greenColor: green, bareColor: bare, waterColor: water, riversColor: water, buildingsColor: bld,
      roadsColor: road, roadsCasingColor: casing, roadsMajorColor: major, railColor: rail, creditColor: rail,
      builtOn: R() < 0.6, greenOn: R() < 0.8, bareOn: R() < 0.7, buildingsOn: R() < 0.7, roadsMinor: R() < 0.6, roadsCasing: R() < 0.5, roadsMajorOn: R() < 0.6,
      roadsWidth: between(2, 9), riversWidth: between(1.5, 6), railWidth: between(1, 4), roadsCasingWidth: between(0.6, 2), riversStreams: R() < 0.6,
    });
    status("Randomized. ↶ Undo goes back.");
  }
  function build() {
    const all = Object.assign({ widthKm: ["Area width", 0.2, 150, 0.1, (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) + " km", "How much ground the map covers, left to right."] }, SLIDERS);
    for (const [key, [label, min, max, step, fmt, tip]] of Object.entries(all)) {
      const host = $("msl-" + key);
      host.innerHTML = `<div class="row" title="${tip}"><span class="label" title="${tip} Double-click the name or the handle to reset.">${label}</span>${SLIDER_HTML}<span class="val"></span></div>`;
      const val = host.querySelector(".val"), px = fmt === "px";
      const set = (v) => { if (key === "widthKm") { if (area) { area.widthKm = v; saveArea(); } } else M[key] = v; };
      const reset = () => { set(key === "widthKm" ? 3 : Features.DEFAULTS[key]); sync(); schedule(); };
      const input = makeSlider(host.querySelector(".slider"), min, max, step, (v) => { set(v); val.textContent = px ? fmtPx(v) : fmt(v); schedule(key === "widthKm" ? 300 : undefined); }, reset);
      onDoubleClick(host.querySelector(".label"), reset);
      onDoubleClick(val, reset);
      sliderEls[key] = { input, val, fmt, px };
    }
    for (const [id, k] of Object.entries(CHECKS)) h.onCheck($(id), (v) => { M[k] = v; sync(); schedule(0); });
    for (const [k, id] of Object.entries(COLOURS)) {
      const setColour = (hex) => { M[k] = hex; sync(); schedule(0); };
      $(id + "Swatch").addEventListener("click", async () => {
        try { const v = await askColor(M[k]); if (v) setColour(v); } catch (e) { console.error(e); status("Colour picker unavailable — type a hex value instead.", true); }
      });
      $(id + "Hex").addEventListener("change", () => {
        const v = $(id + "Hex").value.trim().replace(/^#?/, "#");
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { const [r, g, b] = Features.hexToRgb(v); setColour("#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)); } else sync();
      });
    }
    $("mpBgMode").addEventListener("change", () => { M.bgMode = $("mpBgMode").value; sync(); schedule(0); });
    $("mpFind").addEventListener("click", findPlace);
    $("mpPlace").addEventListener("keydown", (e) => { if (e.key === "Enter") setTimeout(findPlace, 0); });
    $("mpToLines").addEventListener("click", () => {
      if (!area) return status("Choose an area first.", true);
      if (h.onAreaToLines) h.onAreaToLines();
    });
    $("mpSelectWhat").innerHTML = Features.CATS.map((c) => `<option value="${c.id}">Select: ${c.name}</option>`).join("");
    if ($("mpSelectWhat").ddUpdate) $("mpSelectWhat").ddUpdate();
    $("mpSelect").addEventListener("click", selectFeatures);
    $("mpArtboard").addEventListener("change", () => schedule(0));
    makePresetBox({
      $, loadJSON, saveJSON, setSelect: h.setSelect, status, errMsg, lfs, formats,
      ids: { select: "mpPreset", reset: "mpPresetReset", name: "mpPresetName", save: "mpPresetSave", del: "mpPresetDelete", exp: "mpPresetExport", imp: "mpPresetImport" },
      storeKey: "gf:mapPresets", builtIns: Features.STYLES.map((x) => ({ id: x.id, name: x.name, settings: x.s })), builtInLabel: "Built-in looks",
      fileName: "ascii-by-star-map-looks.json", fileTag: "asciiByStarMap", current: () => JSON.parse(JSON.stringify(M)), apply: applyLook,
      fresh: (st) => { const o = {}; for (const k of Object.keys(Features.DEFAULTS)) if (st[k] !== undefined) o[k] = st[k]; return o; },
    });
    $("mpRandom").addEventListener("click", randomize);
    $("mpUndo").addEventListener("click", () => { if (hist.undo()) status("Undone." + (hist.canUndo() ? "" : " Nothing more to undo.")); });
    viewer = createViewer({
      wrap: $("mpPreviewWrap"), img: $("mpPreview"), msg: $("mpPreviewMsg"), bar: $("mpZoomBar"), grip: $("mpPreviewGrip"), head: $("mpPreviewHead"), storeKey: "gf:zoom:map", onLayout: () => h.fitLayout(true),
      docSize: () => (pv ? { w: pv.frame.w, h: pv.frame.h } : null), render: renderRegion,
      onError: (e) => { console.error(e); status(errMsg(e), true); },
    });
    $("mpApply").addEventListener("click", () => apply(false));
    $("mpLive").addEventListener("click", toggleLive);
    $("mpUpdate").addEventListener("click", () => apply(true));
    $("mpStopEdit").addEventListener("click", stopEditing);
    $("mpLoad").addEventListener("click", loadSelected);
    sync();
    hist.note(); // the starting point
  }
  build();

  return {
    apply, preview: renderPreview, selectFeatures, findPlace, randomize, applyLook, toggleLive, undo: () => hist.undo(), stopEditing, // used by the Photoshop tests
    settings: () => M, editing: () => editing, area: () => area,
    relayout: () => viewer && viewer.relayout(),
    get viewer() { return viewer; },
    activate() {
      active = true;
      const doc = activeDoc();
      if (doc) frameOf(doc, null, artboardPick()).then((f) => { docLong = Math.max(f.w, f.h); sync(); }).catch(() => {});
      schedule(0);
    },
    deactivate() { active = false; clearTimeout(pvTimer); },
    onPsEvent(evt) {
      if (evt === "close") live.check();
      if (busy || (live.on && live.isLiveDoc(h.activeDoc()))) return; // looking at the live window changes nothing
      schedule(350);
    },
  };
};
