// Node harness for the Dither tab: renders every built-in look over a source PNG, tiled like the plugin.
//   node tools/test_dither.js <src.png> <outDir> [--look id] [--long 1600] [--tile 700] [--set k=v,…] [--check]
// --check also renders in one piece and reports the largest difference from the tiled render (seams).
const fs = require("fs"), path = require("path");
const Dither = require("../plugin/dither.js");
const { readPNG, writePNG } = require("./test_engine.js");

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
let src = readPNG(args[0]);
const outDir = args[1], only = opt("--look", null), TILE = Number(opt("--tile", 700));
fs.mkdirSync(outDir, { recursive: true });
if (args.includes("--long")) {
  const k = Number(opt("--long")) / Math.max(src.w, src.h), W = Math.round(src.w * k), H = Math.round(src.h * k), d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = (Math.min(src.h - 1, Math.floor(y / k)) * src.w + Math.min(src.w - 1, Math.floor(x / k))) * 4; d.set(src.data.subarray(s, s + 4), (y * W + x) * 4); }
  src = { w: W, h: H, data: d };
}
// what reader.read(frame, 1/pixel) gives: one box-averaged sample per cell
function cellsOf(img, p) {
  const { w: W, h: H } = Dither.cellsOf(img.w, img.h, p), out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = x * p, x1 = Math.min(img.w, x0 + p), y0 = y * p, y1 = Math.min(img.h, y0 + p), acc = [0, 0, 0, 0];
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) for (let c = 0; c < 4; c++) acc[c] += img.data[(yy * img.w + xx) * 4 + c];
    for (let c = 0; c < 4; c++) out[(y * W + x) * 4 + c] = acc[c] / ((x1 - x0) * (y1 - y0));
  }
  return { w: W, h: H, data: out };
}
const over = {};
for (const kv of String(opt("--set", "")).split(",").filter(Boolean)) { const [k, v] = kv.split("="); over[k] = v === "true" ? true : v === "false" ? false : isNaN(Number(v)) ? v : Number(v); }
for (const look of Dither.STYLES) {
  if (only && look.id !== only) continue;
  const s = Dither.migrate(Object.assign(JSON.parse(JSON.stringify(Dither.DEFAULTS)), look.s, over));
  const p = Math.max(1, Math.round(s.pixel)), t0 = Date.now(), F = Dither.makeField(cellsOf(src, p), src.w, src.h, p);
  Dither.gridOf(F, s);
  const t1 = Date.now(), out = new Uint8Array(src.w * src.h * 4), strips = new Map();
  for (let ty = 0; ty < src.h; ty += TILE) for (let tx = 0; tx < src.w; tx += TILE) {
    const tw = Math.min(TILE, src.w - tx), th = Math.min(TILE, src.h - ty), px = Dither.renderFx(F, s, { x: tx, y: ty, w: tw, h: th }, 1, undefined, strips);
    for (let y = 0; y < th; y++) out.set(px.subarray(y * tw * 4, (y + 1) * tw * 4), ((ty + y) * src.w + tx) * 4);
  }
  let note = "";
  if (args.includes("--check")) {
    const one = Dither.renderFx(F, s, { x: 0, y: 0, w: src.w, h: src.h }, 1);
    let d = 0;
    for (let i = 0; i < one.length; i++) d = Math.max(d, Math.abs(one[i] - out[i]));
    note = ` · max tile difference ${d.toFixed(1)}`;
  }
  const z = Math.min(1, 500 / Math.max(src.w, src.h)), pw = Math.max(1, Math.round(src.w * z)), ph = Math.max(1, Math.round(src.h * z));
  const pv = Dither.renderFx(F, s, { x: 0, y: 0, w: src.w, h: src.h }, z);
  writePNG(path.join(outDir, look.id + ".png"), src.w, src.h, out);
  writePNG(path.join(outDir, look.id + "_preview.png"), pw, ph, pv);
  console.log(`${look.id.padEnd(10)} dither ${t1 - t0}ms · render ${Date.now() - t1}ms${note}`);
}
