// "Ink bleed" tab: panel UI and Photoshop I/O for the effect in ink.js.
// Reads the selected layer (or the visible image) in tiles and writes four blend-mode layers into a group
// named "<source> Ink Bleed" right above the source, so the source layer itself is never changed.
"use strict";
const { app, core, action, imaging, constants } = require("photoshop");
const uxp = require("uxp");
const lfs = uxp.storage.localFileSystem, formats = uxp.storage.formats;
const Ink = require("./ink.js");
const { makeSlider, SLIDER_HTML } = require("./slider.js");
const { createViewer } = require("./viewer.js");
const { findLayers, findLayerById, frameOf, fillArtboardSelect, toRGBA8, convertOut, makeImageData, makeReader } = require("./pixels.js");

const INK_RE = /\s*Ink Bleed$/;
const ORDER = ["bleed", "pool", "gaps", "paper"]; // bottom to top inside the group
const NAMES = { bleed: "Ink bleed", pool: "Ink pooling", gaps: "Ink gaps", paper: "Paper" };
// dark ink on light paper; light ink on dark paper swaps every mode
const MODES = { bleed: "MULTIPLY", pool: "MULTIPLY", gaps: "NORMAL", paper: "MULTIPLY" };
const SWAP = { MULTIPLY: "SCREEN", SCREEN: "MULTIPLY" };
const TILE = 1024;
const TEX_MAX = 3072; // textures are kept at most this big (long side)
const TEX_TYPES = ["jpg", "jpeg", "png", "tif", "tiff", "psd", "psb", "webp", "bmp"];

const pct = (v) => Math.round(v * 100) + "%";
// [label, min, max, step, format, tooltip]; format "px" shows reference sizes in this document's pixels
const SLIDERS = {
  wetness: ["Wetness", 0, 1, 0.01, pct, "How much liquid the ink carries. Wet ink travels further, and thin strokes start to bleed too."],
  spread: ["Bleed distance", 0, 30, 0.1, "px", "How far ink spreads past the strokes."],
  feather: ["Feathering", 0, 1, 0.01, pct, "How much the paper's fibres and absorbency make the bleed edge ragged. 0 gives a smooth halo."],
  wicking: ["Wicking", 0, 1, 0.01, pct, "Hairline tendrils where ink runs along fibres that touch it."],
  halo: ["Halo opacity", 0, 1, 0.01, pct, "Strength of the bled ink. Real bleed is usually a bit paler than the stroke."],
  softness: ["Edge softness", 0, 1, 0.01, pct, "Sharp bleed boundary or a soft fade."],
  pooling: ["Pooling", 0, 1, 0.01, pct, "Ink drying at the edge: darker rims, paler centres."],
  poolWidth: ["Rim width", 0.5, 12, 0.1, "px", "Width of the darker rim."],
  granulation: ["Granulation", 0, 1, 0.01, pct, "Pigment settling into the paper's valleys (best on rough paper)."],
  tooth: ["Dry skip", 0, 1, 0.01, pct, "Ink missing the paper's raised peaks, like a dry brush or worn type."],
  mottle: ["Mottling", 0, 1, 0.01, pct, "Uneven ink density across larger areas."],
  grainSize: ["Grain size", 0.5, 20, 0.1, "px", "Size of the paper's surface bumps."],
  grain: ["Grain", 0, 1, 0.01, pct, "How visible the paper's surface texture is."],
  relief: ["Relief", 0, 1, 0.01, pct, "Light and shadow on the paper's surface, lit from the top left."],
  fibres: ["Fibres", 0, 1, 0.01, pct, "How many fibres the paper has. They steer the feathering and wicking."],
  fibreLength: ["Fibre length", 4, 150, 1, "px", "Length of the fibres. Long fibres give washi-like strands."],
  fibreShow: ["Fibre visibility", 0, 1, 0.01, pct, "How visible the fibres are in the paper itself."],
  alignment: ["Alignment", 0, 1, 0.01, pct, "0 = fibres point every way; 1 = all along the direction below (machine-made paper)."],
  direction: ["Direction", -90, 90, 1, (v) => Math.round(v) + "°", "Main fibre direction."],
  laid: ["Laid lines", 0, 1, 0.01, pct, "The fine parallel lines and chain lines of laid paper."],
  laidSpacing: ["Line spacing", 3, 40, 0.5, "px", "Distance between laid lines."],
  flecks: ["Flecks", 0, 1, 0.01, pct, "Dark specks, as in recycled or kraft paper."],
  texScale: ["Texture scale", 0.1, 2, 0.01, pct, "100% stretches the texture over the whole canvas. Lower repeats it (mirrored, so without seams) for a finer grain."],
  texStrength: ["Texture contrast", 0, 2, 0.01, pct, "Contrast of the texture in the paper layer. 100% = as scanned."],
};

module.exports = function setupInk(h) {
  const { $, loadJSON, saveJSON, errMsg, createLayer, bitDepth, isGray, checkDoc, activeDoc, askColor, selectLayer, docBaseName } = h;

  const fresh = (over) => {
    const s = JSON.parse(JSON.stringify(Ink.DEFAULTS));
    if (over) for (const k of Object.keys(s)) if (over[k] !== undefined) s[k] = over[k];
    return s;
  };
  let I = fresh(loadJSON("gf:ink:last", null));
  if (I.version !== Ink.SETTINGS_VERSION) { // saved by an older version: take the paper type's current values
    const p = Ink.PAPERS.find((x) => x.id === I.paper) || Ink.PAPERS[0];
    I = fresh(Object.assign({}, Ink.DEFAULTS, p.s, { paper: p.id, seed: I.seed, inkFrom: I.inkFrom, paperLayer: I.paperLayer, texture: I.texture, textureName: I.textureName, texScale: I.texScale, texStrength: I.texStrength, texColour: I.texColour, version: Ink.SETTINGS_VERSION }));
  }
  let active = false, busy = false, editing = null; // editing: {docId, groupId, name, sourceLayerId}
  let cache = null, stale = 0, docLong = Ink.REF, viewer = null;
  const sliderEls = {};

  function status(msg, isErr) { const el = $("inkStatus"); el.textContent = msg || ""; el.style.color = isErr ? "#ff7070" : ""; }
  const save = () => saveJSON("gf:ink:last", I);
  const isGroup = (l) => l && (l.kind === constants.LayerKind.GROUP || String(l.kind) === "group");
  const isInkGroup = (l) => isGroup(l) && INK_RE.test(String(l.name));
  function inkGroupOf(l) {
    if (!l) return null;
    if (isInkGroup(l)) return l;
    try { return l.parent && isInkGroup(l.parent) ? l.parent : null; } catch (e) { return null; }
  }
  const recKey = (doc, id) => `gf:ink:${doc.title}:${id}`;
  function remember(doc, group, sourceLayerId) {
    const rec = { settings: I, source: $("inkSource").value, sourceLayerId };
    saveJSON(recKey(doc, group.id), rec);
    saveJSON("gf:inkName:" + group.name, rec);
  }
  const recall = (doc, g) => loadJSON(recKey(doc, g.id), null) || loadJSON("gf:inkName:" + g.name, null);

  // ---------- source ----------
  // {layerId, name}: layerId null = the visible image
  function resolveSource(doc) {
    if (editing && editing.docId === doc.id) {
      if (editing.sourceLayerId == null) return { layerId: null, name: docBaseName(doc) };
      const l = findLayerById(doc, editing.sourceLayerId);
      if (l) return { layerId: l.id, name: String(l.name) };
      throw new Error("The layer this overlay was made from no longer exists.");
    }
    if ($("inkSource").value === "merged") return { layerId: null, name: docBaseName(doc) };
    const al = doc.activeLayers && doc.activeLayers[0];
    if (!al) throw new Error("Select the layer to add ink bleed to.");
    const g = inkGroupOf(al);
    if (g) {
      const rec = recall(doc, g), l = rec && rec.sourceLayerId != null ? findLayerById(doc, rec.sourceLayerId) : null;
      if (l) return { layerId: l.id, name: String(l.name) };
      throw new Error("Select the layer to add ink bleed to (not an Ink Bleed group).");
    }
    if (isGroup(al)) throw new Error("Select a single layer, not a group, or use Source: Visible.");
    return { layerId: al.id, name: String(al.name) };
  }

  // Runs fn with every Ink Bleed group hidden, so reads of the visible image don't include earlier overlays.
  async function withOverlaysHidden(doc, fn) {
    const hidden = findLayers(doc.layers, (l) => isInkGroup(l) && l.visible);
    for (const l of hidden) l.visible = false;
    try { return await fn(); } finally { for (const l of hidden) { try { l.visible = true; } catch (e) { /* deleted */ } } }
  }
  // a small read of the whole frame (artboard or canvas), for deciding what counts as ink
  const overviewZ = (f) => Math.min(1, 256 / Math.max(f.w, f.h));
  const overviewRect = (f, z) => ({ x: f.x * z, y: f.y * z, w: Math.max(1, Math.round(f.w * z)), h: Math.max(1, Math.round(f.h * z)) });
  const artboardPick = () => $("inkArtboard").value || "auto";

  // ---------- your textures ----------
  // A picked file goes on a recent list (with a persistent token, so it can be reopened next session).
  // Photoshop opens it once; the pixels, shrunk to TEX_MAX, are cached in memory and in the data folder.
  const texMem = new Map(), sessionFiles = new Map();
  const recentTex = () => loadJSON("gf:inkTextures", []);
  const hashStr = (t) => { let x = 0x811c9dc5; for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 0x01000193); } return (x >>> 0).toString(16); };
  async function addTextureFile(entry) {
    const f = entry || (await lfs.getFileForOpening({ types: TEX_TYPES }));
    if (!f) return null;
    let stamp = "";
    try { const md = await f.getMetadata(); stamp = `${md.size}|${+new Date(md.dateModified)}`; } catch (e) { stamp = ""; }
    const id = hashStr((f.nativePath || f.name) + "|" + stamp);
    let token = null;
    try { token = await lfs.createPersistentToken(f); } catch (e) { token = null; }
    sessionFiles.set(id, f);
    saveJSON("gf:inkTextures", [{ id, name: f.name, token }].concat(recentTex().filter((t) => t.id !== id)).slice(0, 12));
    return { id, name: f.name };
  }
  async function loadTexCache(id) {
    try {
      const folder = await lfs.getDataFolder(), meta = JSON.parse(await (await folder.getEntry(`tex-${id}.json`)).read({ format: formats.utf8 }));
      const rgb = new Uint8Array(await (await folder.getEntry(`tex-${id}.bin`)).read({ format: formats.binary })), n = meta.w * meta.h;
      if (rgb.length !== n * 3) return null;
      const data = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) { data[i * 4] = rgb[i * 3]; data[i * 4 + 1] = rgb[i * 3 + 1]; data[i * 4 + 2] = rgb[i * 3 + 2]; data[i * 4 + 3] = 255; }
      return { w: meta.w, h: meta.h, data };
    } catch (e) { return null; }
  }
  async function saveTexCache(id, t) {
    try {
      const n = t.w * t.h, rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) { rgb[i * 3] = t.data[i * 4]; rgb[i * 3 + 1] = t.data[i * 4 + 1]; rgb[i * 3 + 2] = t.data[i * 4 + 2]; }
      const folder = await lfs.getDataFolder();
      await (await folder.createFile(`tex-${id}.bin`, { overwrite: true })).write(rgb.buffer, { format: formats.binary });
      await (await folder.createFile(`tex-${id}.json`, { overwrite: true })).write(JSON.stringify({ w: t.w, h: t.h }), { format: formats.utf8 });
    } catch (e) { console.error("texture cache", e); }
  }
  // Opens the file in Photoshop and reads it (flattened, RGB, at most TEX_MAX px).
  async function readTextureFile(entry) {
    status("Opening the texture in Photoshop (once; it is cached afterwards)…");
    busy = true;
    try {
      return await core.executeAsModal(async () => {
        const d = await app.open(entry);
        try {
          if (!/rgb|gray/i.test(String(d.mode))) await d.changeMode(constants.ChangeMode.RGB);
          const z = Math.min(1, TEX_MAX / Math.max(d.width, d.height)), opts = { documentID: d.id, applyAlpha: true };
          if (z < 1) opts.targetSize = { width: Math.max(1, Math.round(d.width * z)), height: Math.max(1, Math.round(d.height * z)) };
          let res;
          try { res = await imaging.getPixels(opts); } catch (e) { await d.flatten(); res = await imaging.getPixels(opts); }
          const id = res.imageData, out = { w: id.width, h: id.height, data: await toRGBA8(id) };
          id.dispose();
          return out;
        } finally { await d.closeWithoutSaving(); }
      }, { commandName: "Ink bleed: load texture" });
    } finally { busy = false; }
  }
  async function getTexture(id) {
    if (texMem.has(id)) return texMem.get(id);
    let px = await loadTexCache(id);
    if (!px) {
      let entry = sessionFiles.get(id);
      const rec = recentTex().find((t) => t.id === id);
      if (!entry && rec && rec.token) { try { entry = await lfs.getEntryForPersistentToken(rec.token); } catch (e) { entry = null; } }
      if (!entry) throw new Error(`Can't open “${(rec && rec.name) || I.textureName || "the texture"}” any more. Pick it again with Add a texture file….`);
      px = await readTextureFile(entry);
      await saveTexCache(id, px);
    }
    const tex = Ink.prepareTexture(px.data, px.w, px.h);
    texMem.clear(); // one at a time: a prepared texture is ~70 MB
    texMem.set(id, tex);
    return tex;
  }
  // {tex, place} for Ink.process, or null for generated paper. Outside executeAsModal (it may open a file).
  async function paperFor(doc, frame) {
    if (!I.texture) return null;
    const tex = await getTexture(I.texture);
    return { tex, place: Ink.placeTexture(tex, frame.w, frame.h, I.texScale) }; // at 100% it covers the artboard (or canvas)
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
  const covers = (a, b) => a && b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
  function cropBuf(a, b) {
    const out = new Uint8Array(b.w * b.h * 4);
    for (let y = 0; y < b.h; y++) { const s = ((b.y - a.y + y) * a.w + (b.x - a.x)) * 4; out.set(a.data.subarray(s, s + b.w * 4), y * b.w * 4); }
    return out;
  }

  // Preview: prepares the source, then the shared viewer asks renderRegion for the parts it shows.
  let pv = null; // {doc, src, srcKey, paper}
  async function renderPreview() {
    const doc = activeDoc();
    if (!doc) { viewer.showMessage("Open a document to begin"); status(""); return; }
    checkDoc(doc);
    const src = resolveSource(doc);
    await fillArtboardSelect($("inkArtboard"), $("inkArtboardRow"), doc);
    const frame = await frameOf(doc, src.layerId, artboardPick());
    docLong = Math.max(frame.w, frame.h);
    refreshPx();
    const srcKey = [doc.id, src.layerId, frame.x, frame.y, frame.w, frame.h].join("|");
    if (!pv || pv.srcKey !== srcKey) { // a new source or artboard: start on the layer's content
      let cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
      try { const l = src.layerId != null && findLayerById(doc, src.layerId), b = l && l.bounds; if (b && b.right > b.left) { cx = (Math.max(b.left, frame.x) + Math.min(b.right, frame.x + frame.w)) / 2; cy = (Math.max(b.top, frame.y) + Math.min(b.bottom, frame.y + frame.h)) / 2; } } catch (e) { /* frame centre */ }
      viewer.setCentre(cx - frame.x, cy - frame.y);
    }
    pv = { doc, src, srcKey, frame, paper: await paperFor(doc, frame) };
    await viewer.refresh();
  }
  // The preview of document rect `rect` at scale z (output px per document px), as RGB.
  async function renderRegion(rect, z) {
    if (!pv) return null;
    const { doc, src, srcKey, paper, frame } = pv;
    // the viewer works in the frame; reads and the effect use canvas coordinates (so they match the apply)
    const vx = Math.round((rect.x + frame.x) * z), vy = Math.round((rect.y + frame.y) * z), vw = Math.max(1, Math.round(rect.w * z)), vh = Math.max(1, Math.round(rect.h * z));
    const sk = (z * docLong) / Ink.REF, M = Ink.margin(I, sk);
    const need = { x: Math.floor((vx - M) / 64) * 64, y: Math.floor((vy - M) / 64) * 64 };
    need.w = Math.ceil((vx + vw + M) / 64) * 64 - need.x; need.h = Math.ceil((vy + vh + M) / 64) * 64 - need.y;
    const vrect = { x: vx, y: vy, w: vw, h: vh };
    const key = `${srcKey}|${z}|${doc.width}x${doc.height}|${stale}`;
    if (!cache || cache.key !== key || !covers(cache.buf, need) || !covers(cache.bg, vrect) || (cache.under && !covers(cache.under, vrect))) {
      // read a little extra so small setting changes don't need another read
      const ex = { x: need.x - 128, y: need.y - 128, w: need.w + 256, h: need.h + 256 };
      busy = true;
      try {
        cache = await core.executeAsModal(async (ctx) => {
          let sid = null;
          try { sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "Ink bleed preview" }); } catch (e) { sid = null; }
          const reader = makeReader(doc, src.layerId);
          try {
            return await withOverlaysHidden(doc, async () => {
              const oz = overviewZ(frame);
              const overview = await reader.read(overviewRect(frame, oz), oz);
              const buf = Object.assign({ data: await reader.read(ex, z) }, ex);
              let bgData = null, approx = false;
              if (src.layerId == null) bgData = await reader.read(vrect, z);
              else {
                const bgReader = makeReader(doc, null);
                try { bgData = await bgReader.read(vrect, z); }
                catch (e) { console.error(e); bgData = await reader.read(vrect, z); approx = true; } // just the layer, on white
                finally { await bgReader.close(); }
              }
              // what's under the source layer: the paper the ink gaps reveal
              let under = null;
              if (src.layerId != null) under = await readUnder(doc, src.layerId, null, vrect, z);
              return { key, overview, buf, bg: Object.assign({ data: bgData }, vrect), under: under && Object.assign({ data: under }, vrect), approx };
            });
          } finally {
            await reader.close();
            if (sid !== null) { try { await ctx.hostControl.resumeHistory(sid, false); } catch (e) { try { await ctx.hostControl.resumeHistory(sid, true); } catch (e2) { /* ignore */ } } }
          }
        }, { commandName: "Ink bleed: read pixels" });
      } finally { busy = false; }
    }
    const det = Ink.detect(cache.overview, I.inkFrom);
    const t0 = Date.now();
    const L = Ink.process({ w: need.w, h: need.h, data: cropBuf(cache.buf, need) }, need.x, need.y, { x: vx - need.x, y: vy - need.y, w: vw, h: vh }, sk, I, det, paper, cache.under && cropBuf(cache.under, vrect));
    const rgb = Ink.composite(cropBuf(cache.bg, vrect), L);
    status(`${src.layerId == null ? "Visible image" : "“" + src.name + "”"} · ${det.label}${I.texture ? " · on " + I.textureName : ""} · ${Date.now() - t0} ms${cache.approx ? " · preview shows the layer alone (Photoshop couldn't read the full image)" : ""}`);
    return { rgb, w: vw, h: vh };
  }

  // The visible image under the source layer (source and `alsoHide` hidden for the read), or null.
  async function readUnder(doc, layerId, alsoHide, R, z) {
    const l = findLayerById(doc, layerId), hide = [l, alsoHide].filter((x) => x && x.visible), ur = makeReader(doc, null);
    try { for (const x of hide) x.visible = false; return await ur.read(R, z); }
    catch (e) { console.error("under", e); return null; }
    finally { for (const x of hide) { try { x.visible = true; } catch (e) { /* gone */ } } await ur.close(); }
  }

  // ---------- apply ----------
  async function apply(update) {
    const doc = activeDoc();
    try { checkDoc(doc); } catch (e) { return status(e.message, true); }
    if (update && (!editing || editing.docId !== doc.id)) return status("The overlay being edited is in another document. Switch back to it.", true);
    clearTimeout(pvTimer);
    while (pvRunning) await pvRunning;
    const t0 = Date.now();
    let info = "", paper = null;
    try { paper = await paperFor(doc, await frameOf(doc, resolveSource(doc).layerId, artboardPick())); } catch (e) { return status(errMsg(e), true); }
    busy = true;
    try {
      await core.executeAsModal(async (ctx) => {
        const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: update ? "Ink bleed update" : "Ink bleed" });
        const src = resolveSource(doc), frame = await frameOf(doc, src.layerId, artboardPick());
        const reader = makeReader(doc, src.layerId);
        const hidden = src.layerId == null ? findLayers(doc.layers, (l) => isInkGroup(l) && l.visible) : [];
        for (const l of hidden) l.visible = false;
        try {
          const oz = overviewZ(frame), det = Ink.detect(await reader.read(overviewRect(frame, oz), oz), I.inkFrom);
          let group = update ? findLayerById(doc, editing.groupId) : null;
          if (update && !group) throw new Error("The Ink Bleed group being edited no longer exists.");
          const layers = await prepareLayers(doc, group, src, det.light, reader.stamped, frame);
          group = layers.group;
          const X0 = frame.x, Y0 = frame.y, X1 = frame.x + frame.w, Y1 = frame.y + frame.h, sk = Math.max(frame.w, frame.h) / Ink.REF, M = Ink.margin(I, sk);
          const depth = bitDepth(doc), gray = isGray(doc);
          let profile = null;
          try { profile = doc.colorProfileName || null; } catch (e) { profile = null; }
          const first = {}, nT = Math.ceil(frame.w / TILE) * Math.ceil(frame.h / TILE);
          let k = 0;
          for (let ty = Y0; ty < Y1; ty += TILE) for (let tx = X0; tx < X1; tx += TILE) {
            status(`Rendering ink… tile ${++k}/${nT}`);
            const tw = Math.min(TILE, X1 - tx), th = Math.min(TILE, Y1 - ty), R = { x: tx - M, y: ty - M, w: tw + 2 * M, h: th + 2 * M };
            const data = await reader.read(R, 1);
            const under = src.layerId != null ? await readUnder(doc, src.layerId, group, { x: tx, y: ty, w: tw, h: th }, 1) : null;
            const L = Ink.process({ w: R.w, h: R.h, data }, R.x, R.y, { x: M, y: M, w: tw, h: th }, sk, I, det, paper, under);
            for (const key of ORDER) {
              const layer = layers[key], px = L[key];
              if (!layer || !px) continue;
              if (first[key] && !hasAlpha(px)) continue; // nothing to add; the first write already cleared the layer
              const id = await makeImageData(convertOut(new Uint8Array(px.buffer), tw * th, depth, gray), tw, th, gray, profile);
              try { await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: id, replace: !first[key], targetBounds: { left: tx, top: ty }, commandName: "Ink bleed" }); }
              finally { id.dispose(); }
              first[key] = true;
            }
          }
          remember(doc, group, src.layerId);
          editing = { docId: doc.id, groupId: group.id, name: String(group.name), sourceLayerId: src.layerId };
          info = `${det.label} · ${nT} tile${nT === 1 ? "" : "s"}`;
        } finally {
          for (const l of hidden) { try { l.visible = true; } catch (e) { /* gone */ } }
          await reader.close();
          await ctx.hostControl.resumeHistory(sid, true);
        }
      }, { commandName: "Ink bleed" });
      showEditing();
      status(`${update ? "Updated" : "Added"} “${editing.name}” · ${info} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(e); status(errMsg(e), true);
    } finally { busy = false; }
  }
  function hasAlpha(px) { for (let i = 3; i < px.length; i += 4) if (px[i]) return true; return false; }

  // Creates (or reuses, when updating) the group and its layers, stacked bottom to top as ORDER.
  async function prepareLayers(doc, group, src, light, stamped, frame) {
    const existing = {};
    if (group) {
      for (const l of group.layers || []) for (const k of ORDER) if (String(l.name) === NAMES[k]) existing[k] = l;
    } else if (src.layerId != null) await selectLayer(findLayerById(doc, src.layerId)); // new layers appear above the selection
    const out = {};
    for (const k of ORDER) {
      if (k === "paper" && !I.paperLayer) { if (existing.paper) await existing.paper.delete(); continue; }
      out[k] = existing[k] || (await createLayer(doc, NAMES[k]));
      const mode = light ? SWAP[MODES[k]] || MODES[k] : MODES[k];
      try { out[k].blendMode = constants.BlendMode[mode]; } catch (e) { console.error("blend mode", e); }
    }
    const list = ORDER.filter((k) => out[k]).map((k) => out[k]);
    if (!group) {
      for (let i = 1; i < list.length; i++) await list[i].move(list[i - 1], constants.ElementPlacement.PLACEBEFORE);
      group = await doc.createLayerGroup({ name: `${src.name.replace(INK_RE, "").trim() || docBaseName(doc)} Ink Bleed`, fromLayers: list });
      const sl = src.layerId != null ? findLayerById(doc, src.layerId) : null;
      const board = frame && frame.artboardId != null ? findLayerById(doc, frame.artboardId) : null;
      if (sl) await group.move(sl, constants.ElementPlacement.PLACEBEFORE);
      else if (board && board.layers && board.layers.length) { if (board.layers[0].id !== group.id) await group.move(board.layers[0], constants.ElementPlacement.PLACEBEFORE); } // top of the artboard
      else if (stamped || doc.layers[0].id !== group.id) await group.move(doc.layers[0], constants.ElementPlacement.PLACEBEFORE);
    } else {
      let below = null;
      for (const l of list) {
        let inside = false;
        try { inside = l.parent && l.parent.id === group.id; } catch (e) { inside = false; }
        if (below) await l.move(below, constants.ElementPlacement.PLACEBEFORE);
        else if (!inside) await l.move(group, constants.ElementPlacement.PLACEINSIDE);
        below = l;
      }
    }
    out.group = group;
    return out;
  }

  // ---------- editing ----------
  function showEditing() {
    $("inkEditLabel").textContent = editing ? "Editing: " + editing.name : "";
    $("inkEditBox").classList.toggle("hidden", !editing);
    h.fitLayout(true);
  }
  function loadSelected() {
    const doc = activeDoc(), al = doc && doc.activeLayers && doc.activeLayers[0], g = inkGroupOf(al);
    if (!g) return status("Select an Ink Bleed group (or a layer inside one).", true);
    const rec = recall(doc, g);
    if (!rec) return status("No saved settings for this overlay on this computer.", true);
    I = fresh(rec.settings);
    $("inkSource").value = rec.source || "layer";
    editing = { docId: doc.id, groupId: g.id, name: String(g.name), sourceLayerId: rec.sourceLayerId == null ? null : rec.sourceLayerId };
    sync(); showEditing(); schedule(0);
    status("Loaded the settings of “" + g.name + "”.");
  }
  function stopEditing() { editing = null; showEditing(); pv = null; schedule(0); }

  // ---------- UI ----------
  const fmtPx = (v) => { const p = (v * docLong) / Ink.REF; return (p < 10 ? p.toFixed(1) : Math.round(p)) + " px"; };
  function refreshPx() { for (const [k, el] of Object.entries(sliderEls)) if (el.px) el.val.textContent = fmtPx(I[k]); }
  function fillPaperSelect() {
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    let html = '<option value="" disabled>— Generated paper —</option>' + Ink.PAPERS.map((p) => `<option value="p:${p.id}">${p.name}</option>`).join("");
    html += '<option value="" disabled>— Your textures —</option>' + recentTex().map((t) => `<option value="t:${t.id}">${esc(t.name)}</option>`).join("");
    html += '<option value="add">Add a texture file…</option>';
    $("inkPaperType").innerHTML = html;
    $("inkPaperType").value = I.texture ? "t:" + I.texture : "p:" + I.paper;
  }
  function sync() {
    for (const [k, el] of Object.entries(sliderEls)) { el.input.value = String(I[k]); el.val.textContent = el.px ? fmtPx(I[k]) : el.fmt(I[k]); }
    fillPaperSelect();
    const tx = !!I.texture;
    $("inkTexRows").classList.toggle("hidden", !tx);
    $("inkProcRows").classList.toggle("hidden", tx);
    $("inkExtraRows").classList.toggle("hidden", tx);
    $("isl-fibreShow").classList.toggle("hidden", tx);
    $("inkTexColour").checked = !!I.texColour;
    if ($("inkTexColour").syncChecked) $("inkTexColour").syncChecked();
    $("inkFrom").value = I.inkFrom;
    $("inkSeed").value = String(I.seed);
    $("inkPaperLayer").checked = !!I.paperLayer;
    if ($("inkPaperLayer").syncChecked) $("inkPaperLayer").syncChecked();
    $("inkPaperSwatch").style.backgroundColor = I.paperColor;
    $("inkPaperHex").value = I.paperColor;
    $("inkPaperRows").classList.toggle("hidden", !I.paperLayer);
    if (h.refreshFields) h.refreshFields();
  }
  // A generated paper sets every slider. keepTexture (the Reset button) keeps a chosen texture and its settings.
  function setPaperType(id, keepTexture) {
    const p = Ink.PAPERS.find((x) => x.id === id) || Ink.PAPERS[0], keep = { paper: p.id, seed: I.seed, inkFrom: I.inkFrom, paperLayer: I.paperLayer };
    if (keepTexture) for (const k of ["texture", "textureName", "texScale", "texStrength", "texColour"]) keep[k] = I[k];
    I = fresh(Object.assign({}, I, Ink.DEFAULTS, p.s, keep));
    sync(); schedule(0);
  }
  // A texture only replaces the paper; the bleed settings stay as they are.
  function useTexture(t) { I.texture = t.id; I.textureName = t.name; sync(); schedule(0); }
  async function onPaperSelect() {
    const v = $("inkPaperType").value;
    if (v.startsWith("p:")) return setPaperType(v.slice(2));
    if (v.startsWith("t:")) { const t = recentTex().find((x) => x.id === v.slice(2)); if (t) useTexture(t); return; }
    if (v === "add") {
      try { const t = await addTextureFile(); if (t) return useTexture(t); }
      catch (e) { console.error(e); status("Couldn't add the texture: " + errMsg(e), true); }
      fillPaperSelect();
    }
  }
  function setPaperColor(hex) { I.paperColor = hex; sync(); schedule(0); }

  function build() {
    for (const [key, [label, min, max, step, fmt, tip]] of Object.entries(SLIDERS)) {
      const host = $("isl-" + key);
      host.innerHTML = `<div class="row" title="${tip}"><span class="label" title="${tip} Double-click to reset.">${label}</span>${SLIDER_HTML}<span class="val"></span></div>`;
      const val = host.querySelector(".val"), px = fmt === "px";
      const input = makeSlider(host.querySelector(".slider"), min, max, step, (v) => { I[key] = v; val.textContent = px ? fmtPx(v) : fmt(v); schedule(); });
      host.querySelector(".label").addEventListener("dblclick", () => {
        const p = Ink.PAPERS.find((x) => x.id === I.paper) || Ink.PAPERS[0];
        I[key] = p.s[key] !== undefined ? p.s[key] : Ink.DEFAULTS[key]; sync(); schedule();
      });
      sliderEls[key] = { input, val, fmt, px };
    }
    $("inkPaperType").addEventListener("change", onPaperSelect);
    $("inkResetPaper").addEventListener("click", () => setPaperType(I.paper, true));
    h.onCheck($("inkTexColour"), (v) => { I.texColour = v; schedule(0); });
    $("inkFrom").addEventListener("change", () => { I.inkFrom = $("inkFrom").value; schedule(0); });
    $("inkSeed").addEventListener("change", () => { const v = parseInt($("inkSeed").value, 10); if (v > 0) I.seed = v; sync(); schedule(0); });
    $("inkReseed").addEventListener("click", () => { I.seed = Math.floor(Math.random() * 99999) + 1; sync(); schedule(0); });
    h.onCheck($("inkPaperLayer"), (v) => { I.paperLayer = v; sync(); schedule(0); });
    $("inkPaperSwatch").addEventListener("click", async () => {
      try { const v = await askColor(I.paperColor); if (v) setPaperColor(v); } catch (e) { console.error(e); status("Colour picker unavailable — type a hex value instead.", true); }
    });
    $("inkPaperHex").addEventListener("change", () => {
      const v = $("inkPaperHex").value.trim().replace(/^#?/, "#");
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { const [r, g, b] = Ink.hexToRgb(v); setPaperColor("#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)); } else sync();
    });
    $("inkPaperWhite").addEventListener("click", () => setPaperColor("#ffffff"));
    $("inkSource").addEventListener("change", () => { pv = null; schedule(0); });
    $("inkArtboard").addEventListener("change", () => { pv = null; schedule(0); });
    $("inkRefresh").addEventListener("click", () => { stale++; schedule(0); });
    viewer = createViewer({
      wrap: $("inkPreviewWrap"), img: $("inkPreview"), msg: $("inkPreviewMsg"), bar: $("inkZoomBar"), grip: $("inkPreviewGrip"), head: $("inkPreviewHead"), storeKey: "gf:zoom:ink", onLayout: () => h.fitLayout(true),
      docSize: () => (pv ? { w: pv.frame.w, h: pv.frame.h } : null), render: renderRegion,
      onError: (e) => { console.error(e); status(errMsg(e), true); },
    });
    $("inkApply").addEventListener("click", () => apply(false));
    $("inkUpdate").addEventListener("click", () => apply(true));
    $("inkStopEdit").addEventListener("click", stopEditing);
    $("inkLoad").addEventListener("click", loadSelected);
    sync();
  }
  build();

  return {
    apply, preview: renderPreview, stopEditing, settings: () => I, editing: () => editing, // used by the Photoshop tests
    async useTextureFile(entry) { const t = await addTextureFile(entry); useTexture(t); return t; },
    setZoom: (m) => viewer.setMode(m),
    relayout: () => viewer && viewer.relayout(),
    get viewer() { return viewer; },
    activate() { active = true; schedule(0); },
    deactivate() { active = false; clearTimeout(pvTimer); },
    onPsEvent(evt, desc) {
      if (busy) return;
      const ref = desc && desc._target && desc._target[0] && desc._target[0]._ref;
      if (evt === "select" && ref === "layer" && (editing || $("inkSource").value === "merged")) return;
      stale++;
      schedule(350);
    },
  };
};
