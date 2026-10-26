// Node harness for the Map tab: loads a region's map features and renders every built-in style, tiled like the plugin.
//   node tools/test_map.js "<Google Maps link | lat, lon | place>" <outDir> [--km 3] [--size 2400x1600] [--style id] [--tile 1024] [--set k=v,…] [--check]
// --check also renders in one piece and reports the largest difference from the tiled render (seams).
const fs = require("fs"), path = require("path");
const MapHeights = require("../plugin/map.js"), Features = require("../plugin/features.js"), E = require("../plugin/engine.js");
const { writePNG } = require("./test_engine.js");
const atlas = E.prepareAtlas(JSON.parse(fs.readFileSync(path.join(__dirname, "../plugin/atlas.json"))), fs.readFileSync(path.join(__dirname, "../plugin/atlas.bin")));

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const outDir = args[1], [W, H] = opt("--size", "2400x1600").split("x").map(Number), TILE = Number(opt("--tile", 1024)), only = opt("--style", null);
fs.mkdirSync(outDir, { recursive: true });
function overrides() {
  const o = {};
  for (const kv of String(opt("--set", "")).split(",").filter(Boolean)) { const [k, v] = kv.split("="); o[k] = v === "true" ? true : v === "false" ? false : isNaN(+v) ? v : +v; }
  return o;
}
function renderTiled(P, s, tile) {
  const full = new Uint8ClampedArray(W * H * 4);
  for (let ty = 0; ty < H; ty += tile) for (let tx = 0; tx < W; tx += tile) {
    const tw = Math.min(tile, W - tx), th = Math.min(tile, H - ty), px = Features.render(P, s, { x: tx, y: ty, w: tw, h: th }, 1, null, atlas);
    for (let y = 0; y < th; y++) full.set(px.subarray(y * tw * 4, (y + 1) * tw * 4), ((ty + y) * W + tx) * 4);
  }
  return full;
}
(async () => {
  let at = MapHeights.parseLocation(args[0]);
  if (at.query) at = await MapHeights.geocode(at.query, fetch);
  const km = Number(opt("--km", at.widthKm || 3));
  let t0 = Date.now();
  const data = await MapHeights.loadFeatures({ lat: at.lat, lon: at.lon, widthKm: km, aspect: H / W, fetchFn: fetch });
  console.log(`${at.name || at.lat + ", " + at.lon} · ${km} km · zoom ${data.z} · ${data.tiles} tiles · ${data.features.length} features · ${Date.now() - t0} ms`);
  const P = Features.prepare(data, W, H);
  console.log("counts", JSON.stringify(Features.counts(P, Features.DEFAULTS)));
  for (const st of Features.STYLES) {
    if (only && st.id !== only) continue;
    const s = Object.assign({}, Features.DEFAULTS, st.s, overrides());
    t0 = Date.now();
    const px = renderTiled(P, s, TILE);
    let line = `${st.id.padEnd(10)} render ${Date.now() - t0}ms`;
    const flat = new Uint8Array(px.length);
    for (let i = 0; i < px.length; i += 4) { const a = px[i + 3] / 255; for (let c = 0; c < 3; c++) flat[i + c] = px[i + c] * a + 255 * (1 - a); flat[i + 3] = 255; }
    writePNG(path.join(outDir, st.id + ".png"), W, H, flat);
    if (args.includes("--check")) {
      const one = renderTiled(P, s, Math.max(W, H));
      let worst = 0;
      for (let i = 0; i < px.length; i++) worst = Math.max(worst, Math.abs(px[i] - one[i]));
      line += ` · max tile difference ${worst}`;
    }
    console.log(line);
  }
})().catch((e) => { console.error("ERR", e); process.exit(1); });
