// TEST=png: exercises the PNG export path (temporary transparent document, 2x render, saveAs.png) without the file picker.
let doc;
await step("create source doc", async () => {
  doc = await core.executeAsModal(() => app.documents.add({ width: 600, height: 400, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }), { commandName: "t" });
  const W = doc.width, H = doc.height, buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, d = Math.hypot(x - W / 2, y - H / 2) / (H / 2); buf[o] = 255 * x / W; buf[o + 1] = 255 * Math.max(0, 1 - d); buf[o + 2] = 255 * y / H; buf[o + 3] = 255; }
  await core.executeAsModal(async () => { const id = await makeImageData(buf, W, H, false, doc.colorProfileName); await imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: id }); id.dispose(); }, { commandName: "t" });
});
S = freshSettings(Object.assign({}, PRESETS.find((p) => p.id === "vhs").settings, { bgMode: "transparent" }));
let pngPath = null;
await step("export png 2x (transparent temp doc)", async () => {
  const { cs, geo, grid } = await outputGrid();
  const scale = 2, W = Math.round(geo.docW * scale), H = Math.round(geo.docH * scale);
  const file = await (await lfs.getDataFolder()).createFile("export-test@2x.png", { overwrite: true });
  let info;
  await core.executeAsModal(async () => {
    const tmp = await app.documents.add({ width: W, height: H, resolution: 144, mode: "RGBColorMode", fill: "transparent", name: "ASCII by Star export" });
    info = [tmp.layers.length, tmp.layers[0].name, String(tmp.layers[0].isBackgroundLayer)];
    try { await writeLayer(tmp, tmp.layers[0], grid, cs, scale); await tmp.saveAs.png(file, { compression: 6 }, true); }
    finally { await tmp.closeWithoutSaving(); }
  }, { commandName: "t" });
  pngPath = file.nativePath;
  return [W, H, info, pngPath, "active doc after:", app.activeDocument && app.activeDocument.id === doc.id];
});
await step("close source doc", async () => core.executeAsModal(() => doc.closeWithoutSaving(), { commandName: "t" }));
