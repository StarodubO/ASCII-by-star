// Ink bleed integration steps (TEST=ink node tools/build_test.js).
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
ink = setupInk({ $, loadJSON, saveJSON, errMsg, toRGBA8, makeImageData, convertOut, createLayer, findLayers, findLayerById, bitDepth, isGray, checkDoc, activeDoc, askColor, selectLayer, docBaseName, fitLayout: () => {}, onCheck: () => {} });
__el("inkZoom").value = "1";
const tree = (d) => findLayers(d.layers, () => true).map((l) => `${l.name}${l.parent ? " <" + l.parent.name + ">" : ""} [${String(l.blendMode)}]${l.visible ? "" : " (hidden)"}`);
async function alphaStats(d, layer) {
  const r = await M(() => imaging.getPixels({ documentID: d.id, layerID: layer.id, applyAlpha: false }));
  const px = await toRGBA8(r.imageData), n = px.length / 4;
  let nz = 0, full = 0;
  for (let i = 3; i < px.length; i += 4) { if (px[i]) nz++; if (px[i] === 255) full++; }
  r.imageData.dispose();
  return { bounds: layer.bounds, painted: (nz / n).toFixed(3), opaque: (full / n).toFixed(3) };
}
let doc, glyphs;
await step("create doc + glyph layer", async () => {
  doc = await M(() => app.documents.add({ width: 1200, height: 800, resolution: 300, mode: "RGBColorMode", depth: 8, fill: "white" }));
  glyphs = await M(() => createLayer(doc, "Glyphs"));
  const W = doc.width, H = doc.height, buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cx = (x % 120) - 60, cy = (y % 120) - 60, r = Math.hypot(cx, cy), o = (y * W + x) * 4;
    const a = Math.max(0, Math.min(1, 4 - Math.abs(r - 34))) * (y < H * 0.5 ? 1 : 0) + (y >= H * 0.6 && y < H * 0.6 + (x % 200 < 100 ? 3 : 10) && x > 100 && x < W - 100 ? 1 : 0);
    buf[o + 3] = Math.round(255 * Math.min(1, a)); buf[o] = 20; buf[o + 1] = 20; buf[o + 2] = 30;
  }
  await M(async () => { const id = await makeImageData(buf, W, H, false, doc.colorProfileName); await imaging.putPixels({ documentID: doc.id, layerID: glyphs.id, imageData: id }); id.dispose(); });
  return tree(doc);
});
await step("preview (layer source)", async () => { await ink.preview(); return [__el("inkPreview").src.length, __el("inkStatus").textContent]; });
await step("preview fit", async () => { __el("inkZoom").value = "fit"; await ink.preview(); __el("inkZoom").value = "1"; return [__el("inkPreview").src.length, __el("inkStatus").textContent]; });
await step("apply new overlay", async () => {
  await ink.apply(false);
  return [__el("inkStatus").textContent, tree(doc), ink.editing()];
});
await step("overlay pixels", async () => {
  const g = findLayerById(doc, ink.editing().groupId), out = {};
  for (const l of g.layers) out[l.name] = await alphaStats(doc, l);
  return out;
});
await step("update: paper off, more spread (keeps group, drops Paper)", async () => {
  Object.assign(ink.settings(), { paperLayer: false, spread: 9, wetness: 0.8 });
  await ink.apply(true);
  return [__el("inkStatus").textContent, tree(doc)];
});
await step("history is one step per apply", async () => doc.historyStates.slice(-3).map((h) => h.name));
await step("save visual check png", async () => {
  if (!__MIRROR_DIR) return "no LOG_MIRROR";
  const f = await lfs.createEntryWithUrl("file:" + __MIRROR_DIR + "/ink_visual.png", { overwrite: true });
  await M(() => doc.saveAs.png(f, { compression: 6 }, true)); return f.nativePath;
});
await step("16-bit status", async () => __el("inkStatus").textContent);
await step("light ink on dark, visible source", async () => {
  ink.stopEditing(); Object.assign(ink.settings(), { paperLayer: true, spread: 4, wetness: 0.5 });
  const d = await M(() => app.documents.add({ width: 600, height: 400, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  const W = d.width, H = d.height, buf = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { const x = i % W, y = (i / W) | 0, on = (x % 40 < 6 || y % 50 < 5) ? 1 : 0; buf[i * 4] = on ? 60 : 5; buf[i * 4 + 1] = on ? 255 : 8; buf[i * 4 + 2] = on ? 120 : 6; buf[i * 4 + 3] = 255; }
  await M(async () => { const id = await makeImageData(buf, W, H, false, d.colorProfileName); await imaging.putPixels({ documentID: d.id, layerID: d.layers[0].id, imageData: id }); id.dispose(); });
  __el("inkSource").value = "merged";
  await ink.apply(false);
  const res = [__el("inkStatus").textContent, tree(d)];
  __el("inkSource").value = "layer"; ink.stopEditing();
  await M(() => d.closeWithoutSaving());
  return res;
});
await step("16-bit doc", async () => {
  const d = await M(() => app.documents.add({ width: 500, height: 300, resolution: 72, mode: "RGBColorMode", fill: "white", depth: 16 }));
  const l = await M(() => createLayer(d, "Ink"));
  const W = d.width, H = d.height, buf = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { const x = i % W; buf[i * 4 + 3] = x % 50 < 8 ? 255 : 0; }
  await M(async () => { const id = await makeImageData(convertOut(buf, W * H, 16, false), W, H, false, d.colorProfileName); await imaging.putPixels({ documentID: d.id, layerID: l.id, imageData: id }); id.dispose(); });
  await ink.apply(false);
  if (!ink.editing()) { const msg = __el("inkStatus").textContent; await M(() => d.closeWithoutSaving()); throw new Error("apply failed: " + msg); }
  const g = findLayerById(d, ink.editing().groupId), bleed = g.layers.find((x) => x.name === "Ink bleed");
  const res = [__el("inkStatus").textContent, tree(d), await alphaStats(d, bleed)];
  ink.stopEditing();
  await M(() => d.closeWithoutSaving());
  return res;
});
await step("texture file: load, preview, apply", async () => {
  if (!__MIRROR_DIR) return "no LOG_MIRROR";
  ink.stopEditing();
  await M(async () => { app.activeDocument = doc; await selectLayer(findLayers(doc.layers, (l) => l.name === "Glyphs")[0]); });
  Object.assign(ink.settings(), { paperLayer: true, texScale: 1, texStrength: 1, texColour: true });
  const t0 = Date.now(), t = await ink.useTextureFile(await lfs.getEntryWithUrl("file:" + __MIRROR_DIR + "/tex_test.jpg"));
  await ink.preview(); const first = Date.now() - t0;
  const t1 = Date.now(); await ink.preview(); const again = Date.now() - t1;
  await ink.apply(false);
  const g = ink.editing() && findLayerById(doc, ink.editing().groupId), paper = g && g.layers.find((l) => l.name === "Paper");
  return { texture: t.name, firstPreviewMs: first, cachedPreviewMs: again, status: __el("inkStatus").textContent, paperMode: paper && String(paper.blendMode), paper: paper && (await alphaStats(doc, paper)) };
});
await step("save texture png", async () => {
  if (!__MIRROR_DIR) return "no LOG_MIRROR";
  const f = await lfs.createEntryWithUrl("file:" + __MIRROR_DIR + "/ink_texture.png", { overwrite: true });
  await M(() => doc.saveAs.png(f, { compression: 6 }, true)); return f.nativePath;
});
await step("close test doc", async () => M(() => doc.closeWithoutSaving()));
