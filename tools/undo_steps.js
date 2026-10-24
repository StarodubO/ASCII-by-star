// ⌘Z and the live background (TEST=undo node tools/build_test.js): the panel's ⌘Z passes on to Photoshop's
// history, a "Live update" step is undone as a panel change, and a layer added under the characters in the
// live .psb shows in the panel preview.
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
baseAtlas = atlas; atlas.id = "builtin"; // as init() would
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await wait(50); return cond(); };
const histNames = (d) => { try { return d.historyStates.map((h) => h.name); } catch (e) { return String(e); } };
const events = [];
const spy = (evt, desc) => events.push(evt + ":" + JSON.stringify(desc).slice(0, 160));
await step("listen to historyStateChanged", async () => { try { await action.addNotificationListener(["historyStateChanged"], spy); return "ok"; } catch (e) { return "refused: " + e.message; } });
let doc;
await step("create doc", async () => {
  doc = await M(() => app.documents.add({ width: 800, height: 500, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  const W = doc.width, H = doc.height, buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, v = 255 * Math.min(1, Math.hypot(x - W / 2, y - H / 2) / (H / 2)); buf[o] = buf[o + 1] = buf[o + 2] = v; buf[o + 3] = 255; }
  await M(async () => { const id = await makeImageData(buf, W, H, false, doc.colorProfileName); await imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: id }); id.dispose(); });
  return [W, H];
});
await step("apply, then ⌘Z from the panel", async () => {
  S = freshSettings(Object.assign({}, PRESETS.find((p) => p.id === "classic").settings, { bgMode: "transparent" })); src = null; editing = null; __el("quality").value = "1";
  await applyRaster(false);
  const before = await layerNames(doc);
  onUndoKey({ key: "z", metaKey: true, target: { tagName: "DIV" }, preventDefault() {}, stopPropagation() {} });
  await until(() => !undoKeyBusy, 3000); await wait(100);
  const after = await layerNames(doc);
  await psUndo(true); await wait(100);
  return { before, afterUndo: after, afterRedo: await layerNames(doc), events: events.splice(0).length };
});
await step("open live smart object", async () => {
  await toggleLive();
  await until(() => !liveRunning && !busy, 15000); await wait(800); await until(() => !busy, 5000);
  return { live: !!live, under: live && live.under };
});
await step("add a background under the characters in the .psb", async () => {
  const psb = docById(live.docId);
  await M(() => action.batchPlay([
    { _obj: "make", _target: [{ _ref: "contentLayer" }], using: { _obj: "contentLayer", type: { _obj: "solidColorLayer", color: { _obj: "RGBColor", red: 20, grain: 30, blue: 120 } } } },
    { _obj: "move", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _ref: "layer", _index: 0 } },
  ], {}));
  await wait(1000); await until(() => !busy, 5000);
  const evs = events.splice(0);
  const auto = !!live.under;
  if (!live.under) { await readLiveUnder(); }
  const u = live.under, px = u ? [u.data[0], u.data[1], u.data[2], u.data[3]] : null;
  // a preview tile away from the characters: expect the fill colour, not the checkerboard
  const t = renderRegion({ x: 0, y: 0, w: 40, h: 40 }, 1);
  return { layers: await layerNames(psb), pickedUpByEvent: auto, events: evs, under: u && [u.w, u.h, u.k], firstPx: px, previewPx: t && [t.rgb[0], t.rgb[1], t.rgb[2]], psbHist: histNames(psb).slice(-3) };
});
await step("live update keeps the background", async () => {
  noteChange(); S.size = 20; noteChange(); scheduleLive(0);
  await until(() => liveRunning, 2000); await until(() => !liveRunning, 15000); await wait(1200); await until(() => !liveSaving && !busy, 15000);
  const psb = docById(live.docId);
  return { layers: await layerNames(psb), under: !!live.under, psbCur: histName(psb), size: S.size };
});
await step("⌘Z in the live window undoes the setting", async () => {
  onUndoKey({ key: "z", metaKey: true, target: { tagName: "DIV" }, preventDefault() {}, stopPropagation() {} });
  await until(() => !undoKeyBusy, 3000); await until(() => !liveRunning && !busy, 15000);
  return { size: S.size, status: __el("status").textContent };
});
await step("close live", async () => { await closeLive(); await wait(500); return { live: !!live, layers: await layerNames(doc) }; });
try { await action.removeNotificationListener(["historyStateChanged"], spy); } catch (e) { /* none */ }
await step("close test doc", async () => M(() => doc.closeWithoutSaving()));
