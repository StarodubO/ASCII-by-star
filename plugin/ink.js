// Ink bleed on paper. Pure JS, no Photoshop dependencies (runs in UXP and Node).
//
// The result is four overlay layers that sit above the source layer, so the source itself is never changed:
//   bleed   Multiply  ink that spread past the strokes: halo, ragged edges, tendrils wicking along fibres
//   pool    Multiply  darker rims where ink dried at the edge, pigment settling into the paper's valleys
//   gaps    Normal    the paper showing through the ink (what's under the layer): dry skip, mottling, pale centres
//   paper   Multiply  paper colour, grain, relief, fibres, laid lines, flecks
//
// Everything runs in "dark space" (dark ink on light paper). For light ink on dark paper the pixels are
// inverted on the way in and the outputs on the way out, which turns the Multiply layers into Screen and the
// other way round. Gaps are Normal: they show the real paper, whatever its colour.
//
// Sizes are pixels on a 3000 px long side and scale with the document, so a paper looks the same on any
// canvas. All randomness is hashed from world coordinates and the seed, so the preview, overlapping tiles
// and the applied layers agree.
"use strict";

const REF = 3000;

const SETTINGS_VERSION = 2; // bump when the look of the papers or the bleed changes; saved slider values are refreshed
const DEFAULTS = {
  version: SETTINGS_VERSION,
  paper: "newsprint",
  seed: 1,
  inkFrom: "auto", // auto | alpha | dark | light
  paperLayer: true,
  // ink
  wetness: 0.4, spread: 2.5, feather: 0.6, wicking: 0.4, halo: 0.8, softness: 0.15,
  pooling: 0.15, poolWidth: 3, granulation: 0, tooth: 0.15, mottle: 0.3,
  // paper
  paperColor: "#ece6d6", grainSize: 2, grain: 0.5, relief: 0.1,
  fibres: 0.7, fibreLength: 18, fibreShow: 0.35, alignment: 0.2, direction: 0,
  laid: 0, laidSpacing: 10, flecks: 0,
  // custom texture (an image file); "" = generated paper
  texture: "", textureName: "", texScale: 1, texStrength: 1, texColour: true,
};

// Paper types set every paper and ink setting (not the seed, ink source or paper layer switch).
const PAPERS = [
  { id: "newsprint", name: "Newsprint", s: {} },
  { id: "bond", name: "Office paper", s: { wetness: 0.3, spread: 1.5, feather: 0.3, wicking: 0.15, halo: 0.9, softness: 0.15, pooling: 0.1, poolWidth: 2, granulation: 0, tooth: 0, mottle: 0.08, paperColor: "#f7f5f0", grainSize: 1.5, grain: 0.3, relief: 0.05, fibres: 0.5, fibreLength: 20, fibreShow: 0.15, alignment: 0.3, direction: 0, laid: 0, laidSpacing: 10, flecks: 0 } },
  { id: "blotting", name: "Blotting paper", s: { wetness: 0.6, spread: 7, feather: 0.4, wicking: 0.5, halo: 0.45, softness: 0.45, pooling: 0.3, poolWidth: 4, granulation: 0, tooth: 0, mottle: 0.2, paperColor: "#f2efe9", grainSize: 3, grain: 0.4, relief: 0.1, fibres: 0.9, fibreLength: 25, fibreShow: 0.3, alignment: 0, direction: 0, laid: 0, laidSpacing: 10, flecks: 0 } },
  { id: "washi", name: "Washi / rice paper", s: { wetness: 0.5, spread: 4, feather: 0.7, wicking: 0.7, halo: 0.7, softness: 0.2, pooling: 0.25, poolWidth: 3, granulation: 0.1, tooth: 0.05, mottle: 0.2, paperColor: "#f3eee2", grainSize: 4, grain: 0.3, relief: 0.1, fibres: 0.45, fibreLength: 90, fibreShow: 0.7, alignment: 0.1, direction: 0, laid: 0, laidSpacing: 10, flecks: 0 } },
  { id: "laid", name: "Laid paper", s: { wetness: 0.35, spread: 3, feather: 0.6, wicking: 0.3, halo: 0.85, softness: 0.15, pooling: 0.2, poolWidth: 3, granulation: 0, tooth: 0.25, mottle: 0.15, paperColor: "#f1ead8", grainSize: 2, grain: 0.4, relief: 0.3, fibres: 0.4, fibreLength: 20, fibreShow: 0.25, alignment: 0.6, direction: 0, laid: 0.6, laidSpacing: 10, flecks: 0 } },
  { id: "watercolour", name: "Cold-press watercolour", s: { wetness: 0.6, spread: 6, feather: 0.5, wicking: 0.2, halo: 0.7, softness: 0.35, pooling: 0.6, poolWidth: 4, granulation: 0.5, tooth: 0.35, mottle: 0.3, paperColor: "#f8f6f0", grainSize: 9, grain: 0.5, relief: 0.55, fibres: 0.1, fibreLength: 25, fibreShow: 0.1, alignment: 0, direction: 0, laid: 0, laidSpacing: 10, flecks: 0 } },
  { id: "kraft", name: "Kraft / recycled", s: { wetness: 0.5, spread: 4, feather: 0.6, wicking: 0.5, halo: 0.8, softness: 0.2, pooling: 0.15, poolWidth: 3, granulation: 0, tooth: 0.2, mottle: 0.3, paperColor: "#c9a27a", grainSize: 2.5, grain: 0.65, relief: 0.15, fibres: 0.8, fibreLength: 22, fibreShow: 0.9, alignment: 0.3, direction: 0, laid: 0, laidSpacing: 10, flecks: 0 } },
  { id: "rough", name: "Rough print (dry ink)", s: { wetness: 0.15, spread: 1.5, feather: 0.4, wicking: 0.1, halo: 0.9, softness: 0.1, pooling: 0.4, poolWidth: 2, granulation: 0, tooth: 0.6, mottle: 0.35, paperColor: "#f5f1e8", grainSize: 3, grain: 0.5, relief: 0.3, fibres: 0.3, fibreLength: 20, fibreShow: 0.3, alignment: 0.2, direction: 0, laid: 0, laidSpacing: 10, flecks: 0 } },
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, v) => { const t = clamp01((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
function hexToRgb(hex) {
  let h = String(hex || "").replace(/[^0-9a-f]/gi, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return [0, 0, 0];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------- randomness ----------
function hashU(seed, x, y) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ x;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) ^ y;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return h >>> 0;
}
const hash = (seed, x, y) => hashU(seed, x, y) / 4294967296;
function rng(a) { // mulberry32
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Fractal gradient (Perlin) noise in [0,1], `wl` = base wavelength in reference px. Octaves finer than
// ~1.2 output px are replaced by their mean, so a zoomed-out preview averages the way the full-size render would.
const GRAD = new Float32Array(512);
for (let i = 0; i < 256; i++) { GRAD[i * 2] = Math.cos((i / 256) * Math.PI * 2); GRAD[i * 2 + 1] = Math.sin((i / 256) * Math.PI * 2); }
function fbm(w, h, ox, oy, sk, wl, octaves, seed) {
  const out = new Float32Array(w * h);
  let total = 0;
  for (let o = 0, amp = 1; o < octaves; o++, amp *= 0.5) {
    total += amp * amp;
    const px = (wl / (1 << o)) * sk;
    if (px < 1.2) continue; // mean is 0
    const inv = 1 / px, sd = seed * 131 + o * 1013;
    for (let y = 0; y < h; y++) {
      const gy = (y + oy + 0.5) * inv, iy = Math.floor(gy), fy = gy - iy, v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      let last = NaN, ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0, dx = 0, dy = 0;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const gx = (x + ox + 0.5) * inv, ix = Math.floor(gx), fx = gx - ix;
        if (ix !== last) {
          last = ix;
          let k = (hashU(sd, ix, iy) & 255) * 2; ax = GRAD[k]; ay = GRAD[k + 1];
          k = (hashU(sd, ix + 1, iy) & 255) * 2; bx = GRAD[k]; by = GRAD[k + 1];
          k = (hashU(sd, ix, iy + 1) & 255) * 2; cx = GRAD[k]; cy = GRAD[k + 1];
          k = (hashU(sd, ix + 1, iy + 1) & 255) * 2; dx = GRAD[k]; dy = GRAD[k + 1];
        }
        const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
        const n00 = ax * fx + ay * fy, n10 = bx * (fx - 1) + by * fy, n01 = cx * fx + cy * (fy - 1), n11 = dx * (fx - 1) + dy * (fy - 1);
        const t = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
        out[row + x] += amp * (t + (b - t) * v);
      }
    }
  }
  // scale to unit-ish spread around 0.5 and squash softly into [0,1] (no flat clipped plateaus)
  const k = 2.6 / Math.sqrt(total);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 + 0.5 * Math.tanh(out[i] * k);
  return out;
}

// ---------- blur ----------
function boxBlur(a, w, h, r, tmp) {
  if (r < 1) return;
  const inv = 1 / (2 * r + 1), xm = w - 1, ym = h - 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += a[row + (k < 0 ? 0 : k > xm ? xm : k)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      const ad = x + r + 1, sb = x - r;
      acc += a[row + (ad > xm ? xm : ad)] - a[row + (sb < 0 ? 0 : sb)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[(k < 0 ? 0 : k > ym ? ym : k) * w + x];
    for (let y = 0; y < h; y++) {
      a[y * w + x] = acc * inv;
      const ad = y + r + 1, sb = y - r;
      acc += tmp[(ad > ym ? ym : ad) * w + x] - tmp[(sb < 0 ? 0 : sb) * w + x];
    }
  }
}
function blur3(a, w, h, sigma) { // three box passes ≈ Gaussian
  const wIdeal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const mIdeal = (12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4), m = Math.round(mIdeal);
  const tmp = new Float32Array(w * h);
  for (let i = 0; i < 3; i++) boxBlur(a, w, h, ((i < m ? wl : wl + 2) - 1) >> 1, tmp);
}
// Gaussian blur of a buffer field. Wide blurs run on a grid shrunk by a power of two and aligned to world
// coordinates (ox, oy = world position of buffer pixel 0,0), so tiles that overlap compute the same values.
function gauss(src, w, h, ox, oy, sigma) {
  const out = new Float32Array(w * h);
  if (sigma < 0.4) { out.set(src); return out; }
  let f = 1;
  while (f < 64 && sigma / (f * 2) >= 2) f *= 2;
  if (f === 1) { out.set(src); blur3(out, w, h, sigma); return out; }
  const bx0 = Math.floor(ox / f), by0 = Math.floor(oy / f);
  const lw = Math.floor((ox + w - 1) / f) - bx0 + 1, lh = Math.floor((oy + h - 1) / f) - by0 + 1;
  const low = new Float32Array(lw * lh), cnt = new Float32Array(lw * lh);
  const lxOf = new Int32Array(w);
  for (let x = 0; x < w; x++) lxOf[x] = Math.floor((x + ox) / f) - bx0;
  for (let y = 0; y < h; y++) {
    const lr = (Math.floor((y + oy) / f) - by0) * lw, row = y * w;
    for (let x = 0; x < w; x++) { low[lr + lxOf[x]] += src[row + x]; cnt[lr + lxOf[x]]++; }
  }
  for (let i = 0; i < low.length; i++) low[i] /= cnt[i];
  blur3(low, lw, lh, sigma / f);
  // bilinear back up; low cell centres sit at world (i*f + (f-1)/2)
  const x0 = new Int32Array(w), x1 = new Int32Array(w), fxs = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const u = (x + ox - (f - 1) / 2) / f - bx0, i = Math.floor(u);
    x0[x] = Math.max(0, Math.min(lw - 1, i)); x1[x] = Math.max(0, Math.min(lw - 1, i + 1)); fxs[x] = u - i;
  }
  for (let y = 0; y < h; y++) {
    const u = (y + oy - (f - 1) / 2) / f - by0, i = Math.floor(u), fy = u - i;
    const r0 = Math.max(0, Math.min(lh - 1, i)) * lw, r1 = Math.max(0, Math.min(lh - 1, i + 1)) * lw, row = y * w;
    for (let x = 0; x < w; x++) {
      const a = low[r0 + x0[x]], b = low[r0 + x1[x]], c = low[r1 + x0[x]], d = low[r1 + x1[x]], fx = fxs[x];
      out[row + x] = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    }
  }
  return out;
}

// ---------- fibres & flecks ----------
// Fibres are generated per world cell, so any region regenerates exactly the fibres that reach it.
// Each fibre is a gently curving strand, returned as points in buffer pixels.
function makeFibres(s, sk, ox, oy, w, h) {
  const L = Math.max(4, s.fibreLength), cs = Math.max(8, L), reach = L * 0.75 + 2;
  const lam = s.fibres * 0.35 * cs * cs / L, dir = (s.direction * Math.PI) / 180, spreadA = Math.PI * (1 - s.alignment);
  const step = Math.min(1, 0.7 / sk); // reference px between points: at most ~0.7 output px
  const wx0 = ox / sk - reach, wy0 = oy / sk - reach, wx1 = (ox + w) / sk + reach, wy1 = (oy + h) / sk + reach;
  const out = [];
  for (let cy = Math.floor(wy0 / cs); cy <= Math.floor(wy1 / cs); cy++) {
    for (let cx = Math.floor(wx0 / cs); cx <= Math.floor(wx1 / cs); cx++) {
      const r = rng(hashU(s.seed * 7 + 3, cx, cy));
      const n = Math.floor(lam + r());
      for (let j = 0; j < n; j++) {
        const mx = (cx + r()) * cs, my = (cy + r()) * cs, len = L * (0.5 + r()), wid = 0.5 + 0.9 * r();
        const wet = r(), th0 = dir + (r() - 0.5) * spreadA, bend = (r() - 0.5) * (2.4 / len), wob = (r() - 0.5) * 0.5, wf = (6 + r() * 10) / len, ph = r() * 6.283;
        const np = Math.max(2, Math.ceil(len / step) + 1), ds = len / (np - 1), pts = new Float64Array(np * 2);
        // walk from the centre outwards in both directions so the strand is centred on its cell point
        const half = (np - 1) >> 1;
        for (const sgn of [1, -1]) {
          let x = mx, y = my;
          for (let k = 0; sgn > 0 ? half + k < np : half - k >= 0; k++) {
            const idx = sgn > 0 ? half + k : half - k;
            if (k > 0) {
              const t = (sgn * (k - 0.5) * ds), th = th0 + bend * t + wob * Math.sin(t * wf + ph);
              x += sgn * Math.cos(th) * ds; y += sgn * Math.sin(th) * ds;
            }
            pts[idx * 2] = x * sk - ox; pts[idx * 2 + 1] = y * sk - oy;
          }
        }
        // skip strands that miss the buffer
        let inside = false;
        for (let k = 0; k < np && !inside; k += 4) { const px = pts[k * 2], py = pts[k * 2 + 1]; inside = px > -2 && py > -2 && px < w + 2 && py < h + 2; }
        if (inside) out.push({ pts, rad: (wid * sk) / 2, step, wet });
      }
    }
  }
  return out;
}
// Writes max(existing, v * coverage) of a soft dot into a field.
function splat(a, w, h, px, py, rad, v) {
  if (rad < 0.75) { // thinner than a pixel: bilinear, fainter as it gets thinner
    const x = px - 0.5, y = py - 0.5, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, vv = v * Math.min(1, rad * 2.2);
    const put = (X, Y, wt) => { if (X >= 0 && Y >= 0 && X < w && Y < h) { const i = Y * w + X, q = vv * wt; if (q > a[i]) a[i] = q; } };
    put(ix, iy, (1 - fx) * (1 - fy)); put(ix + 1, iy, fx * (1 - fy)); put(ix, iy + 1, (1 - fx) * fy); put(ix + 1, iy + 1, fx * fy);
    return;
  }
  const x0 = Math.max(0, Math.floor(px - rad - 0.5)), x1 = Math.min(w - 1, Math.ceil(px + rad + 0.5));
  const y0 = Math.max(0, Math.floor(py - rad - 0.5)), y1 = Math.min(h - 1, Math.ceil(py + rad + 0.5));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x + 0.5 - px, y + 0.5 - py), q = v * clamp01(rad + 0.5 - d);
    if (q > a[y * w + x]) a[y * w + x] = q;
  }
}
// The paper's visible fibres: a dense felt of short, soft strands, some lighter and some darker than the paper
// (real paper is not a web of dark threads). Returns presence fields for light (P) and dark (N) strands.
function felt(s, sk, ox, oy, w, h) {
  const P = new Float32Array(w * h), N = new Float32Array(w * h), cs = 8, L = Math.max(4, s.fibreLength);
  const per = s.fibres * 5, step = Math.min(1, 0.7 / sk), dir = (s.direction * Math.PI) / 180, spreadA = Math.PI * (1 - s.alignment), reach = L * 0.6 + 2;
  for (let cy = Math.floor((oy / sk - reach) / cs); cy <= Math.floor(((oy + h) / sk + reach) / cs); cy++) {
    for (let cx = Math.floor((ox / sk - reach) / cs); cx <= Math.floor(((ox + w) / sk + reach) / cs); cx++) {
      const r = rng(hashU(s.seed * 13 + 5, cx, cy)), n = Math.floor(per + r());
      for (let j = 0; j < n; j++) {
        const mx = (cx + r()) * cs, my = (cy + r()) * cs, len = L * (0.12 + 0.45 * r()), wid = 0.5 + 1.1 * r(), amp = 0.35 + 0.65 * r(), into = r() < 0.55 ? P : N;
        let th = dir + (r() - 0.5) * spreadA;
        const bend = ((r() - 0.5) * 0.5) / len, np = Math.max(2, Math.ceil(len / step));
        let x = mx - (Math.cos(th) * len) / 2, y = my - (Math.sin(th) * len) / 2;
        for (let k = 0; k <= np; k++) {
          splat(into, w, h, x * sk - ox, y * sk - oy, (wid * sk) / 2, amp);
          th += bend * (len / np); x += Math.cos(th) * (len / np); y += Math.sin(th) * (len / np);
        }
      }
    }
  }
  return { P, N };
}
// Ink travelling through paper: every ink pixel starts with fuel (how far its ink can run) and each step costs
// fuel by how hard the paper is to cross there: fibres are cheap, dense spots dear. Raster sweeps in both
// directions keep the best fuel left at each pixel (a geodesic distance transform), giving branching,
// fibre-following edges instead of a smooth halo.
function propagateFuel(f, cost, w, h, rounds) {
  const D = Math.SQRT1_2; // half of √2: diagonal steps average the two costs over a longer step
  for (let r = 0; r < rounds; r++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, c = cost[i];
      let v = f[i];
      if (x > 0) v = Math.max(v, f[i - 1] - (c + cost[i - 1]) * 0.5);
      if (y > 0) {
        const j = i - w;
        v = Math.max(v, f[j] - (c + cost[j]) * 0.5);
        if (x > 0) v = Math.max(v, f[j - 1] - (c + cost[j - 1]) * D);
        if (x < w - 1) v = Math.max(v, f[j + 1] - (c + cost[j + 1]) * D);
      }
      f[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x, c = cost[i];
      let v = f[i];
      if (x < w - 1) v = Math.max(v, f[i + 1] - (c + cost[i + 1]) * 0.5);
      if (y < h - 1) {
        const j = i + w;
        v = Math.max(v, f[j] - (c + cost[j]) * 0.5);
        if (x < w - 1) v = Math.max(v, f[j + 1] - (c + cost[j + 1]) * D);
        if (x > 0) v = Math.max(v, f[j - 1] - (c + cost[j - 1]) * D);
      }
      f[i] = v;
    }
  }
}
// How far ink can run from a heavy stroke, in reference px (fibres stretch it up to 5×).
const inkReach = (s) => Math.max(0.5, s.spread * (0.3 + 1.6 * s.wetness));

function flecks(s, sk, ox, oy, w, h) {
  const K = new Float32Array(w * h), cs = 10, p = s.flecks * 0.3;
  for (let cy = Math.floor(oy / sk / cs) - 1; cy <= Math.floor((oy + h) / sk / cs) + 1; cy++) {
    for (let cx = Math.floor(ox / sk / cs) - 1; cx <= Math.floor((ox + w) / sk / cs) + 1; cx++) {
      const r = rng(hashU(s.seed * 5 + 17, cx, cy));
      if (r() >= p) continue;
      const x = (cx + r()) * cs * sk - ox, y = (cy + r()) * cs * sk - oy, rad = (0.4 + 1.6 * r() * r()) * sk, dark = 0.25 + 0.5 * r();
      splat(K, w, h, x, y, rad, dark);
    }
  }
  return K;
}

// ---------- custom paper textures ----------
// A scanned paper (any image) can replace the generated paper. It becomes the paper layer, and its high-passed
// luminance stands in for the generated grain: ink skips its peaks and pools in its dips.
function prepareTexture(rgba, w, h) {
  const n = w * h, rgb = new Uint8Array(n * 3), L = new Float32Array(n);
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    L[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    mr += r; mg += g; mb += b;
  }
  const mean = [mr / n / 255, mg / n / 255, mb / n / 255], meanL = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2];
  // high-pass first, so uneven lighting in the scan doesn't count as paper structure
  const low = gauss(L, w, h, 0, 0, Math.max(w, h) / 60);
  let v = 0;
  for (let i = 0; i < n; i++) { L[i] -= low[i]; v += L[i] * L[i]; }
  const k = 1 / (3 * Math.sqrt(v / n) + 1e-6), H = new Float32Array(n);
  for (let i = 0; i < n; i++) H[i] = clamp01(0.5 + L[i] * k);
  const levels = [{ w, h, rgb, H }];
  for (let lv = levels[0]; Math.min(lv.w, lv.h) >= 64; lv = levels[levels.length - 1]) {
    const nw = lv.w >> 1, nh = lv.h >> 1, nr = new Uint8Array(nw * nh * 3), nH = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const a = (2 * y * lv.w + 2 * x), b = a + lv.w, o = y * nw + x;
      nH[o] = (lv.H[a] + lv.H[a + 1] + lv.H[b] + lv.H[b + 1]) / 4;
      for (let c = 0; c < 3; c++) nr[o * 3 + c] = (lv.rgb[a * 3 + c] + lv.rgb[a * 3 + 3 + c] + lv.rgb[b * 3 + c] + lv.rgb[b * 3 + 3 + c] + 2) >> 2;
    }
    levels.push({ w: nw, h: nh, rgb: nr, H: nH });
  }
  // dark textures (noise and dust overlays) are meant to be screened on, light ones (papers) multiplied
  return { w, h, levels, mean, meanL, screen: meanL < 0.45 };
}
// Where a texture sits on a document: at scale 1 it just covers the canvas; smaller scales repeat it (mirrored,
// so there are no seams). It turns 90° when its orientation differs from the document's.
function placeTexture(tex, docW, docH, scale) {
  const long = Math.max(docW, docH), dw = (docW / long) * REF, dh = (docH / long) * REF;
  const rot = tex.w !== tex.h && docW !== docH && (tex.w > tex.h) !== (docW > docH);
  const tw = rot ? tex.h : tex.w, th = rot ? tex.w : tex.h;
  return { rot, k: Math.min(tw / dw, th / dh) / Math.max(0.05, scale) }; // texture px per reference px
}
// Texture height (and colour, 0..1) over buffer pixels [x0, x0 + w) × [y0, y0 + h), from the mip level that
// matches the output resolution. Positions are world-based, so tiles and previews agree.
function sampleTexture(tex, place, sk, ox, oy, x0, y0, w, h, wantRGB) {
  const foot = place.k / sk;
  let li = 0;
  while (li < tex.levels.length - 1 && foot / (1 << li) > 1.4) li++;
  const lv = tex.levels[li], f = place.k / (1 << li), TW = lv.w, TH = lv.h;
  const mir = (i, N) => { i %= 2 * N; if (i < 0) i += 2 * N; return i < N ? i : 2 * N - 1 - i; };
  const axis = (len, off, N) => {
    const i0 = new Int32Array(len), i1 = new Int32Array(len), fr = new Float32Array(len);
    for (let t = 0; t < len; t++) { const u = ((t + off + 0.5) / sk) * f - 0.5, i = Math.floor(u); i0[t] = mir(i, N); i1[t] = mir(i + 1, N); fr[t] = u - i; }
    return [i0, i1, fr];
  };
  const [c0s, c1s, cfs] = place.rot ? axis(h, oy + y0, TW) : axis(w, ox + x0, TW); // texture columns
  const [r0s, r1s, rfs] = place.rot ? axis(w, ox + x0, TH) : axis(h, oy + y0, TH); // texture rows
  const H = new Float32Array(w * h), rgb = wantRGB ? new Float32Array(w * h * 3) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ci = place.rot ? y : x, ri = place.rot ? x : y, fx = cfs[ci], fy = rfs[ri];
    const p00 = r0s[ri] * TW + c0s[ci], p10 = r0s[ri] * TW + c1s[ci], p01 = r1s[ri] * TW + c0s[ci], p11 = r1s[ri] * TW + c1s[ci];
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy, i = y * w + x;
    H[i] = lv.H[p00] * w00 + lv.H[p10] * w10 + lv.H[p01] * w01 + lv.H[p11] * w11;
    if (rgb) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = (lv.rgb[p00 * 3 + c] * w00 + lv.rgb[p10 * 3 + c] * w10 + lv.rgb[p01 * 3 + c] * w01 + lv.rgb[p11 * 3 + c] * w11) / 255;
  }
  return { H, rgb };
}
// The paper layer multiplies onto light paper and screens onto dark paper. A texture whose brightness doesn't
// match (a dark noise scan under dark ink, a light paper scan under light ink) is used inverted.
const paperMode = (det) => (det.light ? "screen" : "multiply");
const texInverted = (det, tex) => !!tex && tex.screen !== det.light;

// ---------- analysis ----------
// Decides what counts as ink. `inkFrom`: auto | alpha (layer opacity) | dark (dark pixels) | light (light pixels).
// Returns { from: "alpha" | "tone", light, ink: mean ink colour in dark space, label }.
function detect(rgba, inkFrom) {
  const n = rgba.length >> 2;
  let transp = 0, aSum = 0, lA = 0, lAll = 0;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const a = rgba[o + 3] / 255, L = (0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]) / 255;
    if (a < 0.98) transp++;
    aSum += a; lA += a * L; lAll += L;
  }
  let from, light;
  if (inkFrom === "alpha" || (inkFrom === "auto" && transp > n * 0.02)) { from = "alpha"; light = aSum > 0 && lA / aSum > 0.55; }
  else if (inkFrom === "light") { from = "tone"; light = true; }
  else if (inkFrom === "dark") { from = "tone"; light = false; }
  else { from = "tone"; light = lAll / Math.max(1, n) < 0.45; }
  const det = { from, light, ink: [0, 0, 0], paper: [1, 1, 1] };
  if (from === "tone") det.paper = paperTone(rgba, light);
  let mS = 0, r = 0, g = 0, b = 0;
  for (let o = 0; o < rgba.length; o += 4) {
    const px = inkPixel(rgba, o, det);
    if (!px) continue;
    mS += px[0]; r += px[1]; g += px[2]; b += px[3];
  }
  if (mS > 0) det.ink = [r / mS, g / mS, b / mS];
  det.label = (light ? "light ink on dark" : "dark ink on light") + (from === "alpha" ? ", from layer opacity" : light ? ", from light pixels" : ", from dark pixels");
  return det;
}
// The source's own paper colour (dark space): the most common colour among its lightest quarter.
function paperTone(rgba, light) {
  const n = rgba.length >> 2, stride = Math.max(1, Math.floor(n / 200000)), Ls = [];
  const px = (o, c) => (light ? 255 - rgba[o + c] : rgba[o + c]);
  for (let i = 0; i < n; i += stride) { const o = i * 4; if (rgba[o + 3] > 250) Ls.push(0.2126 * px(o, 0) + 0.7152 * px(o, 1) + 0.0722 * px(o, 2)); }
  if (!Ls.length) return [1, 1, 1];
  const cut = Float64Array.from(Ls).sort()[Math.floor(Ls.length * 0.75)];
  const bins = new Map();
  for (let i = 0; i < n; i += stride) {
    const o = i * 4;
    if (rgba[o + 3] <= 250) continue;
    const r = px(o, 0), g = px(o, 1), b = px(o, 2);
    if (0.2126 * r + 0.7152 * g + 0.0722 * b < cut) continue;
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4), e = bins.get(k) || [0, 0, 0, 0];
    e[0]++; e[1] += r; e[2] += g; e[3] += b; bins.set(k, e);
  }
  let best = null;
  for (const e of bins.values()) if (!best || e[0] > best[0]) best = e;
  return [best[1], best[2], best[3]].map((v) => Math.max(0.05, v / best[0] / 255));
}

// [m, m*r, m*g, m*b] in dark space for one pixel, or null when there is no ink.
// Tone mode splits a pixel into ink over the source's paper: pixel = paper * (1 - m + m * colour),
// taking the most saturated colour that explains it.
function inkPixel(d, o, det) {
  const a = d[o + 3] / 255;
  if (a <= 0) return null;
  let r = d[o] / 255, g = d[o + 1] / 255, b = d[o + 2] / 255;
  if (det.light) { r = 1 - r; g = 1 - g; b = 1 - b; }
  if (det.from === "alpha") return [a, a * r, a * g, a * b];
  const pp = det.paper;
  r = Math.min(1, r / pp[0]); g = Math.min(1, g / pp[1]); b = Math.min(1, b / pp[2]);
  const mn = Math.min(r, g, b), m = a * (1 - mn);
  if (m <= 0) return null;
  const k = a / (1 - mn);
  return [m, (r - mn) * k, (g - mn) * k, (b - mn) * k];
}

// Extra source pixels needed around a region, in output px (rounded to 64 for blur alignment).
function margin(s, sk) {
  const ref = 5 * inkReach(s) + 1.5 * Math.max(4, s.fibreLength) + 3 * s.poolWidth + 6;
  return Math.ceil((ref * sk) / 64) * 64;
}

// ---------- the effect ----------
// src: {w, h, data RGBA8} source pixels; buffer pixel (0,0) sits at world output px (ox, oy).
// inner: {x, y, w, h} part of the buffer to produce (the rest is margin). sk: output px per reference px.
// paper: optional custom texture {tex (from prepareTexture), place (from placeTexture)}.
// under: optional RGBA8 of the inner region with the source hidden, i.e. the paper the gaps should reveal;
// without it, gaps use the detected paper colour (white, or black for light ink, when unknown).
// Returns RGBA8 layers {bleed, pool, gaps, paper} for the inner region (paper is null when switched off).
function process(src, ox, oy, inner, sk, s, det, paper, under) {
  const w = src.w, h = src.h, n = w * h, d = src.data, light = det.light;
  const m = new Float32Array(n), pr = new Float32Array(n), pg = new Float32Array(n), pb = new Float32Array(n);
  let any = false;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const px = inkPixel(d, o, det);
    if (!px) continue;
    m[i] = px[0]; pr[i] = px[1]; pg[i] = px[2]; pb[i] = px[3];
    if (px[0] > 0.02) any = true;
  }
  const seed = s.seed | 0;

  // paper surface
  const fib = s.fibres > 0 ? makeFibres(s, sk, ox, oy, w, h) : [];
  const F = new Float32Array(n);
  for (const f of fib) for (let k = 0; k < f.pts.length; k += 2) splat(F, w, h, f.pts[k], f.pts[k + 1], f.rad, 1);
  const FT = s.fibres > 0 ? felt(s, sk, ox, oy, w, h) : null;
  const tex = paper && paper.tex, inv = texInverted(det, tex);
  const H = tex ? sampleTexture(tex, paper.place, sk, ox, oy, 0, 0, w, h, false).H : fbm(w, h, ox, oy, sk, Math.max(0.5, s.grainSize), 4, seed);
  if (inv) for (let i = 0; i < n; i++) H[i] = 1 - H[i]; // lighter areas of the paper as shown are its peaks
  const ls = Math.max(2, s.laidSpacing), laidOn = !tex && s.laid > 0 && ls * sk >= 2;
  const LINE = laidOn ? new Float32Array(n) : null;
  if (laidOn) {
    const fadeL = smooth(2, 4, ls * sk), cw = ls * 24, fadeC = smooth(1, 3, ls * 0.7 * sk);
    for (let y = 0; y < h; y++) {
      const Y = (y + oy + 0.5) / sk, line = Math.pow(0.5 + 0.5 * Math.cos((2 * Math.PI * Y) / ls), 3) * fadeL;
      for (let x = 0; x < w; x++) {
        const X = (x + ox + 0.5) / sk, dx = (((X % cw) + cw) % cw) - cw / 2, chain = Math.exp(-((dx / (ls * 0.35)) ** 2)) * fadeC;
        const i = y * w + x;
        LINE[i] = Math.max(line, chain * 0.8);
        H[i] = clamp01(H[i] * (1 - 0.45 * s.laid) + s.laid * (0.45 * line + 0.3 * chain));
      }
    }
  }
  if (!tex) for (let i = 0; i < n; i++) if (F[i] > 0) H[i] = Math.min(1, H[i] + 0.15 * F[i]);

  const iw = inner.w, ih = inner.h;
  const out = { w: iw, h: ih, light, any, paperMode: paperMode(det), bleed: new Uint8ClampedArray(iw * ih * 4), pool: new Uint8ClampedArray(iw * ih * 4), gaps: new Uint8ClampedArray(iw * ih * 4), paper: null };
  const put = (buf, o, r, g, b, a) => {
    if (light) { r = 1 - r; g = 1 - g; b = 1 - b; }
    buf[o] = r * 255 + 0.5; buf[o + 1] = g * 255 + 0.5; buf[o + 2] = b * 255 + 0.5; buf[o + 3] = a * 255 + 0.5;
  };

  if (any) {
    // how far the ink travels: fuel from the strokes (thin strokes carry less ink), spent crossing the paper
    const fe = s.feather, reachPx = inkReach(s) * sk;
    const N2 = fbm(w, h, ox, oy, sk, Math.max(1.5, s.spread * 0.8), 4, seed + 11);
    const mass = gauss(m, w, h, ox, oy, Math.max(0.6, s.spread * 0.8 * sk));
    const cost = new Float32Array(n), fuel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const fib = FT ? Math.min(1, FT.P[i] + FT.N[i]) : 0;
      const ease = fe * (2.4 * (N2[i] - 0.5) + 1.3 * fib - 1.4 * (H[i] - 0.5)) + 2.5 * s.wicking * F[i];
      cost[i] = Math.min(6, Math.max(0.2, Math.exp(-ease)));
      fuel[i] = m[i] > 0.35 ? reachPx * (0.35 + 0.65 * clamp01(mass[i] * 1.6)) * m[i] : -1e6;
    }
    if (reachPx > 0.3) propagateFuel(fuel, cost, w, h, 2);
    // ink density after bleeding (D): solid where plenty of fuel was left, paler and softer towards the tips
    const soft = 0.6 + s.softness * reachPx * 0.45, D = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const f = fuel[i], sp = f > -soft ? smooth(-0.3 * soft, soft, f) : 0;
      D[i] = Math.max(m[i], s.halo * sp * (0.3 + 0.7 * Math.pow(clamp01(f / (0.8 * reachPx + 1e-3)), 0.7)));
    }
    const B2 = gauss(D, w, h, ox, oy, s.poolWidth * sk);
    const cS = Math.max(s.spread, s.fibreLength * 0.6, 3) * sk;
    const Wc = gauss(m, w, h, ox, oy, cS), Rc = gauss(pr, w, h, ox, oy, cS), Gc = gauss(pg, w, h, ox, oy, cS), Bc = gauss(pb, w, h, ox, oy, cS);
    const Mn = s.mottle > 0 ? fbm(w, h, ox, oy, sk, 40, 3, seed + 23) : null;
    const thr = 0.9 - 0.5 * s.tooth, toothAmt = Math.min(1, s.tooth * 4);
    // gaps fall back to the paper colour found in the source (tone mode), else white / black
    const gapRGB = (det.from === "tone" ? det.paper.map((v) => (light ? 1 - v : v)) : light ? [0, 0, 0] : [1, 1, 1]).map((v) => Math.round(v * 255));
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        const i = (y + inner.y) * w + x + inner.x, o = (y * iw + x) * 4, Di = D[i];
        if (Di < 0.003) continue;
        const mi = m[i];
        let cr, cg, cb;
        const wc = Wc[i];
        if (wc > 1e-4) { cr = Rc[i] / wc; cg = Gc[i] / wc; cb = Bc[i] / wc; } else [cr, cg, cb] = det.ink;
        // bleed: the extra density on top of what the source already has
        const a = mi < 0.996 ? clamp01((Di - mi) / (1 - mi)) : 0;
        if (a > 0.002) put(out.bleed, o, cr, cg, cb, a);
        // pooling: dark rim inside the ink edge, pigment settling in the paper's valleys
        const E = clamp01((Di - B2[i]) * 3), valley = clamp01((0.5 - H[i]) * 3);
        const pa = clamp01(s.pooling * E * 1.3 + s.granulation * valley * 0.8) * Di;
        if (pa > 0.002) {
          if (mi > 0.3) { cr = pr[i] / mi; cg = pg[i] / mi; cb = pb[i] / mi; }
          put(out.pool, o, cr, cg, cb, pa);
        }
        // gaps: the paper's peaks stay dry, density varies, centres pale where ink pooled to the rim
        const peak = smooth(thr - 0.06, thr + 0.06, H[i]) * toothAmt, mot = Mn ? clamp01((Mn[i] - 0.5) * 3 + 0.5) : 0;
        const ga = Di * clamp01(peak * 0.95 + s.mottle * 0.55 * mot + s.pooling * 0.3) * (1 - clamp01(E * s.pooling * 3)) * (1 - 0.6 * s.granulation * valley);
        if (ga > 0.002) {
          const gp = out.gaps;
          if (under && under[o + 3] > 0) { gp[o] = under[o]; gp[o + 1] = under[o + 1]; gp[o + 2] = under[o + 2]; }
          else { gp[o] = gapRGB[0]; gp[o + 1] = gapRGB[1]; gp[o + 2] = gapRGB[2]; }
          gp[o + 3] = ga * 255 + 0.5;
        }
      }
    }
  }

  if (s.paperLayer && tex) {
    // the texture itself (inverted when needed), its contrast scaled around its mean; "own colour" off makes it
    // neutral grey that leaves the average untouched (white for Multiply, black for Screen)
    const pl = (out.paper = new Uint8ClampedArray(iw * ih * 4)), { rgb } = sampleTexture(tex, paper.place, sk, ox, oy, inner.x, inner.y, iw, ih, true);
    if (inv) for (let i = 0; i < rgb.length; i++) rgb[i] = 1 - rgb[i];
    const mean = inv ? tex.mean.map((v) => 1 - v) : tex.mean, meanL = inv ? 1 - tex.meanL : tex.meanL, st = s.texStrength;
    for (let i = 0, o = 0; i < iw * ih; i++, o += 4) {
      let r = mean[0] + (rgb[i * 3] - mean[0]) * st, g = mean[1] + (rgb[i * 3 + 1] - mean[1]) * st, b = mean[2] + (rgb[i * 3 + 2] - mean[2]) * st;
      if (!s.texColour) {
        const Lm = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = g = b = light ? (Lm - meanL) / (1 - meanL) : Lm / meanL;
      }
      pl[o] = clamp01(r) * 255 + 0.5; pl[o + 1] = clamp01(g) * 255 + 0.5; pl[o + 2] = clamp01(b) * 255 + 0.5; pl[o + 3] = 255;
    }
  } else if (s.paperLayer) {
    const paper = (out.paper = new Uint8ClampedArray(iw * ih * 4));
    const K = s.flecks > 0 ? flecks(s, sk, ox, oy, w, h) : null;
    const tint = light ? [1, 1, 1] : hexToRgb(s.paperColor).map((v) => v / 255);
    const rk = 0.4 * Math.min(4, Math.max(1, s.grainSize)) * sk;
    // formation (the cloudy unevenness of paper) and fine pulp speckle, both centred on the paper colour
    const form = fbm(w, h, ox, oy, sk, Math.max(6, s.grainSize * 10), 3, seed + 31), speck = fbm(w, h, ox, oy, sk, Math.max(0.6, s.grainSize * 0.6), 2, seed + 37);
    for (let y = 0; y < ih; y++) {
      const by = y + inner.y, yu = (by > 0 ? by - 1 : 0) * w, yd = (by < h - 1 ? by + 1 : h - 1) * w;
      for (let x = 0; x < iw; x++) {
        const bx = x + inner.x, i = by * w + bx, o = (y * iw + x) * 4;
        // relief: light from the top left
        const gx = H[by * w + (bx < w - 1 ? bx + 1 : bx)] - H[by * w + (bx > 0 ? bx - 1 : 0)], gy = H[yd + bx] - H[yu + bx];
        const shade = clamp01(0.5 - (gx + gy) * 0.707 * rk);
        let t = 1 + s.grain * (0.1 * (form[i] - 0.5) + 0.14 * (speck[i] - 0.5)) - s.relief * 0.3 * (shade - 0.5);
        if (FT) t += s.fibreShow * 0.25 * (FT.P[i] - FT.N[i]);
        if (LINE) t *= 1 - s.laid * 0.05 * LINE[i];
        if (K) t *= 1 - K[i];
        put(paper, o, clamp01(tint[0] * t), clamp01(tint[1] * t), clamp01(tint[2] * t), 1);
      }
    }
  }
  return out;
}

// Blend modes of the four layers, bottom to top, as Photoshop applies them.
const layerModes = (L) => ({ bleed: L.light ? "screen" : "multiply", pool: L.light ? "screen" : "multiply", gaps: "normal", paper: L.paperMode });
// Preview: applies the layers to the visible image (`bg`, RGBA8 of the same region) like Photoshop would.
function composite(bg, L) {
  const n = L.w * L.h, rgb = new Uint8Array(n * 3), modes = layerModes(L);
  const layers = ["bleed", "pool", "gaps", "paper"].filter((k) => L[k]).map((k) => [L[k], modes[k]]);
  for (let i = 0; i < n; i++) {
    const o = i * 4, a0 = bg[o + 3] / 255;
    for (let c = 0; c < 3; c++) {
      let v = (bg[o + c] / 255) * a0 + (L.light ? 0 : 1 - a0); // empty canvas shows as white (black for light ink)
      for (const [buf, mode] of layers) {
        const a = buf[o + 3] / 255;
        if (!a) continue;
        const lc = buf[o + c] / 255;
        v = mode === "screen" ? v + a * lc * (1 - v) : mode === "normal" ? v + (lc - v) * a : v * (1 - a + a * lc);
      }
      rgb[i * 3 + c] = v * 255 + 0.5;
    }
  }
  return rgb;
}

const Ink = { REF, SETTINGS_VERSION, DEFAULTS, PAPERS, detect, margin, process, composite, layerModes, paperMode, prepareTexture, placeTexture, hexToRgb };
if (typeof module !== "undefined") module.exports = Ink;
