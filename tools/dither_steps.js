// Dither tab integration steps (TEST=dither node tools/build_test.js).
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
const dither = setupDither({ $, loadJSON, saveJSON, errMsg, setSelect, createLayer, bitDepth, isGray, checkDoc, activeDoc, askColor, selectLayer, docBaseName, fitLayout: () => {}, onCheck: () => {} });
const tree = (d) => findLayers(d.layers, () => true).map((l) => `${l.name}${l.visible ? "" : " (hidden)"}`);
async function stats(d, layer) {
  const r = await M(() => imaging.getPixels({ documentID: d.id, layerID: layer.id, applyAlpha: false }));
  const px = await toRGBA8(r.imageData), cols = new Set();
  let nz = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3]) { nz++; if (cols.size < 300) cols.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]); }
  r.imageData.dispose();
  return { bounds: layer.bounds, painted: (nz / (px.length / 4)).toFixed(3), colours: cols.size };
}
async function savePNG(d, name) {
  if (!__MIRROR_DIR) return "no LOG_MIRROR";
  const f = await lfs.createEntryWithUrl("file:" + __MIRROR_DIR + "/" + name, { overwrite: true });
  await M(() => d.saveAs.png(f, { compression: 6 }, true)); return f.nativePath;
}
let doc, photo;
await step("create doc + gradient layer", async () => {
  doc = await M(() => app.documents.add({ width: 1200, height: 900, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  photo = await M(() => createLayer(doc, "Photo"));
  const W = doc.width, H = doc.height, buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, v = 0.5 + 0.5 * Math.sin(x / 140 + Math.cos(y / 110) * 2); buf[o] = 255 * v; buf[o + 1] = 160 * v + 40; buf[o + 2] = 255 * (1 - v); buf[o + 3] = 255; }
  await M(async () => { const id = await makeImageData(buf, W, H, false, doc.colorProfileName); await imaging.putPixels({ documentID: doc.id, layerID: photo.id, imageData: id }); id.dispose(); });
  await M(() => selectLayer(photo));
  return tree(doc);
});
await step("preview", async () => { await dither.preview(); return [__el("dtPreview").src.length, __el("dtStatus").textContent]; });
await step("apply: sunset poster, one layer", async () => {
  dither.useLook("poster");
  await dither.apply(false);
  const l = findLayerById(doc, dither.editing().layerId);
  return [__el("dtStatus").textContent, tree(doc), await stats(doc, l)];
});
await step("save poster png", async () => savePNG(doc, "dither_poster.png"));
await step("update: Game Boy, a layer per colour", async () => {
  dither.useLook("gameboy");
  dither.setOutput("colors");
  await dither.apply(true);
  return [__el("dtStatus").textContent, tree(doc)];
});
await step("update: LED wall (dots, background), one layer", async () => {
  dither.useLook("led");
  dither.setOutput("one");
  await dither.apply(true);
  return [__el("dtStatus").textContent, tree(doc), await stats(doc, findLayerById(doc, dither.editing().layerId))];
});
await step("save led png", async () => savePNG(doc, "dither_led.png"));
await step("close", async () => { await M(() => doc.closeWithoutSaving()); return "closed"; });
