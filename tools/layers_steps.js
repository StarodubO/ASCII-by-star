// Separate layers (TEST=layers node tools/build_test.js): Apply builds a group with one layer per part, an update
// replaces it in place, re-edit finds the group from a layer inside it, and the source skips the group's layers.
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
baseAtlas = atlas; atlas.id = "builtin"; // as init() would
let doc;
await step("create doc", async () => {
  doc = await M(() => app.documents.add({ width: 800, height: 500, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  const W = doc.width, H = doc.height, buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, v = Math.hypot(x - 400, y - 250) < 180 ? 30 : 230; buf[o] = v; buf[o + 1] = 120; buf[o + 2] = 255 - v; buf[o + 3] = 255; }
  await M(async () => { const id = await makeImageData(buf, W, H, false, doc.colorProfileName); await imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: id }); id.dispose(); });
  return [W, H];
});
await step("apply as separate layers", async () => {
  S = freshSettings(Object.assign({}, PRESETS.find((p) => p.id === "fullcolor").settings, { outlineOn: true, rainOn: true, cfOn: true, cfBlend: "screen", dropOn: true, glitchOn: true, gRowShift: 0.3 }));
  src = null; editing = null; __el("quality").value = "1"; __el("applyLayers").value = "split"; __el("source").value = "merged";
  await applyRaster(false);
  const g = doc.layers[0];
  return { status: __el("status").textContent, group: g.name, kind: String(g.kind), children: (g.layers || []).map((l) => l.name + ":" + String(l.blendMode)) };
});
await step("re-edit from a layer inside the group, update", async () => {
  const g = doc.layers[0], child = g.layers[0];
  await M(async () => { doc.activeLayers.forEach((l) => (l.selected = false)); child.selected = true; });
  loadSelectedLayer(); S.size = 18; await applyRaster(true);
  return { editing: editing && editing.name, top: doc.layers[0].name, children: (doc.layers[0].layers || []).length, all: await layerNames(doc) };
});
await step("source: active layer skips the group's layers", async () => {
  __el("source").value = "layer";
  return { sourceLayer: sourceLayerId(doc), background: doc.layers[doc.layers.length - 1].id };
});
await step("back to one layer replaces the group", async () => {
  __el("applyLayers").value = "one"; __el("source").value = "merged"; await applyRaster(true);
  return { top: doc.layers[0].name, kind: String(doc.layers[0].kind), all: await layerNames(doc) };
});
await step("close test doc", async () => M(() => doc.closeWithoutSaving()));
