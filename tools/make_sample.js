// Writes test/sample.png: a 512 × 512 test image drawn from code (sky gradient, sun, hills, rings, stripes),
// with smooth gradients, hard edges, fine detail and strong colours for exercising the engines.
//   node tools/make_sample.js
const path = require("path");
const { writePNG } = require("./test_engine.js");

const W = 512, H = 512, d = new Uint8Array(W * H * 4);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  // sky: deep blue to warm orange
  let c = mix([18, 32, 92], [250, 150, 70], y / H);
  // sun with a soft halo
  const ds = Math.hypot(x - 340, y - 190);
  c = mix(c, [255, 236, 170], smooth(90, 20, ds) * 0.6);
  c = mix(c, [255, 248, 220], smooth(62, 58, ds));
  // concentric rings, top left
  const dr = Math.hypot(x - 120, y - 130);
  if (dr < 95) c = mix(c, (Math.floor(dr / 9) & 1) ? [230, 60, 120] : [40, 200, 210], smooth(95, 92, dr));
  // two layers of hills
  const h1 = 330 + 40 * Math.sin(x / 60) + 18 * Math.sin(x / 17 + 1), h2 = 400 + 30 * Math.sin(x / 45 + 2) + 10 * Math.sin(x / 9);
  if (y > h1) c = mix(c, mix([70, 120, 60], [30, 70, 40], (y - h1) / 120), smooth(h1, h1 + 1.5, y));
  if (y > h2) c = mix(c, [15, 30, 20], smooth(h2, h2 + 1.5, y));
  // fine diagonal stripes, bottom right
  if (x > 380 && y > 420 && ((x + y) % 12) < 5) c = mix(c, [240, 240, 240], 0.85);
  const o = (y * W + x) * 4;
  d[o] = Math.round(c[0]); d[o + 1] = Math.round(c[1]); d[o + 2] = Math.round(c[2]); d[o + 3] = 255;
}
const out = path.join(__dirname, "../test/sample.png");
writePNG(out, W, H, d);
console.log("wrote", out);
