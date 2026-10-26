// Map tab integration steps (TEST=map node tools/build_test.js). Scripts can't use the network in Photoshop, so
// run `node tools/map_fixture.js <LOG_MIRROR folder>` first: fetch is answered from those recordings.
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
const __fs = require("fs"), __fixDir = __MIRROR_DIR + "/mapfix/";
const __fix = JSON.parse(__fs.readFileSync("file:" + __fixDir + "index.json", { encoding: "utf-8" }));
const fetch = async (url) => {
  const rec = __fix[url];
  if (!rec) return { ok: false, status: 599, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  const buf = __fs.readFileSync("file:" + __fixDir + rec.file);
  return { ok: rec.status >= 200 && rec.status < 300, status: rec.status, arrayBuffer: async () => buf, json: async () => JSON.parse(__fs.readFileSync("file:" + __fixDir + rec.file, { encoding: "utf-8" })) }; // (no TextDecoder in UXP)
};
mapTab = setupMap({ $, loadJSON, saveJSON, errMsg, setSelect, baseAtlas: () => atlas, createLayer, bitDepth, isGray, activeDoc, askColor, docBaseName, fitLayout: () => {}, onCheck: () => {}, onAreaToLines: () => lines.useMap() });
lines = setupLines({ $, loadJSON, saveJSON, errMsg, setSelect, baseAtlas: () => atlas, mapArea: () => mapTab.area(), showTab: () => {}, createLayer, bitDepth, isGray, checkDoc, activeDoc, askColor, selectLayer, docBaseName, fitLayout: () => {}, onCheck: () => {} });
const tree = (d) => findLayers(d.layers, () => true).map((l) => `${l.name}${l.parent ? " <" + l.parent.name + ">" : ""}`);
async function alphaStats(d, layer) {
  const r = await M(() => imaging.getPixels({ documentID: d.id, layerID: layer.id, applyAlpha: false }));
  const px = await toRGBA8(r.imageData), n = px.length / 4;
  let nz = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]) nz++;
  r.imageData.dispose();
  return (nz / n).toFixed(3);
}
async function savePNG(d, name) {
  const f = await lfs.createEntryWithUrl("file:" + __MIRROR_DIR + "/" + name, { overwrite: true });
  await M(() => d.saveAs.png(f, { compression: 6 }, true)); return f.nativePath;
}
let doc;
await step("create doc", async () => {
  doc = await M(() => app.documents.add({ width: 1500, height: 1000, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  return tree(doc);
});
await step("find area + preview", async () => {
  __el("mpPlace").value = "50.4501, 30.5234";
  await mapTab.findPlace();
  await mapTab.preview();
  return [mapTab.area(), __el("mpStatus").textContent, __el("mpPreview").src.length];
});
await step("add map layers (classic)", async () => {
  await mapTab.apply(false);
  const g = findLayerById(doc, mapTab.editing().groupId), cover = {};
  for (const l of g.layers) cover[l.name] = await alphaStats(doc, l);
  return [__el("mpStatus").textContent, cover];
});
await step("save map png", async () => savePNG(doc, "map_classic.png"));
await step("select water", async () => {
  __el("mpSelectWhat").value = "water";
  await mapTab.selectFeatures();
  const b = await selectionBounds(doc);
  await M(() => action.batchPlay([{ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" } }], {}));
  return [__el("mpStatus").textContent, b];
});
await step("update: night look", async () => {
  mapTab.applyLook(__mods.features.STYLES.find((x) => x.id === "night").s);
  await mapTab.apply(true);
  return [__el("mpStatus").textContent, tree(doc).filter((n) => / Map$/.test(n)).length + " map group(s)"];
});
await step("save night png", async () => savePNG(doc, "map_night.png"));
await step("randomize, then undo", async () => {
  await new Promise((r) => setTimeout(r, 800));
  const before = JSON.stringify(mapTab.settings());
  mapTab.randomize();
  return { changed: JSON.stringify(mapTab.settings()) !== before, undone: mapTab.undo() && JSON.stringify(mapTab.settings()) === before };
});
await step("contours of this area with height labels (Lines tab)", async () => {
  for (const l of doc.layers) await M(async () => { l.visible = false; });
  mapTab.stopEditing();
  lines.useMap();
  lines.useLook("topo");
  Object.assign(lines.settings(), { mapInterval: 10, labelSize: 40, peaks: 4 });
  await M(() => selectLayer(doc.layers[doc.layers.length - 1]));
  await lines.apply(false);
  return [__el("lnStatus").textContent, __el("lnMapInfo").textContent, tree(doc)];
});
await step("save contours png", async () => savePNG(doc, "map_contours.png"));
await step("16-bit doc map", async () => {
  const d = await M(() => app.documents.add({ width: 1500, height: 1000, resolution: 72, mode: "RGBColorMode", depth: 16, fill: "white" }));
  mapTab.stopEditing();
  await mapTab.apply(false);
  const res = [String(d.bitsPerChannel), __el("mpStatus").textContent, tree(d).length + " layers"];
  await M(() => d.closeWithoutSaving());
  return res;
});
await step("close test doc", async () => M(() => doc.closeWithoutSaving()));
