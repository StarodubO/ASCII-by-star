// Builds test/gf_test.psjs: plugin code + DOM shims + an integration test sequence.
const fs = require("fs"), path = require("path");
const P = (f) => path.join(__dirname, "../plugin", f);
const wrap = (name, file) => `(function(){ const module = { exports: {} }; ${fs.readFileSync(P(file), "utf8")}\n__mods[${JSON.stringify(name)}] = module.exports; })();\n`;
let main = fs.readFileSync(P("main.js"), "utf8")
  .replace('require("./engine.js")', '__mods.engine').replace('require("./charsets.js")', '__mods.charsets').replace('require("./presets.js")', '__mods.presets')
  .replace(/\ninit\(\);\s*$/, "\n");
const atlasB64 = fs.readFileSync(P("atlas.bin")).toString("base64");
const meta = fs.readFileSync(P("atlas.json"), "utf8");
const MAIN_STEPS = 'let doc;\nawait step("create doc", async () => {\n  doc = await core.executeAsModal(() => app.documents.add({ width: 900, height: 600, resolution: 144, mode: "RGBColorMode", fill: "white" }), { commandName: "t" });\n  return [doc.width, doc.height, String(doc.mode), String(doc.bitsPerChannel), doc.colorProfileName];\n});\nawait step("paint test image", async () => {\n  const W = doc.width, H = doc.height, buf = new Uint8Array(W * H * 4);\n  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {\n    const o = (y * W + x) * 4, d = Math.hypot(x - W / 2, y - H / 2) / (H / 2);\n    buf[o] = 255 * x / W; buf[o + 1] = 255 * Math.max(0, 1 - d); buf[o + 2] = 255 * y / H; buf[o + 3] = 255;\n  }\n  await core.executeAsModal(async () => {\n    const id = await makeImageData(buf, W, H, false, doc.colorProfileName);\n    await imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: id });\n    id.dispose();\n  }, { commandName: "t" });\n});\nawait step("ensureSource", async () => { src = null; await ensureSource(0); return [src.w, src.h, src.scale]; });\nawait step("preview render+encode", async () => { await renderPreview(); return __el("preview").src.length; });\nS = freshSettings(PRESETS.find((p) => p.id === "classic").settings);\nawait step("apply classic", async () => { await applyRaster(false); return await layerNames(doc); });\nS = freshSettings(Object.assign({}, PRESETS.find((p) => p.id === "fullcolor").settings, { bgMode: "transparent" }));\nawait step("apply fullcolor transparent (hides prior GF layer while sampling)", async () => { await applyRaster(false); return await layerNames(doc); });\nawait step("pixel check top layer", async () => {\n  const top = doc.layers[0];\n  const r = await core.executeAsModal(() => imaging.getPixels({ documentID: doc.id, layerID: top.id, sourceBounds: { left: 400, top: 280, right: 500, bottom: 320 } }), { commandName: "t" });\n  const d = await r.imageData.getData({ chunky: true }); let nz = 0, sum = 0;\n  for (let i = 3; i < d.length; i += r.imageData.components) { if (d[i] > 0) nz++; sum += d[i - 2]; }\n  const res = { comps: r.imageData.components, opaqueFrac: (nz / (d.length / r.imageData.components)).toFixed(2), bounds: top.bounds };\n  r.imageData.dispose(); return res;\n});\nawait step("re-edit + update", async () => {\n  await core.executeAsModal(async () => { doc.activeLayers.forEach((l) => (l.selected = false)); doc.layers[0].selected = true; }, { commandName: "t" });\n  loadSelectedLayer(); S.size = 20; await applyRaster(true); return [editing && editing.tag, await layerNames(doc)];\n});\nediting = null;\nawait step("text layer", async () => { S = freshSettings({ size: 18 }); await makeTextLayer(); const t = doc.layers[0]; return [t.name, String(t.kind), t.bounds]; });\nawait step("exports", async () => { const { cs, grid } = await outputGrid(); return [Engine.toText(grid, cs).length, Engine.toHTML(grid, cs, S).length, Engine.toSVG(grid, cs, S).length]; });\nawait step("fonts (batchPlay)", async () => await loadFonts());\nawait step("history not polluted by preview capture", async () => {\n  const before = doc.historyStates.length; src = null; await ensureSource(0); return [before, doc.historyStates.length, doc.historyStates[doc.historyStates.length - 1].name];\n});\nawait step("save visual check png", async () => {\n  const tmpF = await lfs.getDataFolder(); const pf = await tmpF.createFile("gf_visual.png", { overwrite: true });\n  await core.executeAsModal(() => doc.saveAs.png(pf, { compression: 6 }, true), { commandName: "t" }); return pf.nativePath;\n});\nawait step("source = active layer", async () => {\n  __el("source").value = "layer";\n  await core.executeAsModal(async () => { const bgL = doc.layers[doc.layers.length - 1]; doc.layers.forEach((l) => (l.selected = false)); bgL.selected = true; }, { commandName: "t" });\n  src = null; await ensureSource(0); __el("source").value = "merged"; return [src.layerId, src.w, src.h];\n});\nfor (const depth of [16, 32]) {\n  await step(depth + "-bit doc apply", async () => {\n    const d = await core.executeAsModal(() => app.documents.add({ width: 400, height: 300, resolution: 72, mode: "RGBColorMode", fill: "white", depth }), { commandName: "t" });\n    S = freshSettings(PRESETS.find((p) => p.id === "neon").settings); src = null;\n    await applyRaster(false);\n    const top = d.layers[0];\n    const r = await core.executeAsModal(() => imaging.getPixels({ documentID: d.id, layerID: top.id, componentSize: 8 }), { commandName: "t" });\n    const px = await r.imageData.getData({ chunky: true }); const c0 = [px[0], px[1], px[2], px[3]]; r.imageData.dispose();\n    const res = [String(d.bitsPerChannel), top.name, "first px (expect bg #07000f)", c0, __el("status").textContent];\n    await core.executeAsModal(() => d.closeWithoutSaving(), { commandName: "t" });\n    return res;\n  });\n}\nawait step("grayscale apply", async () => {\n  await core.executeAsModal(() => doc.changeMode(constants.ChangeMode.GRAYSCALE), { commandName: "t" });\n  S = freshSettings(PRESETS.find((p) => p.id === "halftone").settings); src = null; await applyRaster(false); return [String(doc.mode), doc.layers[0].name];\n});\nawait step("close test doc", async () => core.executeAsModal(() => doc.closeWithoutSaving(), { commandName: "t" }));\n';
const DEPTH_STEPS = fs.readFileSync(path.join(__dirname, "depth_steps.js"), "utf8");
const out = `
const __mods = {};
const __log = [];
function L(...a) { __log.push(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ")); }
const __els = {};
const __defaults = { source: "merged", zoom: "fit", font: "Menlo-Regular", batchTxt: false };
function __el(id) {
  if (!__els[id]) __els[id] = { id, value: __defaults[id] !== undefined ? __defaults[id] : "", checked: false, textContent: "", src: "", style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} }, options: [], addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  return __els[id];
}
const document = { getElementById: __el, querySelectorAll: () => [] };
const __ls = new Map();
const localStorage = { getItem: (k) => (__ls.has(k) ? __ls.get(k) : null), setItem: (k, v) => __ls.set(k, String(v)) };
${wrap("engine", "engine.js")}${wrap("charsets", "charsets.js")}${wrap("presets", "presets.js")}
${main}
function __b64(s) {
  const T = new Uint8Array(128); const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < 64; i++) T[A.charCodeAt(i)] = i;
  const n = s.length, pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0, out = new Uint8Array((n * 3) / 4 - pad);
  for (let i = 0, o = 0; i < n; i += 4) {
    const v = (T[s.charCodeAt(i)] << 18) | (T[s.charCodeAt(i + 1)] << 12) | (T[s.charCodeAt(i + 2)] << 6) | T[s.charCodeAt(i + 3)];
    if (o < out.length) out[o++] = (v >> 16) & 255; if (o < out.length) out[o++] = (v >> 8) & 255; if (o < out.length) out[o++] = v & 255;
  }
  return out;
}
let __logFile = null;
async function __flush() {
  try { if (!__logFile) __logFile = await (await lfs.getDataFolder()).createFile("asciibystar_test.log", { overwrite: true }); await __logFile.write(__log.join(String.fromCharCode(10)), { format: formats.utf8 }); } catch (e) { /* ignore */ }
}
async function step(name, fn) {
  L("... " + name); await __flush();
  const t0 = Date.now();
  try { const r = await fn(); L("OK  ", name, (Date.now() - t0) + "ms", r === undefined ? "" : r, "| status:", __el("status").textContent); }
  catch (e) { L("FAIL", name, String(e && (e.stack || e.message || e)).slice(0, 400)); }
  await __flush();
}
async function layerNames(doc) { return findLayers(doc.layers, () => true).map((l) => l.name + (l.visible ? "" : " (hidden)")); }

for (const k of Object.keys(SLIDERS)) sliderEls[k] = { input: {}, val: {}, fmt: String, row: __el("row-" + k) };
atlas = Engine.prepareAtlas(${meta}, __b64(${JSON.stringify(atlasB64)}));
L("atlas", atlas.n, atlas.cellW, atlas.cellH);
${process.env.TEST === "depth" ? DEPTH_STEPS : MAIN_STEPS}
L("DONE"); await __flush();
`;
fs.writeFileSync(path.join(__dirname, "../test/gf_test.psjs"), out);
console.log("built", out.length);
