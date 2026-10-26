// Live smart object for the Lines and Map tabs (the ASCII tab has its own in main.js, with quality scaling and
// layers under the characters). Open places the tab's result in the working document as a smart object and
// opens its contents (.psb) as the live window; every change is written into the .psb and saved once edits
// pause, which updates the smart object in the working document. Close saves and closes the .psb.
// o: {btn (button element), label ("line art"), status(msg, isErr), errMsg}
"use strict";
const { app, core, action, imaging, constants } = require("photoshop");
const { findLayers, findLayerById, convertOut, makeImageData, withoutSelection } = require("./pixels.js");

const docById = (id) => { try { const ds = app.documents; for (let i = 0; i < ds.length; i++) if (ds[i].id === id) return ds[i]; } catch (e) { /* none open */ } return null; };
const isSmart = (l) => !!l && /smart/i.test(String(l.kind));
const STRIP = 4e6; // pixels per write

// Writes draw({x, y, w, h}) (RGBA of that frame rect at full size) into layer, in strips, with invisible 1/255
// pixels in two corners so the layer's bounds stay the whole area. Inside executeAsModal.
async function writeAll(doc, layer, W, H, draw) {
  const stripH = Math.max(1, Math.min(H, Math.floor(STRIP / W)));
  await withoutSelection(doc, async () => {
    for (let y0 = 0; y0 < H; y0 += stripH) {
      const h = Math.min(stripH, H - y0), rgba = draw({ x: 0, y: y0, w: W, h });
      if (y0 === 0) rgba[3] = Math.max(rgba[3], 1);
      if (y0 + h >= H) rgba[rgba.length - 1] = Math.max(rgba[rgba.length - 1], 1);
      const id = await makeImageData(convertOut(rgba, W * h, 8, false), W, h, false, null);
      try { await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: id, replace: y0 === 0, targetBounds: { left: 0, top: y0 }, commandName: "Live update" }); }
      finally { id.dispose(); }
    }
  });
}

// Every live window (any tab's) → the document it came from, so a tab working while a .psb is in front
// goes back to the file you started from instead of nesting a smart object inside the smart object.
const parents = new Map();
function rootDoc(active) {
  let d = active;
  for (let i = 0; d && parents.has(d.id) && i < 8; i++) { const p = docById(parents.get(d.id)); if (!p) break; d = p; }
  return d;
}

function createLive(o) {
  let live = null; // {docId (the .psb), layerId, sourceDocId, soLayerId, soName, w, h, closing}
  let timer = null, running = false, again = false, saveTimer = null, saving = null, pending = null;
  const setBtn = () => { o.btn.textContent = live ? "Save & close live smart object" : "Open live smart object"; o.btn.classList.toggle("primary", !!live); };

  // Places the result as a smart object in doc and opens it. a: {doc, frame, name, draw, reuse (a smart object
  // layer to open instead), place(so) (moves the new smart object where it belongs)}. Returns the smart object.
  async function open(a) {
    if (live) return null;
    o.status(`Opening the live smart object…`);
    let so = null;
    try {
      await core.executeAsModal(async (ctx) => {
        const { doc, frame } = a;
        so = isSmart(a.reuse) ? a.reuse : null;
        if (!so) {
          const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: `${o.label} smart object` });
          try { so = await placeNew(doc, frame, a.name, a.draw); if (a.place) await a.place(so); }
          finally { await ctx.hostControl.resumeHistory(sid, true); }
        }
        await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: so.id }], makeVisible: false }], {});
        await action.batchPlay([{ _obj: "placedLayerEditContents" }], {});
        const psb = app.activeDocument;
        if (!psb || psb.id === doc.id) throw new Error("Photoshop didn't open the smart object contents");
        const inner = findLayers(psb.layers, (l) => String(l.kind) !== "group")[0] || psb.layers[0];
        live = { docId: psb.id, layerId: inner.id, sourceDocId: doc.id, soLayerId: so.id, soName: String(so.name), w: psb.width, h: psb.height };
        parents.set(psb.id, doc.id);
      }, { commandName: `${o.label} live smart object` });
    } catch (e) { console.error(e); live = null; o.status("Couldn't open the live smart object: " + o.errMsg(e), true); so = null; }
    setBtn();
    if (live) o.status(`Editing “${live.soName}” live. Zoom and pan with Photoshop's tools; Save & close when done.`);
    return so;
  }
  // A scratch document with the render, turned into a smart object and copied into doc at the frame.
  async function placeNew(doc, frame, name, draw) {
    let tmp = null;
    try { tmp = await app.documents.add({ width: frame.w, height: frame.h, resolution: doc.resolution || 72, mode: "RGBColorMode", depth: 8, fill: "transparent", name: `${o.label} render` }); }
    catch (e) { tmp = null; }
    if (!tmp) throw new Error("Couldn't make a scratch document for the smart object.");
    const tag = `${o.label} render ${Date.now().toString(36)}`;
    let placed = null;
    try {
      const layer = tmp.layers[0];
      await writeAll(tmp, layer, frame.w, frame.h, draw);
      await action.batchPlay([{ _obj: "newPlacedLayer" }], {});
      const s = tmp.activeLayers[0];
      s.name = tag;
      try { placed = await s.duplicate(doc); } catch (e) { placed = null; }
      if (!placed) { // Photoshop sometimes returns nothing here; copy with the menu command instead
        try { await action.batchPlay([{ _obj: "duplicate", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _ref: "document", _id: doc.id }, version: 5 }], {}); } catch (e) { console.error(e); }
        placed = findLayers(doc.layers, (l) => l.name === tag)[0] || null;
      }
    } finally { await tmp.closeWithoutSaving(); }
    try { app.activeDocument = doc; } catch (e) { /* already active */ }
    if (!placed) throw new Error(`Photoshop couldn't copy the render into “${doc.title}”.`);
    placed.name = name;
    const b = placed.bounds; // the corner pixels pin the bounds to the frame
    if (Math.round(b.left) !== frame.x || Math.round(b.top) !== frame.y) await placed.translate(frame.x - b.left, frame.y - b.top);
    return placed;
  }

  // Writes draw into the live .psb (after delay ms; the latest call wins).
  function update(draw, delay) {
    if (!live || live.closing) return;
    pending = draw;
    clearTimeout(timer);
    timer = setTimeout(run, delay === undefined ? 250 : delay);
  }
  async function run() {
    if (!live || live.closing || !pending) return;
    if (running) { again = true; return; }
    running = true;
    const lv = live, draw = pending;
    try {
      const d = docById(lv.docId);
      if (!d || !docById(lv.sourceDocId)) { live = null; setBtn(); return; }
      await core.executeAsModal(async (ctx) => {
        let sid = null;
        try { sid = await ctx.hostControl.suspendHistory({ documentID: d.id, name: "Live update" }); } catch (e) { sid = null; }
        try { await writeAll(d, findLayerById(d, lv.layerId) || d.layers[0], lv.w, lv.h, draw); }
        finally { if (sid !== null) await ctx.hostControl.resumeHistory(sid, true); }
      }, { commandName: `${o.label} live update` });
      scheduleSave();
    } catch (e) {
      console.error(e);
      if (/busy|modal/i.test(o.errMsg(e))) again = true; else o.status("Live update: " + o.errMsg(e), true);
    } finally { running = false; }
    if (again) { again = false; timer = setTimeout(run, 400); }
  }
  // Saving pushes the .psb into the working document; once edits pause.
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (live && !live.closing && !running) saving = save(false).catch((e) => console.error(e)).then(() => { saving = null; }); }, 900);
  }
  async function save(andClose) {
    const d = live && docById(live.docId);
    if (!d) return;
    await core.executeAsModal(async () => { await d.save(); if (andClose) await d.closeWithoutSaving(); }, { commandName: `${o.label} save smart object` });
  }
  async function close() {
    const lv = live;
    if (!lv || lv.closing) return;
    lv.closing = true; // no update or background save may start while the .psb saves and closes
    clearTimeout(timer); clearTimeout(saveTimer);
    while (running) await new Promise((r) => setTimeout(r, 50));
    if (saving) await saving;
    try { await save(true); o.status(`Saved into “${lv.soName}”.`); }
    catch (e) { console.error(e); o.status("Couldn't save the smart object: " + o.errMsg(e) + ". Save it with ⌘S.", true); }
    live = null; setBtn();
  }
  setBtn();
  return {
    open, update, close,
    get on() { return !!live && !live.closing; },
    info: () => live,
    // The document the tab works on: the live window's source while the .psb is in front.
    sourceDoc(active) { return rootDoc(active); },
    isLiveDoc: (d) => !!(live && d && d.id === live.docId),
    // Photoshop closed the .psb (the user closed it): forget it.
    check() { if (live && !docById(live.docId)) { live = null; setBtn(); } },
  };
}

if (typeof module !== "undefined") module.exports = { createLive, isSmart, rootDoc, parents };
