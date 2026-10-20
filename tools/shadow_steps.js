// Shadow integration steps (TEST=shadow node tools/build_test.js).
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
let doc;
await step("create doc", async () => {
  doc = await M(() => app.documents.add({ width: 900, height: 600, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  const W = doc.width, H = doc.height, buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, d = Math.hypot(x - W / 2, y - H / 2) / (H / 2); buf[o] = 255 * x / W; buf[o + 1] = 255 * Math.max(0, 1 - d); buf[o + 2] = 255 * y / H; buf[o + 3] = 255; }
  await M(async () => { const id = await makeImageData(buf, W, H, false, doc.colorProfileName); await imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: id }); id.dispose(); });
});
for (const [id, q] of [["riso", "1"], ["longshadow", "1"], ["neonglow", "2"]]) {
  await step(`apply ${id} (quality ${q})`, async () => {
    S = freshSettings(PRESETS.find((p) => p.id === id).settings); src = null; __el("quality").value = q;
    await applyRaster(false);
    const top = doc.layers[0];
    const r = await M(() => imaging.getPixels({ documentID: doc.id, layerID: top.id, sourceBounds: { left: 300, top: 200, right: 600, bottom: 400 } }));
    const px = await toRGBA8(r.imageData); r.imageData.dispose();
    const cols = new Set(); for (let i = 0; i < px.length; i += 4 * 7) cols.add((px[i] >> 4) + "," + (px[i + 1] >> 4) + "," + (px[i + 2] >> 4));
    return [top.name, String(top.kind), "distinct colours", cols.size, __el("status").textContent];
  });
}
await step("save png", async () => {
  if (!__MIRROR_DIR) return "no LOG_MIRROR";
  for (const l of doc.layers.slice(1)) await M(async () => { l.visible = false; });
  const f = await lfs.createEntryWithUrl("file:" + __MIRROR_DIR + "/shadow_visual.png", { overwrite: true });
  await M(() => doc.saveAs.png(f, { compression: 6 }, true)); return f.nativePath;
});
await step("close", () => M(() => doc.closeWithoutSaving()));
