// Custom text integration steps (TEST=text node tools/build_test.js): phrase and words modes, and characters
// missing from the built-in atlas being drawn by Photoshop instead of dropped.
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
baseAtlas = atlas; atlas.id = "builtin"; // as init() would
let doc;
await step("create doc", async () => {
  doc = await M(() => app.documents.add({ width: 800, height: 500, resolution: 72, mode: "RGBColorMode", depth: 8, fill: "white" }));
  const W = doc.width, H = doc.height, buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, d = Math.hypot(x - W / 2, y - H / 2) / (H / 2), v = 255 * Math.min(1, d); buf[o] = buf[o + 1] = buf[o + 2] = v; buf[o + 3] = 255; }
  await M(async () => { const id = await makeImageData(buf, W, H, false, doc.colorProfileName); await imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: id }); id.dispose(); });
});
await step("phrase with characters the built-in font lacks", async () => {
  S = freshSettings({ charset: "custom", customChars: "привіт світ ", textMode: "phrase", size: 14, colorMode: "mono", fg: "#202020", bg: "#f4efe4" }); src = null; __el("quality").value = "1";
  await applyRaster(false);
  const { cs, grid } = await outputGrid();
  return { atlas: atlas.id.split("|")[0], charset: cs.chars.join(""), line: Engine.gridLines(grid, cs)[Math.floor(grid.rows / 2)].trim().slice(0, 40), status: __el("status").textContent };
});
await step("words mode", async () => {
  S = freshSettings({ charset: "custom", customChars: "· oo OK ###", textMode: "words", size: 14, colorMode: "mono", fg: "#202020", bg: "#f4efe4" }); src = null;
  await applyRaster(false);
  const { cs, grid } = await outputGrid(), used = new Set();
  for (const g of grid.glyph) if (g >= 0) used.add(cs.chars[g]);
  return { atlas: String(atlas.id).split("|")[0], used: [...used].join(""), status: __el("status").textContent };
});
await step("save png", async () => {
  if (!__MIRROR_DIR) return "no LOG_MIRROR";
  doc.layers[0].visible = false;
  const f = await lfs.createEntryWithUrl("file:" + __MIRROR_DIR + "/text_visual.png", { overwrite: true });
  await M(async () => { doc.layers[0].visible = false; await doc.saveAs.png(f, { compression: 6 }, true); }); return f.nativePath;
});
await step("close", () => M(() => doc.closeWithoutSaving()));
