// Node harness for the Lines tab: renders every built-in style over a source PNG, tiled like the plugin.
//   node tools/test_lines.js <src.png> <outDir> [--style id] [--height depth.png] [--long 2400] [--tile 1024] [--check]
// --long scales the source up or down to that long side first.
// --set key=value[,key=value…] overrides settings (numbers and true/false are parsed).
// --map "<Google Maps link | lat, lon | place>" [--km 20] takes the height from that map region (needs the network).
// --check also renders in one piece and reports the largest difference from the tiled render (seams).
const fs = require("fs"), path = require("path");
const Lines = require("../plugin/lines.js"), E = require("../plugin/engine.js");
const atlas = E.prepareAtlas(JSON.parse(fs.readFileSync(path.join(__dirname, "../plugin/atlas.json"))), fs.readFileSync(path.join(__dirname, "../plugin/atlas.bin")));
const { readPNG, writePNG } = require("./test_engine.js");

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
let src = readPNG(args[0]);
const outDir = args[1], only = opt("--style", null);
fs.mkdirSync(outDir, { recursive: true });

// what reader.read(frame, z) returns in the plugin: pixel i at document (i + 0.5)/z, box-averaged
function shrink(img, z) {
  const W = Math.max(1, Math.round(img.w * z)), H = Math.max(1, Math.round(img.h * z)), out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.floor(x / z), x1 = Math.max(x0 + 1, Math.min(img.w, Math.floor((x + 1) / z))), y0 = Math.floor(y / z), y1 = Math.max(y0 + 1, Math.min(img.h, Math.floor((y + 1) / z)));
    const acc = [0, 0, 0, 0];
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) for (let c = 0; c < 4; c++) acc[c] += img.data[(yy * img.w + xx) * 4 + c];
    for (let c = 0; c < 4; c++) out[(y * W + x) * 4 + c] = acc[c] / ((x1 - x0) * (y1 - y0));
  }
  return { w: W, h: H, data: out };
}
if (args.includes("--long")) { // nearest-neighbour is fine: the height field is blurred anyway
  const k = Number(opt("--long")) / Math.max(src.w, src.h), W = Math.round(src.w * k), H = Math.round(src.h * k), d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = (Math.min(src.h - 1, Math.floor(y / k)) * src.w + Math.min(src.w - 1, Math.floor(x / k))) * 4; d.set(src.data.subarray(s, s + 4), (y * W + x) * 4); }
  src = { w: W, h: H, data: d };
}
const TILE = Number(opt("--tile", 1024));
const z = Lines.analysisZ(src.w, src.h), small = shrink(src, z);
let heightImg = args.includes("--height") ? shrink(readPNG(opt("--height")), z) : null;
console.log("source", src.w + "x" + src.h, "· analysis", small.w + "x" + small.h);

const mapExtra = {};
function overrides() {
  const o = {};
  for (const kv of String(opt("--set", "")).split(",").filter(Boolean)) { const [k, v] = kv.split("="); o[k] = v === "true" ? true : v === "false" ? false : isNaN(+v) ? v : +v; }
  return o;
}
async function loadMap() {
  const MapHeights = require("../plugin/map.js");
  let at = MapHeights.parseLocation(opt("--map"));
  if (at.query) at = await MapHeights.geocode(at.query, fetch);
  const km = Number(opt("--km", at.widthKm || 20)), t0 = Date.now();
  heightImg = await MapHeights.loadRegion({ lat: at.lat, lon: at.lon, widthKm: km, w: small.w, h: small.h, fetchFn: fetch });
  Object.assign(mapExtra, { heightFrom: "map", mapWidthKm: km, equalize: false });
  console.log(`map ${at.name || at.lat + ", " + at.lon} · ${km} km · zoom ${heightImg.z} · ${heightImg.tiles} tiles · ${Math.round(heightImg.min)}–${Math.round(heightImg.max)} m · ${Date.now() - t0} ms`);
}
function renderTiled(F, s, tile) {
  const W = src.w, H = src.h, full = new Uint8ClampedArray(W * H * 4);
  for (let ty = 0; ty < H; ty += tile) for (let tx = 0; tx < W; tx += tile) {
    const tw = Math.min(tile, W - tx), th = Math.min(tile, H - ty), px = Lines.render(F, s, { x: tx, y: ty, w: tw, h: th }, 1, atlas);
    for (let y = 0; y < th; y++) full.set(px.subarray(y * tw * 4, (y + 1) * tw * 4), ((ty + y) * W + tx) * 4);
  }
  return full;
}
(async () => {
if (args.includes("--map")) await loadMap();
for (const st of Lines.STYLES) {
  if (only && st.id !== only) continue;
  const s = Object.assign({}, Lines.DEFAULTS, st.s, heightImg ? { heightFrom: "layer" } : {}, mapExtra, args.includes("--interval") ? { mapInterval: Number(opt("--interval")) } : {}, overrides());
  let t0 = Date.now();
  const F = Lines.prepare(small, heightImg, s, src.w, src.h);
  const tPrep = Date.now() - t0;
  t0 = Date.now();
  const px = renderTiled(F, s, TILE);
  let line = `${st.id.padEnd(10)} prepare ${tPrep}ms · render ${Date.now() - t0}ms`;
  // over white, like the layer above a white document
  const flat = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i += 4) { const a = px[i + 3] / 255; for (let c = 0; c < 3; c++) flat[i + c] = px[i + c] * a + 255 * (1 - a); flat[i + 3] = 255; }
  writePNG(path.join(outDir, st.id + ".png"), src.w, src.h, flat);
  const pv = Lines.render(F, s, { x: 0, y: 0, w: src.w, h: src.h }, 0.3, atlas), pw = Math.round(src.w * 0.3), ph = Math.round(src.h * 0.3);
  writePNG(path.join(outDir, st.id + "_preview.png"), pw, ph, pv);
  if (args.includes("--check")) {
    const one = renderTiled(F, s, Math.max(src.w, src.h));
    let worst = 0;
    for (let i = 0; i < px.length; i++) worst = Math.max(worst, Math.abs(px[i] - one[i]));
    line += ` · max tile difference ${worst.toFixed(1)}`;
  }
  console.log(line);
}
})();
