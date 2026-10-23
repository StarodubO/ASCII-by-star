// Matrix rain, [ ] fill and the platform font in Photoshop (TEST=rain node tools/build_test.js).
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
baseAtlas = atlas; atlas.id = "builtin"; // as init() would
const BOLD = MONO_FONT.replace(/-Regular$/, "") + "-Bold";
let doc;
await step("create doc with a text layer", async () => {
  doc = await M(() => app.documents.add({ width: 900, height: 500, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  const black = new app.SolidColor(); black.rgb.hexValue = "000000";
  const t = await M(() => doc.createTextLayer({ contents: "STAR", fontSize: 220, fontName: BOLD, textColor: black, position: { x: 120, y: 230 } }));
  return { mono: MONO_FONT, layerFont: t.textItem.characterStyle.font };
});
const count = (text, re) => (text.match(re) || []).length;
await step("rain from the shape (binary)", async () => {
  S = freshSettings({ charset: "standard", size: 12, fg: "#111111", bg: "#ffffff", rainOn: true, rainCharset: "binary", rainDistance: 20 }); src = null; __el("quality").value = "1";
  await applyRaster(false);
  const { cs, grid } = await outputGrid(), lines = Engine.gridLines(grid, cs), below = lines.slice(Math.floor(grid.rows * 0.55)).join("");
  return { rainBelowShape: count(below, /[01]/g), layer: doc.layers[0].name, status: __el("status").textContent };
});
await step("rain everywhere, gradient, 2× smart object", async () => {
  S = freshSettings({ charset: "katakana_half", size: 14, colorMode: "gradient", bg: "#000800", rainOn: true, rainFrom: "everywhere", rainColorMode: "gradient", rainAngle: 15 }); src = null; __el("quality").value = "2";
  await applyRaster(false);
  const { grid } = await outputGrid();
  let faded = 0; for (const v of grid.shade) if (v < 0.99) faded++;
  return { kind: String(doc.layers[0].kind), fadedCells: faded, status: __el("status").textContent };
});
await step("rain of words [STAR|LOVE], art colours", async () => {
  S = freshSettings({ charset: "standard", size: 12, fg: "#2040ff", bg: "#ffffff", rainOn: true, rainCharset: "custom", rainChars: "[STAR|LOVE]", rainColorMode: "art", rainLength: 12 }); src = null; __el("quality").value = "1";
  await applyRaster(false);
  const { cs, grid } = await outputGrid(), lines = Engine.gridLines(grid, cs), cols = [];
  for (let c = 0; c < grid.cols; c++) cols.push(lines.map((l) => l[c]).join(""));
  const html = Engine.toHTML(grid, cs, S);
  return { verticalWords: count(cols.join("|"), /STAR|LOVE/g), htmlSpans: count(html, /<span/g) };
});
await step("fill [STAR] covers the shape", async () => {
  S = freshSettings({ charset: "custom", customChars: "[STAR]", size: 12, fg: "#111111", bg: "#ffffff" }); src = null;
  await applyRaster(false);
  const { cs, grid } = await outputGrid(), text = Engine.toText(grid, cs);
  return { stars: count(text, /STAR/g), others: count(text.replace(/STAR|[STAR\s]/g, ""), /./g) };
});
await step("fill with ramp + [?STAR|LOVE|*]", async () => {
  S = freshSettings({ charset: "custom", customChars: " .:-= [?STAR|LOVE|*]", size: 12, fg: "#111111", bg: "#ffffff", fillLevel: 0.6 }); src = null;
  await applyRaster(false);
  const { cs, grid } = await outputGrid(), text = Engine.toText(grid, cs);
  return { star: count(text, /STAR/g), love: count(text, /LOVE/g), ramp: count(text, /[.:\-=]/g) };
});
await step("fill with characters the built-in font lacks", async () => {
  S = freshSettings({ charset: "custom", customChars: "[привіт|світ]", size: 14, fg: "#111111", bg: "#ffffff" }); src = null;
  await applyRaster(false);
  const { cs, grid } = await outputGrid();
  return { atlas: String(atlas.id).split("|")[0], line: Engine.gridLines(grid, cs)[Math.floor(grid.rows * 0.4)].trim().slice(0, 40), status: __el("status").textContent };
});
await step("editable text layer font", async () => {
  S = freshSettings({ charset: "standard", size: 16, rainOn: true }); src = null;
  await makeTextLayer();
  return { name: doc.layers[0].name, font: doc.layers[0].textItem.characterStyle.font };
});
// layers, top first: text layer, the three fills, words rain, everywhere rain, binary rain, STAR, Background
for (const [i, name] of [[6, "rain_object"], [5, "rain_everywhere"], [4, "rain_words"], [2, "fill_ramp"], [1, "fill_cyrillic"]]) {
  await step("save png " + name, async () => {
    if (!__MIRROR_DIR) return "no LOG_MIRROR";
    const f = await lfs.createEntryWithUrl("file:" + __MIRROR_DIR + "/" + name + ".png", { overwrite: true });
    await M(async () => { const ls = doc.layers; for (let k = 0; k < ls.length; k++) ls[k].visible = k === i || k === ls.length - 1; await doc.saveAs.png(f, { compression: 6 }, true); });
    return f.nativePath;
  });
}
await step("close", () => M(() => doc.closeWithoutSaving()));
