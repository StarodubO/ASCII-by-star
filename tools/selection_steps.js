// An active selection must not clip the output (TEST=selection node tools/build_test.js): a raw putPixels with
// a marquee active, the same through withoutSelection (selection kept, shape and all), and Apply with a marquee.
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
baseAtlas = atlas; atlas.id = "builtin"; // as init() would
const px = (n) => ({ _unit: "pixelsUnit", _value: n });
const selBounds = async (d) => {
  const r = await action.batchPlay([{ _obj: "get", _target: [{ _property: "selection" }, { _ref: "document", _id: d.id }] }], {});
  const s = r && r[0] && r[0].selection, v = (x) => Number(x && typeof x === "object" ? x._value : x);
  return s && s.left !== undefined ? [v(s.left), v(s.top), v(s.right), v(s.bottom)] : null;
};
const alphaAt = async (d, layer, x, y) => {
  const r = await M(() => imaging.getPixels({ documentID: d.id, layerID: layer.id, sourceBounds: { left: x, top: y, right: x + 1, bottom: y + 1 } }));
  const p = await toRGBA8(r.imageData); r.imageData.dispose(); return p[3];
};
const selAt = async (d, x, y) => {
  const r = await M(() => imaging.getSelection({ documentID: d.id, sourceBounds: { left: x, top: y, right: x + 1, bottom: y + 1 } }));
  const m = await r.imageData.getData({ chunky: true }); r.imageData.dispose(); return m[0];
};
const solid = async (d, layer) => {
  const W = d.width, H = d.height, buf = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = 255; buf[i * 4 + 3] = 255; }
  const id = await makeImageData(buf, W, H, false, d.colorProfileName);
  try { await imaging.putPixels({ documentID: d.id, layerID: layer.id, imageData: id, replace: true }); } finally { id.dispose(); }
};
let doc;
await step("create doc with an elliptical marquee", async () => {
  doc = await M(() => app.documents.add({ width: 400, height: 300, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  await M(() => action.batchPlay([{ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _obj: "ellipse", top: px(100), left: px(100), bottom: px(200), right: px(300) }, antiAlias: true }], {}));
  return { sel: await selBounds(doc), centre: await selAt(doc, 200, 150), corner: await selAt(doc, 102, 102) };
});
await step("raw putPixels with the marquee active", async () => {
  const l = await M(() => createLayer(doc, "raw"));
  await M(() => solid(doc, l));
  return { outsideAlpha: await alphaAt(doc, l, 10, 10), insideAlpha: await alphaAt(doc, l, 200, 150) };
});
await step("putPixels through withoutSelection", async () => {
  const l = await M(() => createLayer(doc, "wrapped"));
  await M(() => withoutSelection(doc, () => solid(doc, l)));
  return { outsideAlpha: await alphaAt(doc, l, 10, 10), sel: await selBounds(doc), centre: await selAt(doc, 200, 150), cornerStillOut: await selAt(doc, 102, 102) };
});
await step("Apply with the marquee active", async () => {
  S = freshSettings(PRESETS.find((p) => p.id === "classic").settings); src = null; editing = null; __el("quality").value = "1";
  await applyRaster(false);
  const top = doc.layers[0];
  return { name: top.name, bounds: top.bounds, outsideAlpha: await alphaAt(doc, top, 5, 5), sel: await selBounds(doc), history: doc.historyStates.slice(-2).map((h) => h.name) };
});
await step("close test doc", async () => M(() => doc.closeWithoutSaving()));
