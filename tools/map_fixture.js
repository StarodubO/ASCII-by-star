// Records the map servers' answers for the Photoshop map steps (TEST=map), which can't use the network.
//   node tools/map_fixture.js <dir>   (use the LOG_MIRROR folder) → <dir>/mapfix/index.json + one file per answer
// The area and sizes must match tools/map_steps.js.
const fs = require("fs"), path = require("path");
const MapHeights = require("../plugin/map.js");
const dir = path.join(process.argv[2], "mapfix"), index = {};
let count = 0;
fs.mkdirSync(dir, { recursive: true });
const record = async (url, opts) => {
  const name = count++ + ".bin", r = await fetch(url, opts), buf = Buffer.from(await r.arrayBuffer()); // (named before awaiting: loads run in parallel)
  fs.writeFileSync(path.join(dir, name), buf);
  index[url] = { status: r.status, file: name };
  return new Response(buf, { status: r.status });
};
(async () => {
  const lat = 50.4501, lon = 30.5234, km = 3, W = 1500, H = 1000; // the doc in map_steps.js
  const f = await MapHeights.loadFeatures({ lat, lon, widthKm: km, aspect: H / W, fetchFn: record });
  const t = await MapHeights.loadRegion({ lat, lon, widthKm: km, w: W, h: H, fetchFn: record });
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  console.log(`recorded ${Object.keys(index).length} answers (${f.features.length} features, terrain ${Math.round(t.min)}–${Math.round(t.max)} m) in ${dir}`);
})().catch((e) => { console.error(e); process.exit(1); });
