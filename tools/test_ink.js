// Node harness for the ink bleed effect: renders every paper type over a source PNG, tiled like the plugin.
//   node tools/test_ink.js <src.png> <outDir> [--paper id] [--ascii presetId] [--transparent] [--long 2000] [--texture paper.png [--texscale 1]] [--check]
// --ascii first turns (optionally with --size <font px>) the image into ASCII art (upscaled to --long px) and uses that as the source layer.
// --check also renders in one piece and reports the largest difference from the tiled render (seams).
const fs = require("fs"), path = require("path");
const Ink = require("../plugin/ink.js"), E = require("../plugin/engine.js");
const { CHARSETS } = require("../plugin/charsets.js"), { PRESETS } = require("../plugin/presets.js");
const { readPNG, writePNG } = require("./test_engine.js");

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
let src = readPNG(args[0]);
const outDir = args[1], only = opt("--paper", null);
fs.mkdirSync(outDir, { recursive: true });

function resize(img, W, H) {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(img.w - 1.001, Math.max(0, ((x + 0.5) * img.w) / W - 0.5)), sy = Math.min(img.h - 1.001, Math.max(0, ((y + 0.5) * img.h) / H - 0.5));
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    for (let c = 0; c < 4; c++) {
      const g = (xx, yy) => img.data[(yy * img.w + xx) * 4 + c];
      out[(y * W + x) * 4 + c] = (g(ix, iy) * (1 - fx) + g(ix + 1, iy) * fx) * (1 - fy) + (g(ix, iy + 1) * (1 - fx) + g(ix + 1, iy + 1) * fx) * fy;
    }
  }
  return { w: W, h: H, data: out };
}
if (args.includes("--ascii")) {
  const long = Number(opt("--long", 2000)), k = long / Math.max(src.w, src.h);
  src = resize(src, Math.round(src.w * k), Math.round(src.h * k));
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "../plugin/atlas.json")));
  const atlas = E.prepareAtlas(meta, fs.readFileSync(path.join(__dirname, "../plugin/atlas.bin")));
  const p = PRESETS.find((x) => x.id === opt("--ascii"));
  const s = Object.assign({}, E.DEFAULTS, p.settings, args.includes("--transparent") ? { bgMode: "transparent" } : {}, args.includes("--size") ? { size: Number(opt("--size")) } : {});
  const cs = E.charsetOf(atlas, s, CHARSETS.find((c) => c.id === s.charset).chars);
  const geo = E.computeGeometry(src.w, src.h, s, atlas);
  src = { w: src.w, h: src.h, data: E.render(E.computeGrid(src, geo, s, cs), cs, atlas, s, { x: 0, y: 0, w: src.w, h: src.h, scale: 1 }) };
  writePNG(path.join(outDir, "_source.png"), src.w, src.h, src.data);
}

// zero-padded read of a doc rect, like reading a layer in Photoshop
function readRect(x, y, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let yy = Math.max(0, -y); yy < h && y + yy < src.h; yy++) {
    const x0 = Math.max(0, -x), x1 = Math.min(w, src.w - x);
    if (x1 > x0) out.set(src.data.subarray(((y + yy) * src.w + x + x0) * 4, ((y + yy) * src.w + x + x1) * 4), (yy * w + x0) * 4);
  }
  return out;
}
const LAYERS = ["bleed", "pool", "gaps", "paper"];
let texture = null;
if (args.includes("--texture")) { const t = readPNG(opt("--texture")); texture = Ink.prepareTexture(t.data, t.w, t.h); console.log("texture", t.w + "x" + t.h, texture.screen ? "(dark texture)" : "(light texture)", texture.levels.length, "levels"); }
function renderTiled(s, det, tile) {
  const W = src.w, H = src.h, sk = Math.max(W, H) / Ink.REF, M = Ink.margin(s, sk);
  const full = {}; for (const k of LAYERS) full[k] = new Uint8ClampedArray(W * H * 4);
  for (let ty = 0; ty < H; ty += tile) for (let tx = 0; tx < W; tx += tile) {
    const tw = Math.min(tile, W - tx), th = Math.min(tile, H - ty), bx = tx - M, by = ty - M, bw = tw + 2 * M, bh = th + 2 * M;
    const paper = texture && { tex: texture, place: Ink.placeTexture(texture, W, H, s.texScale) };
    const L = Ink.process({ w: bw, h: bh, data: readRect(bx, by, bw, bh) }, bx, by, { x: M, y: M, w: tw, h: th }, sk, s, det, paper);
    for (const k of LAYERS) if (L[k]) for (let y = 0; y < th; y++) full[k].set(L[k].subarray(y * tw * 4, (y + 1) * tw * 4), ((ty + y) * W + tx) * 4);
  }
  return Object.assign({ w: W, h: H, light: det.light, paperMode: Ink.paperMode(det) }, full);
}
const rgbToRGBA = (rgb, n) => { const o = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { o[i * 4] = rgb[i * 3]; o[i * 4 + 1] = rgb[i * 3 + 1]; o[i * 4 + 2] = rgb[i * 3 + 2]; o[i * 4 + 3] = 255; } return o; };
function crop(rgba, W, x, y, w, h) { const o = new Uint8Array(w * h * 4); for (let r = 0; r < h; r++) o.set(rgba.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4); return o; }

const det = Ink.detect(src.data, opt("--from", "auto"));
console.log("source", src.w + "x" + src.h, "·", det.label);
for (const p of Ink.PAPERS) {
  if (only && p.id !== only) continue;
  const s = Object.assign({}, Ink.DEFAULTS, p.s, { paper: p.id }, args.includes("--texscale") ? { texScale: Number(opt("--texscale")) } : {});
  const t0 = Date.now();
  const L = renderTiled(s, det, 1024);
  const ms = Date.now() - t0;
  const comp = rgbToRGBA(Ink.composite(src.data, L), src.w * src.h);
  writePNG(path.join(outDir, p.id + ".png"), src.w, src.h, comp);
  const cw = Math.min(700, src.w), ch = Math.min(450, src.h), cx = Math.floor((src.w - cw) / 2), cy = Math.floor((src.h - ch) / 2);
  writePNG(path.join(outDir, p.id + "_crop.png"), cw, ch, crop(comp, src.w, cx, cy, cw, ch));
  const zw = 300, zh = 190, zx = Math.floor(src.w * 0.3), zy = Math.floor(src.h * 0.4), z = crop(comp, src.w, zx, zy, zw, zh), zz = new Uint8Array(zw * zh * 16);
  for (let y = 0; y < zh * 2; y++) for (let x = 0; x < zw * 2; x++) zz.set(z.subarray(((y >> 1) * zw + (x >> 1)) * 4, ((y >> 1) * zw + (x >> 1)) * 4 + 4), (y * zw * 2 + x) * 4);
  writePNG(path.join(outDir, p.id + "_zoom.png"), zw * 2, zh * 2, zz);
  let line = `${p.id.padEnd(12)} ${ms}ms`;
  if (args.includes("--check")) {
    const one = renderTiled(s, det, Math.max(src.w, src.h));
    let worst = 0;
    // compare premultiplied, so colour noise under ~zero alpha doesn't count
    for (const k of LAYERS) if (L[k]) for (let i = 0; i < L[k].length; i += 4) for (let c = 0; c < 4; c++) {
      const pa = c === 3 ? 255 : L[k][i + 3], pb = c === 3 ? 255 : one[k][i + 3];
      worst = Math.max(worst, Math.abs((L[k][i + c] * pa - one[k][i + c] * pb) / 255));
    }
    line += ` · max tile difference ${worst.toFixed(1)}/255`;
  }
  console.log(line);
}
