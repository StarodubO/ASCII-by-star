// Outline, hidden messages and Digits in Photoshop (TEST=feature node tools/build_test.js).
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
baseAtlas = atlas; atlas.id = "builtin"; // as init() would
let doc;
await step("create doc with a text layer", async () => {
  doc = await M(() => app.documents.add({ width: 900, height: 400, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  const black = new app.SolidColor(); black.rgb.hexValue = "000000";
  await M(() => doc.createTextLayer({ contents: "STAR", fontSize: 260, fontName: "Menlo-Bold", textColor: black, position: { x: 140, y: 300 } }));
  return findLayers(doc.layers, () => true).map((l) => l.name);
});
const used = (cs, grid) => { const u = new Set(); for (const g of grid.glyph) if (g >= 0) u.add(cs.chars[g]); return [...u].join(""); };
await step("outline: lines outside, empty inside", async () => {
  S = freshSettings({ size: 12, fg: "#111111", bg: "#ffffff", outlineOn: true, outlineFill: "none" }); src = null; __el("quality").value = "1";
  await applyRaster(false);
  const { cs, grid } = await outputGrid();
  return { used: used(cs, grid), layer: doc.layers[0].name, status: __el("status").textContent };
});
await step("outline: your characters, filled inside, 2× smart object", async () => {
  S = freshSettings({ size: 12, fg: "#111111", bg: "#ffffff", outlineOn: true, outlineStyle: "chars", outlineChars: "STAR", outlineFill: "chars", outlineFillChars: "░", outlineWidth: 2, outlinePos: "center" }); src = null; __el("quality").value = "2";
  await applyRaster(false);
  const { cs, grid } = await outputGrid();
  return { used: used(cs, grid), kind: String(doc.layers[0].kind), status: __el("status").textContent };
});
await step("hidden messages", async () => {
  S = freshSettings({ charset: "custom", customChars: " .:-=+*#%@{HELLO}{XO*4}", size: 10, fg: "#111111", bg: "#ffffff" }); src = null; __el("quality").value = "1";
  await applyRaster(false);
  const { cs, grid } = await outputGrid(), text = Engine.toText(grid, cs);
  return { placed: grid.hiddenPlaced, hello: text.includes("HELLO"), xo: (text.match(/XO/g) || []).length, ramp: cs.chars.slice(0, cs.n).join("") };
});
await step("digits use more than one digit", async () => {
  S = freshSettings({ charset: "digits", size: 10 }); src = null;
  const { cs, grid } = await outputGrid();
  return used(cs, grid);
});
await step("drop shadow colour on a dark background", async () => {
  S = freshSettings({ dropOn: false }); __el("dropOn").checked = true; S.dropOn = true; visibleShadow("dropOn");
  return [S.dropColor, __el("status").textContent];
});
await step("save png", async () => {
  if (!__MIRROR_DIR) return "no LOG_MIRROR";
  const f = await lfs.createEntryWithUrl("file:" + __MIRROR_DIR + "/feature_visual.png", { overwrite: true });
  await M(async () => { for (const l of doc.layers.slice(1)) l.visible = false; await doc.saveAs.png(f, { compression: 6 }, true); });
  return f.nativePath;
});
await step("close", () => M(() => doc.closeWithoutSaving()));
