// Glitch for the Dither, Lines and Map tabs (pure JS, like engine.js; the ASCII tab has its own in engine.js).
// Every effect moves pixels only along their row or changes their colour, and everything is placed in document
// coordinates of the frame (hashed from glSeed), so tiles, previews and the live view match. Effects that move
// pixels need the whole row: renderWith() renders full-width strips (cached, so tiles in one row share one strip)
// and wraps round the frame's width, like a broken video signal.
"use strict";

const DEFAULTS = {
  glOn: false, glSeed: 1,
  glWhere: "after", // after = on the result | before = on the picture, before the tab's effect (Dither, Lines)
  glSlices: 0, glSliceSize: 0.4, // bands of rows pushed sideways
  glWave: 0, glWaveFreq: 6, // rows bent by a sine wave
  glBlocks: 0, glBlockSize: 0.35, // macroblocks shifted, smeared, inverted or recoloured
  glSort: 0, // pixel sorting along rows (runs brighter than a threshold)
  glSplit: 0, // RGB split: red and blue pulled apart
  glInterlace: 0, // every other line band shifted
  glTracking: 0, // VHS tracking bands, with noise
  glCrush: 0, // fewer colour levels
  glSwap: "none", // channel swap: rbg | grb | gbr | brg | bgr
  glScanlines: 0, glNoise: 0,
};
const KEYS = Object.keys(DEFAULTS);
const SWAPS = { rbg: [0, 2, 1], grb: [1, 0, 2], gbr: [1, 2, 0], brg: [2, 0, 1], bgr: [2, 1, 0] };

function hash3(seed, a, b) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(a | 0, 0x85ebca77) ^ Math.imul(b | 0, 0xc2b2ae3d)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const rng = (seed) => { let i = 0; return () => hash3(seed, 7919, i++); };

// Whether anything shows, and whether it moves pixels (then whole rows are needed).
const active = (g) => !!g.glOn && (g.glSlices > 0 || g.glWave > 0 || g.glBlocks > 0 || g.glSort > 0 || g.glSplit > 0 || g.glInterlace > 0 || g.glTracking > 0 || g.glCrush > 0 || (g.glSwap && g.glSwap !== "none") || g.glScanlines > 0 || g.glNoise > 0);
const moves = (g) => g.glSlices > 0 || g.glWave > 0 || g.glBlocks > 0 || g.glSort > 0 || g.glSplit > 0 || g.glInterlace > 0 || g.glTracking > 0;
const keyOf = (g) => JSON.stringify(KEYS.map((k) => g[k]));

// The glitch on RGBA `px` (W×H) covering frame rect starting at (vx, vy) at scale z, in a frame of fw×fh document px.
// Pixel moves wrap round the row, so px must be the frame's full width (vx = 0) when moves(g).
function apply(px, W, H, vx, vy, z, fw, fh, g) {
  if (!active(g)) return px;
  const seed = g.glSeed | 0, docY = (y) => vy + (y + 0.5) / z, docX = (x) => vx + (x + 0.5) / z;
  // bands of rows: slices and tracking (document px)
  const slices = [], bands = [];
  if (g.glSlices > 0) { const r = rng(seed + 11), n = Math.round(4 + g.glSlices * 40); for (let k = 0; k < n; k++) slices.push({ y: r() * fh, h: Math.max(1, r() * g.glSliceSize * 0.12 * fh), off: (r() * 2 - 1) * g.glSlices * 0.3 * fw }); }
  if (g.glTracking > 0) { const r = rng(seed + 41), n = Math.ceil(g.glTracking * 6); for (let k = 0; k < n; k++) bands.push({ y: r() * fh, h: (0.01 + r() * 0.05) * fh, off: (r() * 2 - 1) * g.glTracking * 0.08 * fw }); }
  const ph = hash3(seed, 3, 5) * Math.PI * 2, interP = Math.max(1, fh / 540), split = g.glSplit * 0.015 * fw;
  const nb = Math.round(8 + (1 - g.glBlockSize) * 56), bs = fw / nb; // macroblocks
  const sw = SWAPS[g.glSwap], L = g.glCrush > 0 ? Math.max(2, Math.round(32 - g.glCrush * 30)) : 0, q = L ? 255 / (L - 1) : 1;
  const scanP = Math.max(2, fh / 360), scanK = g.glScanlines * 0.55, noiseK = g.glNoise * 90;
  const row = new Uint8Array(W * 4), wrap = (x) => ((x % W) + W) % W;
  for (let y = 0; y < H; y++) {
    const dy = docY(y), o0 = y * W * 4;
    // 1. how far the row moves (document px)
    let off = 0, bandK = 0;
    for (const b of slices) if (dy >= b.y && dy < b.y + b.h) off += b.off;
    if (g.glWave > 0) off += g.glWave * 0.06 * fw * Math.sin((dy / fh) * Math.PI * 2 * g.glWaveFreq + ph);
    if (g.glInterlace > 0 && Math.floor(dy / interP) & 1) off += g.glInterlace * 0.012 * fw;
    for (const b of bands) { const t = Math.abs(dy - b.y) / b.h; if (t < 1) { bandK = Math.max(bandK, 1 - t); off += b.off * (1 - t) * (0.6 + 0.4 * hash3(seed + 42, Math.floor(dy), 0)); } }
    const by = Math.floor(dy / bs);
    if (off || split || g.glBlocks > 0) {
      row.set(px.subarray(o0, o0 + W * 4));
      const offPx = Math.round(off * z), sp = Math.round(split * z);
      for (let x = 0; x < W; x++) {
        let xo = offPx, inv = false, tint = -1;
        if (g.glBlocks > 0) { // the block this pixel is in: shifted, smeared (its first column), inverted or recoloured
          const bx = Math.floor(docX(x) / bs);
          if (hash3(seed, bx, by) < g.glBlocks * 0.35) {
            const mode = Math.floor(hash3(seed + 1, bx, by) * 4);
            if (mode === 0) xo += Math.round((hash3(seed + 2, bx, by) * 6 - 3) * bs * z);
            else if (mode === 1) xo = x - Math.round((bx * bs - vx) * z); // smear: every pixel takes the block's left edge
            else if (mode === 2) inv = true;
            else tint = Math.floor(hash3(seed + 3, bx, by) * 3);
          }
        }
        const c = wrap(x - xo) * 4, r = wrap(x - xo - sp) * 4, b = wrap(x - xo + sp) * 4, o = o0 + x * 4;
        let R = row[r], G = row[c + 1], B = row[b + 2];
        if (inv) { R = 255 - R; G = 255 - G; B = 255 - B; }
        if (tint === 0) R = Math.min(255, R + 120); else if (tint === 1) G = Math.min(255, G + 120); else if (tint === 2) B = Math.min(255, B + 120);
        px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = Math.max(row[r + 3], row[c + 3], row[b + 3]);
      }
    }
    // 2. pixel sorting: runs brighter than the threshold, sorted dark to light along the row
    if (g.glSort > 0) {
      const t = (1 - g.glSort) * 255, lum = (o) => 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
      let i = 0;
      while (i < W) {
        while (i < W && (px[o0 + i * 4 + 3] === 0 || lum(o0 + i * 4) < t)) i++;
        const start = i;
        while (i < W && px[o0 + i * 4 + 3] > 0 && lum(o0 + i * 4) >= t) i++;
        if (i - start > 1) {
          const run = [];
          for (let k = start; k < i; k++) { const o = o0 + k * 4; run.push([lum(o), px[o], px[o + 1], px[o + 2], px[o + 3]]); }
          run.sort((a, b2) => a[0] - b2[0]);
          for (let k = start; k < i; k++) { const o = o0 + k * 4, p = run[k - start]; px[o] = p[1]; px[o + 1] = p[2]; px[o + 2] = p[3]; px[o + 3] = p[4]; }
        }
      }
    }
    // 3. colour: channel swap, crush, scanlines, noise
    const dark = scanK && Math.floor(dy / scanP) & 1 ? 1 - scanK : 1;
    if (sw || L || dark !== 1 || noiseK || bandK) {
      const ny = Math.floor(dy);
      for (let x = 0, o = o0; x < W; x++, o += 4) {
        if (!px[o + 3]) continue;
        let R = px[o], G = px[o + 1], B = px[o + 2];
        if (sw) { const c3 = [R, G, B]; R = c3[sw[0]]; G = c3[sw[1]]; B = c3[sw[2]]; }
        if (L) { R = Math.round(R / q) * q; G = Math.round(G / q) * q; B = Math.round(B / q) * q; }
        let n = 0;
        if (noiseK || bandK) n = (hash3(seed + 43, Math.floor(docX(x)), ny) - 0.5) * (noiseK + bandK * 120);
        px[o] = Math.max(0, Math.min(255, R * dark + n)); px[o + 1] = Math.max(0, Math.min(255, G * dark + n)); px[o + 2] = Math.max(0, Math.min(255, B * dark + n));
      }
    }
  }
  return px;
}

// Renders frame rect `rect` at scale z through render(rect, z) → RGBA, with the glitch. Pixel moves need whole
// rows: then a full-width strip is rendered (or taken from `cache`, a Map the caller keeps per apply/preview;
// tag tells apart different renders, like map layers) and the rect is cut out of it.
function renderWith(render, rect, z, fw, fh, g, cache, tag) {
  if (!active(g)) return render(rect, z);
  const W = Math.max(1, Math.round(rect.w * z)), H = Math.max(1, Math.round(rect.h * z));
  if (!moves(g)) return apply(render(rect, z), W, H, rect.x, rect.y, z, fw, fh, g);
  const SW = Math.max(1, Math.round(fw * z)), key = [tag || "", rect.y, rect.h, z, fw, fh, keyOf(g)].join("|");
  let strip = cache && cache.get(key);
  if (!strip) {
    strip = apply(render({ x: 0, y: rect.y, w: fw, h: rect.h }, z), SW, H, 0, rect.y, z, fw, fh, g);
    if (cache) { cache.set(key, strip); if (cache.size > 6) cache.delete(cache.keys().next().value); }
  }
  const out = new Uint8Array(W * H * 4), x0 = Math.round(rect.x * z);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x0 + x;
    if (sx < 0 || sx >= SW) continue;
    const s = (y * SW + sx) * 4, o = (y * W + x) * 4;
    out[o] = strip[s]; out[o + 1] = strip[s + 1]; out[o + 2] = strip[s + 2]; out[o + 3] = strip[s + 3];
  }
  return out;
}

// A random mix: two to four effects, a new seed.
function randomize(R) {
  R = R || Math.random;
  const g = Object.assign({}, DEFAULTS, { glOn: true, glSeed: Math.floor(R() * 99999) + 1 });
  const pool = ["glSlices", "glWave", "glBlocks", "glSort", "glSplit", "glInterlace", "glTracking", "glCrush", "glScanlines", "glNoise", "glSwap"];
  const n = 2 + Math.floor(R() * 3);
  for (let k = 0; k < n; k++) {
    const e = pool.splice(Math.floor(R() * pool.length), 1)[0];
    if (e === "glSwap") g.glSwap = ["rbg", "grb", "gbr", "brg", "bgr"][Math.floor(R() * 5)];
    else g[e] = Math.round((0.15 + R() * (e === "glSort" ? 0.5 : 0.6)) * 100) / 100;
  }
  g.glSliceSize = Math.round((0.2 + R() * 0.6) * 100) / 100; g.glBlockSize = Math.round((0.2 + R() * 0.6) * 100) / 100; g.glWaveFreq = Math.round(2 + R() * 12);
  return g;
}

const Glitch = { DEFAULTS, KEYS, active, moves, keyOf, apply, renderWith, randomize };
if (typeof module !== "undefined") module.exports = Glitch;
