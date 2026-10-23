// Live smart object in Photoshop (TEST=live node tools/build_test.js): open, live updates, a background save,
// and Save & close while an update is still running (nothing may touch the .psb once it is closing).
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
baseAtlas = atlas; atlas.id = "builtin"; // as init() would
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await wait(50); return cond(); };
let doc;
await step("create doc", async () => {
  doc = await M(() => app.documents.add({ width: 800, height: 500, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  const W = doc.width, H = doc.height, buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, v = 255 * Math.min(1, Math.hypot(x - W / 2, y - H / 2) / (H / 2)); buf[o] = buf[o + 1] = buf[o + 2] = v; buf[o + 3] = 255; }
  await M(async () => { const id = await makeImageData(buf, W, H, false, doc.colorProfileName); await imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: id }); id.dispose(); });
  return [W, H];
});
await step("open live smart object", async () => {
  S = freshSettings(PRESETS.find((p) => p.id === "classic").settings); src = null; editing = null; __el("quality").value = "1";
  await toggleLive();
  await until(() => !liveRunning && !busy, 15000);
  return { live: !!live, psbOpen: !!(live && docById(live.docId)), active: app.activeDocument && app.activeDocument.title, status: __el("status").textContent };
});
await step("live update and background save", async () => {
  S.size = 20; scheduleLive(0);
  await until(() => liveRunning, 2000); await until(() => !liveRunning, 15000);
  await wait(1200); // the save runs ~0.9 s after the update
  await until(() => !liveSaving && !busy, 15000);
  return { live: !!live, status: __el("status").textContent };
});
await step("close while an update is running", async () => {
  const psbId = live && live.docId;
  S.size = 14; scheduleLive(0);
  await until(() => liveRunning, 2000);
  S.size = 16; runLive(); // queues another update behind the running one
  const ran = liveRunning;
  await closeLive();
  await wait(1500); // a queued update or save would fire in here
  return { updateWasRunning: ran, live: !!live, psbClosed: !docById(psbId), liveRunning, status: __el("status").textContent, layers: await layerNames(doc) };
});
await step("close test doc", async () => M(() => doc.closeWithoutSaving()));
