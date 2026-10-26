// Lines tab integration steps (TEST=lines node tools/build_test.js).
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
lines = setupLines({ $, loadJSON, saveJSON, errMsg, setSelect, baseAtlas: () => atlas, createLayer, bitDepth, isGray, checkDoc, activeDoc, askColor, selectLayer, docBaseName, fitLayout: () => {}, onCheck: () => {} });
const tree = (d) => findLayers(d.layers, () => true).map((l) => `${l.name}${l.visible ? "" : " (hidden)"}`);
async function alphaStats(d, layer) {
  const r = await M(() => imaging.getPixels({ documentID: d.id, layerID: layer.id, applyAlpha: false }));
  const px = await toRGBA8(r.imageData), n = px.length / 4;
  let nz = 0, full = 0, dark = 0;
  for (let i = 0; i < px.length; i += 4) { if (px[i + 3]) nz++; if (px[i + 3] === 255) full++; if (px[i + 3] > 128 && px[i] < 100) dark++; }
  r.imageData.dispose();
  return { bounds: layer.bounds, painted: (nz / n).toFixed(3), opaque: (full / n).toFixed(3), dark: (dark / n).toFixed(3) };
}
async function savePNG(d, name) {
  if (!__MIRROR_DIR) return "no LOG_MIRROR";
  const f = await lfs.createEntryWithUrl("file:" + __MIRROR_DIR + "/" + name, { overwrite: true });
  await M(() => d.saveAs.png(f, { compression: 6 }, true)); return f.nativePath;
}
async function paint(d, layer, fn) {
  const W = d.width, H = d.height, buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fn(x, y, buf, (y * W + x) * 4, W, H);
  await M(async () => { const id = await makeImageData(buf, W, H, false, d.colorProfileName); await imaging.putPixels({ documentID: d.id, layerID: layer.id, imageData: id }); id.dispose(); });
}
const blobs = (x, y, buf, o, W, H) => {
  const v = 0.55 * Math.exp(-((x - W * 0.3) ** 2 + (y - H * 0.4) ** 2) / (2 * (H * 0.18) ** 2)) + 0.45 * Math.exp(-((x - W * 0.7) ** 2 + (y - H * 0.6) ** 2) / (2 * (H * 0.25) ** 2));
  buf[o] = 255 * v; buf[o + 1] = 200 * v + 30; buf[o + 2] = 255 * (1 - v); buf[o + 3] = 255;
};
let doc, photo;
await step("create doc + photo layer", async () => {
  doc = await M(() => app.documents.add({ width: 1500, height: 1000, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  photo = await M(() => createLayer(doc, "Photo"));
  await paint(doc, photo, blobs);
  await M(() => selectLayer(photo));
  return tree(doc);
});
await step("preview (selected layer)", async () => { await lines.preview(); return [__el("lnPreview").src.length, __el("lnStatus").textContent]; });
await step("apply: topographic map", async () => {
  lines.useLook("topo");
  await lines.apply(false);
  const l = findLayerById(doc, lines.editing().layerId);
  return [__el("lnStatus").textContent, tree(doc), await alphaStats(doc, l)];
});
await step("save topo png", async () => savePNG(doc, "lines_topo.png"));
await step("update: neon gradient, width from height", async () => {
  lines.useLook("neon");
  await lines.apply(true);
  return [__el("lnStatus").textContent, tree(doc)];
});
await step("save neon png", async () => savePNG(doc, "lines_neon.png"));
await step("update: ridges, transparent background", async () => {
  lines.useLook("ridges");
  Object.assign(lines.settings(), { bgMode: "transparent", lineColor: "#202020" });
  await lines.apply(true);
  return [__el("lnStatus").textContent, await alphaStats(doc, findLayerById(doc, lines.editing().layerId))];
});
await step("randomize, then undo", async () => {
  lines.useLook("fine"); // a change through the panel's path (noted for undo)
  await new Promise((r) => setTimeout(r, 800)); // changes closer than 0.7 s make one undo step
  const before = JSON.stringify(lines.settings());
  lines.randomize();
  const changed = JSON.stringify(lines.settings()) !== before;
  const undone = lines.undo() && JSON.stringify(lines.settings()) === before;
  return { changed, undone };
});
await step("transparent layer, follow the shape", async () => {
  const d = await M(() => app.documents.add({ width: 900, height: 600, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  const l = await M(() => createLayer(d, "Shape"));
  await paint(d, l, (x, y, buf, o, W, H) => { const r = Math.hypot(x - W / 2, y - H / 2); if (r < 250) { const v = 1 - r / 250; buf[o] = buf[o + 1] = buf[o + 2] = 255 * v; buf[o + 3] = 255; } });
  await M(() => selectLayer(l));
  Object.assign(lines.settings(), { heightFrom: "source", style: "contours", bgMode: "color", bgColor: "#ffeecc", followShape: true });
  await lines.apply(false);
  const out = findLayerById(d, lines.editing().layerId), st = await alphaStats(d, out);
  await savePNG(d, "lines_shape.png");
  await M(() => d.closeWithoutSaving());
  return [__el("lnStatus").textContent, st];
});
await step("16-bit doc apply", async () => {
  const d = await M(() => app.documents.add({ width: 800, height: 500, resolution: 72, mode: "RGBColorMode", depth: 16, fill: "white" }));
  const l = await M(() => createLayer(d, "Photo16"));
  const W = d.width, H = d.height, buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) blobs(x, y, buf, (y * W + x) * 4, W, H);
  await M(async () => { const id = await makeImageData(convertOut(buf, W * H, 16, false), W, H, false, d.colorProfileName); await imaging.putPixels({ documentID: d.id, layerID: l.id, imageData: id }); id.dispose(); });
  await M(() => selectLayer(l));
  lines.useLook("fine");
  Object.assign(lines.settings(), { heightFrom: "source" });
  await lines.apply(false);
  const res = [String(d.bitsPerChannel), __el("lnStatus").textContent, tree(d)];
  await M(() => d.closeWithoutSaving());
  return res;
});
await step("close test doc", async () => M(() => doc.closeWithoutSaving()));
