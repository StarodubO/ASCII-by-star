// ASCII by Star rendering engine. Pure JS, no Photoshop dependencies (runs in UXP and Node).
"use strict";

// ---------- colour helpers ----------
function hexToRgb(hex) {
  let h = String(hex || "").replace(/[^0-9a-f]/gi, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return [0, 0, 0];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
function luma(rgb) {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

// ---------- default settings ----------
const DEFAULTS = {
  charset: "bourke",
  customChars: " .:-=+*#%@",
  sortByDensity: true,
  sizeMode: "px", // "px" | "cols"
  size: 12, // font size in document pixels
  columns: 120,
  spacingX: 1,
  lineHeight: 1,
  contrast: 1,
  brightness: 0,
  gamma: 1,
  threshold: 0,
  invert: false,
  dither: "none", // see DITHERS
  ditherStrength: 1,
  serpentine: false,
  detail: 0, // 0 = pure tone matching, 1 = pure shape matching
  colorMode: "mono", // mono | original | gradient
  fg: "#e8e8e8",
  gradient: ["#000000", "#ff2a6d", "#ffffff"],
  gradientMid: true,
  saturation: 1,
  colorBoost: 0, // lifts dark original colours so glyphs stay visible
  bgMode: "solid", // solid | transparent | mosaic
  bg: "#0b0b0b",
  mosaicAmount: 0.35,
  glyphOpacity: 1,
  // glitch (everything is inert unless glitchOn is true)
  glitchOn: false,
  glitchSeed: 1,
  gPixelSort: 0, gSortDir: "h", gSlices: 0, gSliceSize: 0.4, gBlocks: 0, gBlockSize: 0.35,
  gWave: 0, gWaveFreq: 6, gMelt: 0, gBitCrush: 0, gChannelSwap: "none",
  gCorrupt: 0, gRowShift: 0, gStutter: 0,
  gRgbSplit: 0, gInterlace: 0, gTracking: 0, gScanlines: 0, gNoise: 0,
};

// ---------- atlas ----------
function prepareAtlas(meta, bytes) {
  const { cellW, cellH, fontSize, chars } = meta;
  const n = chars.length, px = cellW * cellH;
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const cov = new Float32Array(n), vec = new Float32Array(n * 9);
  const index = new Map();
  for (let g = 0; g < n; g++) {
    index.set(chars[g], g);
    const off = g * px;
    let sum = 0;
    const sub = new Float64Array(9), cnt = new Float64Array(9);
    for (let y = 0; y < cellH; y++) {
      const sy = Math.min(2, Math.floor((y * 3) / cellH));
      for (let x = 0; x < cellW; x++) {
        const v = data[off + y * cellW + x];
        const k = sy * 3 + Math.min(2, Math.floor((x * 3) / cellW));
        sum += v; sub[k] += v; cnt[k]++;
      }
    }
    cov[g] = sum / (px * 255);
    for (let k = 0; k < 9; k++) vec[g * 9 + k] = sub[k] / (cnt[k] * 255);
  }
  return { cellW, cellH, fontSize, chars, n, data, cov, vec, index };
}

// ---------- charset ----------
function buildCharset(atlas, str, sortByDensity) {
  const seen = new Set(), list = [];
  for (const ch of Array.from(str || "")) {
    if (ch === "\n" || ch === "\r" || ch === "\t" || seen.has(ch)) continue;
    if (!atlas.index.has(ch)) continue;
    seen.add(ch); list.push(atlas.index.get(ch));
  }
  if (sortByDensity !== false && !seen.has(" ") && atlas.index.has(" ")) list.unshift(atlas.index.get(" "));
  if (list.length === 0) list.push(atlas.index.get(" "), atlas.index.get("#"));
  if (sortByDensity !== false) list.sort((a, b) => atlas.cov[a] - atlas.cov[b]);
  const n = list.length;
  const glyphs = Int32Array.from(list);
  const cov = new Float32Array(n), level = new Float32Array(n), vec = new Float32Array(n * 9);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) { cov[i] = atlas.cov[glyphs[i]]; mn = Math.min(mn, cov[i]); mx = Math.max(mx, cov[i]); }
  const span = mx - mn > 1e-6 ? mx - mn : 1;
  for (let i = 0; i < n; i++) {
    level[i] = sortByDensity !== false ? (cov[i] - mn) / span : n > 1 ? i / (n - 1) : 1;
    for (let k = 0; k < 9; k++) vec[i * 9 + k] = Math.max(0, (atlas.vec[glyphs[i] * 9 + k] - mn) / span);
  }
  const lut = new Uint16Array(256);
  for (let v = 0; v < 256; v++) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(level[i] - v / 255); if (d < bd) { bd = d; best = i; } }
    lut[v] = best;
  }
  const chars = Array.from(glyphs, (g) => atlas.chars[g]);
  return { n, glyphs, cov, level, vec, lut, chars };
}

// ---------- geometry ----------
function computeGeometry(docW, docH, s, atlas) {
  const adv = atlas.cellW / atlas.fontSize, line = atlas.cellH / atlas.fontSize;
  let size = s.size;
  if (s.sizeMode === "cols") size = docW / (Math.max(1, s.columns) * adv * s.spacingX);
  size = Math.max(1, size);
  const glyphW = size * adv, glyphH = size * line;
  const cellW = glyphW * s.spacingX, cellH = glyphH * s.lineHeight;
  return { docW, docH, size, glyphW, glyphH, cellW, cellH, cols: Math.ceil(docW / cellW - 1e-6), rows: Math.ceil(docH / cellH - 1e-6) };
}

function inkFromBright(s) {
  let fromBright;
  if (s.bgMode === "transparent") fromBright = s.colorMode !== "mono" || luma(hexToRgb(s.fg)) > 0.5;
  else if (s.colorMode === "mono") fromBright = luma(hexToRgb(s.fg)) >= luma(hexToRgb(s.bg));
  else fromBright = luma(hexToRgb(s.bg)) < 0.5;
  return s.invert ? !fromBright : fromBright;
}

// ---------- analysis: source -> grid of glyphs ----------
// src: {w, h, data: Uint8Array RGBA} covering the whole document at any resolution.
function computeGrid(src, geo, s, cs) {
  if (s.glitchOn) src = glitchSource(src, s);
  const { cols, rows, cellW, cellH, docW, docH } = geo;
  const sx = src.w / docW, sy = src.h / docH, d = src.data, sw = src.w;
  const cells = cols * rows;
  const ink = new Float32Array(cells), sub = new Float32Array(cells * 9);
  const rgb = new Uint8Array(cells * 3), alpha = new Uint8Array(cells);
  const fromBright = inkFromBright(s);
  const contrast = s.contrast, bright = s.brightness, invG = 1 / Math.max(0.05, s.gamma);
  const toneLut = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    let L = (v / 255 - 0.5) * contrast + 0.5 + bright;
    L = Math.pow(clamp01(L), invG);
    toneLut[v] = fromBright ? L : 1 - L;
  }
  const xb = new Int32Array(cols * 3 + 1), yb = new Int32Array(rows * 3 + 1);
  for (let i = 0; i <= cols * 3; i++) xb[i] = Math.min(src.w, Math.floor(Math.min(docW, (i * cellW) / 3) * sx));
  for (let i = 0; i <= rows * 3; i++) yb[i] = Math.min(src.h, Math.floor(Math.min(docH, (i * cellH) / 3) * sy));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ci = r * cols + c;
      let tr = 0, tg = 0, tb = 0, ta = 0, tn = 0, tInk = 0;
      for (let j = 0; j < 3; j++) {
        const y0 = yb[r * 3 + j];
        if (y0 >= src.h) continue;
        const y1 = Math.max(y0 + 1, yb[r * 3 + j + 1]);
        for (let i = 0; i < 3; i++) {
          const x0 = xb[c * 3 + i];
          if (x0 >= src.w) continue;
          const x1 = Math.max(x0 + 1, xb[c * 3 + i + 1]);
          let pr = 0, pg = 0, pb = 0, pa = 0, pl = 0, n = 0;
          for (let y = y0; y < y1; y++) {
            let o = (y * sw + x0) * 4;
            for (let x = x0; x < x1; x++, o += 4) {
              const a = d[o + 3];
              pr += d[o] * a; pg += d[o + 1] * a; pb += d[o + 2] * a; pa += a;
              pl += toneLut[(0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) | 0] * a;
              n++;
            }
          }
          // tone weighted by coverage: transparent pixels contribute no ink
          const v = n > 0 ? pl / (n * 255) : 0;
          sub[ci * 9 + j * 3 + i] = v;
          tInk += v; tr += pr; tg += pg; tb += pb; ta += pa; tn += n;
        }
      }
      ink[ci] = tInk / 9;
      if (ta > 0) { rgb[ci * 3] = tr / ta; rgb[ci * 3 + 1] = tg / ta; rgb[ci * 3 + 2] = tb / ta; }
      alpha[ci] = tn ? clamp255(ta / tn) : 0;
    }
  }
  const grid = selectGlyphs({ cols, rows, ink, sub, rgb, alpha, geo }, s, cs);
  return s.glitchOn ? glitchGrid(grid, cs, s) : grid;
}

// ---------- dithering ----------
// Error-diffusion kernels: [divisor, [[dx, dy, weight], ...]]
const DIFFUSION = {
  fs: [16, [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]]],
  falsefs: [8, [[1, 0, 3], [0, 1, 3], [1, 1, 2]]],
  atkinson: [8, [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]]],
  jjn: [48, [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]]],
  stucki: [42, [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]]],
  burkes: [32, [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]]],
  sierra3: [32, [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]]],
  sierra2: [16, [[1, 0, 4], [2, 0, 3], [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]]],
  sierralite: [4, [[1, 0, 2], [-1, 1, 1], [0, 1, 1]]],
};

function bayerMatrix(n) {
  let m = [[0]];
  while (m.length < n) {
    const k = m.length, next = [];
    for (let y = 0; y < k * 2; y++) { next.push([]); for (let x = 0; x < k * 2; x++) next[y].push(4 * m[y % k][x % k] + [0, 2, 3, 1][(y >= k) * 2 + (x >= k)]); }
    m = next;
  }
  return { n, t: m.flat().map((v) => (v + 0.5) / (n * n)) };
}
// round-dot halftone screen: cells ranked by a spot function so dots grow from the centre
function dotScreen(n) {
  const cells = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = ((x + 0.5) / n) * 2 - 1, v = ((y + 0.5) / n) * 2 - 1;
    cells.push({ i: y * n + x, s: Math.cos(Math.PI * u) + Math.cos(Math.PI * v) + 1e-3 * (x + y * n) });
  }
  cells.sort((a, b) => b.s - a.s);
  const t = new Array(n * n);
  cells.forEach((c, rank) => { t[c.i] = (rank + 0.5) / (n * n); });
  return { n, t };
}
const lineScreen = (fn) => ({ n: 4, t: Array.from({ length: 16 }, (_, i) => (fn(i % 4, Math.floor(i / 4)) + 0.5) / 4) });
const ORDERED = {
  bayer2: bayerMatrix(2), bayer4: bayerMatrix(4), bayer8: bayerMatrix(8),
  dot4: dotScreen(4), dot8: dotScreen(8),
  hlines: lineScreen((x, y) => y), vlines: lineScreen((x) => x), dlines: lineScreen((x, y) => (x + y) % 4),
};
ORDERED.bayer = ORDERED.bayer4; // settings saved by v1.0
function noiseThreshold(kind, c, r) {
  if (kind === "bluenoise") { const v = 52.9829189 * ((0.06711056 * c + 0.00583715 * r) % 1); return v - Math.floor(v); } // interleaved gradient noise
  let h = (c * 374761393 + r * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function gradientAt(stops, t) {
  if (stops.length === 1) return stops[0];
  const p = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p)), f = p - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function selectGlyphs(g, s, cs) {
  const { cols, rows, ink, sub, rgb, alpha } = g;
  const cells = cols * rows;
  const glyph = new Int16Array(cells), color = new Uint8Array(cells * 3);
  const work = Float32Array.from(ink);
  const dither = s.dither, detail = clamp01(s.detail), thr = s.threshold;
  const strength = s.ditherStrength === undefined ? 1 : Math.max(0, s.ditherStrength);
  const kernel = DIFFUSION[dither], ordered = ORDERED[dither], noise = dither === "bluenoise" || dither === "whitenoise";
  const { n, level, vec, lut } = cs;
  const step = n > 1 ? 1 / (n - 1) : 1;
  const cache = detail > 0 ? new Map() : null;
  const tw = (1 - detail) * 9, swt = detail;

  for (let r = 0; r < rows; r++) {
    const rev = kernel && s.serpentine && (r & 1);
    for (let k = 0; k < cols; k++) {
      const c = rev ? cols - 1 - k : k;
      const ci = r * cols + c, orig = ink[ci];
      let v = work[ci];
      if (ordered) v += (ordered.t[(r % ordered.n) * ordered.n + (c % ordered.n)] - 0.5) * step * strength;
      else if (noise) v += (noiseThreshold(dither, c, r) - 0.5) * step * strength;
      if (thr > 0 && orig <= thr) { glyph[ci] = -1; continue; }
      let gi;
      if (!cache) gi = lut[clamp255(v * 255)];
      else {
        const delta = v - orig, b = ci * 9;
        let key = 0;
        for (let q = 0; q < 9; q++) key = key * 8 + Math.min(7, Math.max(0, Math.round((sub[b + q] + delta) * 7)));
        gi = cache.get(key);
        if (gi === undefined) {
          let bd = Infinity; gi = 0;
          for (let i = 0; i < n; i++) {
            const dt = v - level[i];
            let dist = tw * dt * dt;
            for (let q = 0; q < 9; q++) { const dk = sub[b + q] + delta - vec[i * 9 + q]; dist += swt * dk * dk; }
            if (dist < bd) { bd = dist; gi = i; }
          }
          cache.set(key, gi);
        }
      }
      glyph[ci] = gi;
      if (kernel) {
        const e = ((v - level[gi]) * strength) / kernel[0];
        for (const [dx, dy, w] of kernel[1]) {
          const x = rev ? c - dx : c + dx, y = r + dy;
          if (x >= 0 && x < cols && y < rows) work[y * cols + x] += e * w;
        }
      }
    }
  }

  // colours
  const fg = hexToRgb(s.fg);
  const stops = (s.gradientMid ? s.gradient : [s.gradient[0], s.gradient[2]]).map(hexToRgb);
  const sat = s.saturation, boostExp = 1 - clamp01(s.colorBoost) * 0.75;
  for (let ci = 0; ci < cells; ci++) {
    let cr, cg, cb;
    if (s.colorMode === "original") {
      const r0 = rgb[ci * 3], g0 = rgb[ci * 3 + 1], b0 = rgb[ci * 3 + 2];
      const L = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0;
      cr = L + (r0 - L) * sat; cg = L + (g0 - L) * sat; cb = L + (b0 - L) * sat;
      if (boostExp !== 1) {
        cr = 255 * Math.pow(clamp01(cr / 255), boostExp); cg = 255 * Math.pow(clamp01(cg / 255), boostExp); cb = 255 * Math.pow(clamp01(cb / 255), boostExp);
      }
    } else if (s.colorMode === "gradient") {
      [cr, cg, cb] = gradientAt(stops, ink[ci]);
    } else { [cr, cg, cb] = fg; }
    color[ci * 3] = clamp255(cr); color[ci * 3 + 1] = clamp255(cg); color[ci * 3 + 2] = clamp255(cb);
  }
  return { cols, rows, geo: g.geo, glyph, color, rgb, alpha, ink };
}


// ---------- glitch ----------
// All effects are deterministic for a given seed and defined in document-relative units,
// so the preview, the full-resolution apply (rendered in strips) and batch all match.
function hash3(seed, a, b) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(a | 0, 0x85ebca77) ^ Math.imul(b | 0, 0xc2b2ae3d)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function rng(seed) { let i = 0; return () => hash3(seed, 7919, i++); }

function shiftRowRGBA(d, W, y, off) {
  off = Math.round(off) % W; if (!off) return;
  const row = d.slice(y * W * 4, (y + 1) * W * 4);
  for (let x = 0; x < W; x++) { const sx = (((x - off) % W) + W) % W; d.set(row.subarray(sx * 4, sx * 4 + 4), (y * W + x) * 4); }
}

const SWAPS = { rbg: [0, 2, 1], grb: [1, 0, 2], gbr: [1, 2, 0], brg: [2, 0, 1], bgr: [2, 1, 0] };

function glitchSource(src, s) {
  const W = src.w, H = src.h, d = new Uint8Array(src.data), seed = s.glitchSeed | 0;
  const sw = SWAPS[s.gChannelSwap];
  if (sw || s.gBitCrush > 0) {
    const L = Math.max(2, Math.round(32 - s.gBitCrush * 30)), q = 255 / (L - 1);
    for (let o = 0; o < d.length; o += 4) {
      let r = d[o], g = d[o + 1], b = d[o + 2];
      if (sw) { const c = [r, g, b]; r = c[sw[0]]; g = c[sw[1]]; b = c[sw[2]]; }
      if (s.gBitCrush > 0) { r = Math.round(r / q) * q; g = Math.round(g / q) * q; b = Math.round(b / q) * q; }
      d[o] = r; d[o + 1] = g; d[o + 2] = b;
    }
  }
  if (s.gBlocks > 0) {
    // datamosh-style macroblock corruption: copy, drag (smear) or invert blocks
    const nb = Math.round(8 + (1 - s.gBlockSize) * 56), bs = Math.max(2, Math.round(W / nb)), ref = new Uint8Array(d);
    for (let by = 0; by * bs < H; by++) for (let bx = 0; bx < nb; bx++) {
      if (hash3(seed, bx, by) >= s.gBlocks * 0.35) continue;
      const mode = Math.floor(hash3(seed + 1, bx, by) * 3);
      const dx = Math.round((hash3(seed + 2, bx, by) * 6 - 3) * bs), dy = Math.round((hash3(seed + 3, bx, by) * 4 - 2) * bs);
      for (let y = by * bs; y < Math.min(H, (by + 1) * bs); y++) for (let x = bx * bs; x < Math.min(W, (bx + 1) * bs); x++) {
        const o = (y * W + x) * 4;
        let so;
        if (mode === 0) so = (Math.min(H - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx))) * 4;
        else if (mode === 1) so = (by * bs * W + x) * 4; // drag the block's first row down
        else { d[o] = 255 - ref[o]; d[o + 1] = 255 - ref[o + 1]; d[o + 2] = 255 - ref[o + 2]; continue; }
        d[o] = ref[so]; d[o + 1] = ref[so + 1]; d[o + 2] = ref[so + 2]; d[o + 3] = ref[so + 3];
      }
    }
  }
  if (s.gSlices > 0) {
    const r = rng(seed + 11), n = Math.round(4 + s.gSlices * 40);
    for (let k = 0; k < n; k++) {
      const y0 = Math.floor(r() * H), h = Math.max(1, Math.round(r() * s.gSliceSize * 0.12 * H)), off = (r() * 2 - 1) * s.gSlices * 0.3 * W;
      for (let y = y0; y < Math.min(H, y0 + h); y++) shiftRowRGBA(d, W, y, off);
    }
  }
  if (s.gWave > 0) {
    const ph = hash3(seed, 3, 5) * Math.PI * 2;
    for (let y = 0; y < H; y++) shiftRowRGBA(d, W, y, s.gWave * 0.06 * W * Math.sin((y / H) * Math.PI * 2 * s.gWaveFreq + ph));
  }
  if (s.gMelt > 0) {
    const bands = 240;
    for (let b = 0; b < bands; b++) {
      if (hash3(seed + 21, b, 0) >= s.gMelt * 0.6) continue;
      const x0 = Math.floor((b / bands) * W), x1 = Math.max(x0 + 1, Math.floor(((b + 1) / bands) * W));
      const y0 = Math.floor(hash3(seed + 22, b, 0) * H), len = Math.floor(hash3(seed + 23, b, 0) * s.gMelt * 0.6 * H);
      for (let x = x0; x < x1; x++) { const so = (y0 * W + x) * 4; for (let y = y0 + 1; y < Math.min(H, y0 + len); y++) d.copyWithin((y * W + x) * 4, so, so + 4); }
    }
  }
  if (s.gPixelSort > 0) {
    // sort runs of pixels brighter than a threshold, along rows or columns
    const t = (1 - s.gPixelSort) * 255, vertical = s.gSortDir === "v";
    const len = vertical ? H : W, lines = vertical ? W : H, idx = (line, i) => (vertical ? i * W + line : line * W + i) * 4;
    const lum = (o) => 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];
    for (let line = 0; line < lines; line++) {
      let i = 0;
      while (i < len) {
        while (i < len && lum(idx(line, i)) < t) i++;
        const start = i;
        while (i < len && lum(idx(line, i)) >= t) i++;
        if (i - start > 1) {
          const px = [];
          for (let k = start; k < i; k++) { const o = idx(line, k); px.push([lum(o), d[o], d[o + 1], d[o + 2], d[o + 3]]); }
          px.sort((a, b) => a[0] - b[0]);
          for (let k = start; k < i; k++) { const o = idx(line, k), p = px[k - start]; d[o] = p[1]; d[o + 1] = p[2]; d[o + 2] = p[3]; d[o + 3] = p[4]; }
        }
      }
    }
  }
  return { w: W, h: H, data: d };
}

function glitchGrid(grid, cs, s) {
  const { cols, rows, glyph, color } = grid, seed = s.glitchSeed | 0;
  if (s.gStutter > 0) for (let r = 1; r < rows; r++) if (hash3(seed + 31, r, 0) < s.gStutter * 0.3) {
    glyph.copyWithin(r * cols, (r - 1) * cols, r * cols); color.copyWithin(r * cols * 3, (r - 1) * cols * 3, r * cols * 3);
  }
  if (s.gRowShift > 0) for (let r = 0; r < rows; r++) if (hash3(seed + 32, r, 0) < s.gRowShift * 0.4) {
    const k = ((Math.round((hash3(seed + 33, r, 0) * 2 - 1) * s.gRowShift * cols * 0.3) % cols) + cols) % cols;
    if (!k) continue;
    const g = glyph.slice(r * cols, (r + 1) * cols), c = color.slice(r * cols * 3, (r + 1) * cols * 3);
    for (let x = 0; x < cols; x++) { const sx = (x - k + cols) % cols; glyph[r * cols + x] = g[sx]; color.set(c.subarray(sx * 3, sx * 3 + 3), (r * cols + x) * 3); }
  }
  if (s.gCorrupt > 0 && cs.n > 1) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (hash3(seed + 34, c, r) < s.gCorrupt * 0.3) glyph[r * cols + c] = 1 + Math.floor(hash3(seed + 35, c, r) * (cs.n - 1));
  }
  return grid;
}

// Row-local effects on the rendered RGBA (safe for strip rendering): positions are evaluated in document coordinates.
function glitchOutput(out, view, geo, s) {
  const W = view.w, H = view.h, sc = view.scale, seed = s.glitchSeed | 0, docW = geo.docW, docH = geo.docH;
  const docY = (y) => view.y + (y + 0.5) / sc;
  const row = new Uint8ClampedArray(W * 4);
  const bands = [];
  if (s.gTracking > 0) { const r = rng(seed + 41), n = Math.ceil(s.gTracking * 6); for (let i = 0; i < n; i++) bands.push({ y: r() * docH, h: (0.01 + r() * 0.05) * docH, off: (r() * 2 - 1) * s.gTracking * 0.08 * docW }); }
  const split = Math.round(s.gRgbSplit * 0.015 * docW * sc), inter = s.gInterlace * 0.012 * docW * sc;
  const scanP = Math.max(2, docH / 360), scanK = s.gScanlines * 0.55, noiseK = s.gNoise * 90;
  for (let y = 0; y < H; y++) {
    const dy = docY(y);
    let off = 0, bandK = 0;
    if (inter && Math.floor(dy / Math.max(1, docH / 540)) & 1) off += inter;
    for (const b of bands) { const t = Math.abs(dy - b.y) / b.h; if (t < 1) { bandK = Math.max(bandK, 1 - t); off += b.off * (1 - t) * (0.6 + 0.4 * hash3(seed + 42, Math.floor(dy), 0)); } }
    off = Math.round(off * sc);
    if (off || split) {
      row.set(out.subarray(y * W * 4, (y + 1) * W * 4));
      const px = (x) => Math.min(W - 1, Math.max(0, x)) * 4;
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4, c = px(x - off), r = px(x - off - split), b = px(x - off + split);
        out[o] = row[r]; out[o + 1] = row[c + 1]; out[o + 2] = row[b + 2]; out[o + 3] = Math.max(row[r + 3], row[c + 3], row[b + 3]);
      }
    }
    const dark = scanK && Math.floor(dy / scanP) & 1 ? 1 - scanK : 1;
    if (dark !== 1 || noiseK || bandK) {
      const ny = Math.floor(dy);
      for (let x = 0, o = y * W * 4; x < W; x++, o += 4) {
        let n = 0;
        if (noiseK || bandK) n = (hash3(seed + 43, Math.floor(view.x + (x + 0.5) / sc), ny) - 0.5) * (noiseK + bandK * 120);
        out[o] = out[o] * dark + n; out[o + 1] = out[o + 1] * dark + n; out[o + 2] = out[o + 2] * dark + n;
      }
    }
  }
}

// ---------- rendering ----------
function resampleGlyph(atlas, g, tw, th) {
  const sw = atlas.cellW, sh = atlas.cellH, src = atlas.data, off = g * sw * sh;
  const out = new Uint8Array(tw * th);
  if (tw <= sw && th <= sh) {
    const fx = sw / tw, fy = sh / th, norm = 1 / (fx * fy);
    for (let y = 0; y < th; y++) {
      const sy0 = y * fy, sy1 = sy0 + fy;
      for (let x = 0; x < tw; x++) {
        const sx0 = x * fx, sx1 = sx0 + fx;
        let acc = 0;
        for (let yy = Math.floor(sy0); yy < Math.min(sh, Math.ceil(sy1)); yy++) {
          const wy = Math.min(yy + 1, sy1) - Math.max(yy, sy0);
          const row = off + yy * sw;
          for (let xx = Math.floor(sx0); xx < Math.min(sw, Math.ceil(sx1)); xx++) {
            acc += src[row + xx] * wy * (Math.min(xx + 1, sx1) - Math.max(xx, sx0));
          }
        }
        out[y * tw + x] = Math.min(255, Math.round(acc * norm));
      }
    }
  } else {
    for (let y = 0; y < th; y++) {
      const v = Math.max(0, Math.min(sh - 1, ((y + 0.5) * sh) / th - 0.5));
      const y0 = Math.floor(v), y1 = Math.min(sh - 1, y0 + 1), fy = v - y0;
      for (let x = 0; x < tw; x++) {
        const u = Math.max(0, Math.min(sw - 1, ((x + 0.5) * sw) / tw - 0.5));
        const x0 = Math.floor(u), x1 = Math.min(sw - 1, x0 + 1), fx = u - x0;
        const a = src[off + y0 * sw + x0] * (1 - fx) + src[off + y0 * sw + x1] * fx;
        const b = src[off + y1 * sw + x0] * (1 - fx) + src[off + y1 * sw + x1] * fx;
        out[y * tw + x] = Math.round(a * (1 - fy) + b * fy);
      }
    }
  }
  return out;
}

function blendPx(out, o, r, g, b, a) {
  if (a <= 0) return;
  const da = out[o + 3] / 255, oa = a + da * (1 - a);
  const k = a / oa, kd = 1 - k;
  out[o] = r * k + out[o] * kd; out[o + 1] = g * k + out[o + 1] * kd; out[o + 2] = b * k + out[o + 2] * kd;
  out[o + 3] = oa * 255;
}

// view: {x, y} top-left in document px, {w, h} output px, scale = output px per document px.
// Returns straight-alpha RGBA Uint8Array.
function render(grid, cs, atlas, s, view) {
  const { cols, rows, geo, glyph, color, rgb } = grid;
  const sc = view.scale, W = view.w, H = view.h;
  const out = new Uint8ClampedArray(W * H * 4);
  const bg = hexToRgb(s.bg), op = clamp01(s.glyphOpacity);
  const mosaic = s.bgMode === "mosaic", mAmt = clamp01(s.mosaicAmount);
  if (s.bgMode !== "transparent") {
    for (let o = 0; o < out.length; o += 4) { out[o] = bg[0]; out[o + 1] = bg[1]; out[o + 2] = bg[2]; out[o + 3] = 255; }
  }
  const mosaicColor = (ci) => [bg[0] + (rgb[ci * 3] - bg[0]) * mAmt, bg[1] + (rgb[ci * 3 + 1] - bg[1]) * mAmt, bg[2] + (rgb[ci * 3 + 2] - bg[2]) * mAmt];
  const cw = geo.cellW * sc, ch = geo.cellH * sc, gw = geo.glyphW * sc, gh = geo.glyphH * sc;
  const c0 = Math.max(0, Math.floor(view.x / geo.cellW)), c1 = Math.min(cols, Math.ceil((view.x + W / sc) / geo.cellW));
  const r0 = Math.max(0, Math.floor(view.y / geo.cellH)), r1 = Math.min(rows, Math.ceil((view.y + H / sc) / geo.cellH));

  if (gw >= 3 && gh >= 3) {
    const igw = Math.round(gw), igh = Math.round(gh), cache = new Map();
    for (let r = r0; r < r1; r++) {
      const oy = (r * geo.cellH - view.y) * sc;
      for (let c = c0; c < c1; c++) {
        const ci = r * cols + c, ox = (c * geo.cellW - view.x) * sc;
        if (mosaic) {
          const [mr, mg, mb] = mosaicColor(ci);
          const xa = Math.max(0, Math.round(ox)), xe = Math.min(W, Math.round(ox + cw));
          const ya = Math.max(0, Math.round(oy)), ye = Math.min(H, Math.round(oy + ch));
          for (let y = ya; y < ye; y++) for (let x = xa, o = (y * W + xa) * 4; x < xe; x++, o += 4) { out[o] = mr; out[o + 1] = mg; out[o + 2] = mb; out[o + 3] = 255; }
        }
        const gi = glyph[ci];
        if (gi < 0 || cs.cov[gi] <= 0) continue;
        let bm = cache.get(gi);
        if (!bm) { bm = resampleGlyph(atlas, cs.glyphs[gi], igw, igh); cache.set(gi, bm); }
        const gx = Math.round(ox + (cw - igw) / 2), gy = Math.round(oy + (ch - igh) / 2);
        const cr = color[ci * 3], cg = color[ci * 3 + 1], cb = color[ci * 3 + 2];
        const ya = Math.max(0, gy), ye = Math.min(H, gy + igh), xa = Math.max(0, gx), xe = Math.min(W, gx + igw);
        for (let y = ya; y < ye; y++) {
          const brow = (y - gy) * igw - gx;
          for (let x = xa, o = (y * W + xa) * 4; x < xe; x++, o += 4) {
            const a = bm[brow + x];
            if (a) blendPx(out, o, cr, cg, cb, (a / 255) * op);
          }
        }
      }
    }
  } else {
    // glyphs smaller than ~3px: draw each cell as its average ink coverage
    const areaK = Math.min(1, (gw * gh) / (cw * ch)) * op;
    const colOf = new Int32Array(W), rowOf = new Int32Array(H);
    for (let x = 0; x < W; x++) colOf[x] = Math.floor((view.x + (x + 0.5) / sc) / geo.cellW);
    for (let y = 0; y < H; y++) rowOf[y] = Math.floor((view.y + (y + 0.5) / sc) / geo.cellH);
    for (let y = 0; y < H; y++) {
      const r = rowOf[y];
      if (r < 0 || r >= rows) continue;
      for (let x = 0, o = y * W * 4; x < W; x++, o += 4) {
        const c = colOf[x];
        if (c < 0 || c >= cols) continue;
        const ci = r * cols + c;
        if (mosaic) { const m = mosaicColor(ci); out[o] = m[0]; out[o + 1] = m[1]; out[o + 2] = m[2]; out[o + 3] = 255; }
        const gi = glyph[ci];
        if (gi >= 0) blendPx(out, o, color[ci * 3], color[ci * 3 + 1], color[ci * 3 + 2], cs.cov[gi] * areaK);
      }
    }
  }
  if (s.glitchOn) glitchOutput(out, view, geo, s);
  return new Uint8Array(out.buffer);
}

// Flatten RGBA onto a checkerboard for previews -> RGB.
function flattenForPreview(rgba, W, H) {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0, i = 0, o = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i += 4, o += 3) {
      const ck = ((x >> 3) + (y >> 3)) & 1 ? 204 : 255, a = rgba[i + 3] / 255;
      out[o] = rgba[i] * a + ck * (1 - a); out[o + 1] = rgba[i + 1] * a + ck * (1 - a); out[o + 2] = rgba[i + 2] * a + ck * (1 - a);
    }
  }
  return out;
}

// ---------- text exports ----------
function gridLines(grid, cs) {
  const lines = [];
  for (let r = 0; r < grid.rows; r++) {
    let line = "";
    for (let c = 0; c < grid.cols; c++) { const gi = grid.glyph[r * grid.cols + c]; line += gi < 0 ? " " : cs.chars[gi]; }
    lines.push(line);
  }
  return lines;
}
function toText(grid, cs) { return gridLines(grid, cs).map((l) => l.replace(/\s+$/, "")).join("\n") + "\n"; }

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function colorRuns(grid, cs, r, s) {
  const runs = [];
  let cur = null;
  for (let c = 0; c < grid.cols; c++) {
    const ci = r * grid.cols + c, gi = grid.glyph[ci];
    const ch = gi < 0 ? " " : cs.chars[gi];
    const hex = s.colorMode === "mono" ? s.fg : rgbToHex(grid.color[ci * 3], grid.color[ci * 3 + 1], grid.color[ci * 3 + 2]);
    if (ch === " " && cur) { cur.text += ch; continue; }
    if (cur && cur.hex === hex) cur.text += ch;
    else { cur = { hex, text: ch }; runs.push(cur); }
  }
  return runs;
}

function toHTML(grid, cs, s) {
  const g = grid.geo, fs = 10;
  const lh = (g.cellH / g.size).toFixed(4), ls = ((g.cellW - g.glyphW) / g.size).toFixed(4);
  const bg = s.bgMode === "transparent" ? "transparent" : s.bg;
  let body = "";
  for (let r = 0; r < grid.rows; r++) {
    for (const run of colorRuns(grid, cs, r, s)) body += s.colorMode === "mono" ? esc(run.text) : `<span style="color:${run.hex}">${esc(run.text)}</span>`;
    body += "\n";
  }
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>ASCII by Star</title></head>\n<body style="margin:0;background:${bg}">\n<pre style="margin:0;font-family:Menlo,Consolas,'DejaVu Sans Mono',monospace;font-size:${fs}px;line-height:${lh};letter-spacing:${ls}em;color:${s.fg};background:${bg}">\n${body}</pre>\n</body></html>\n`;
}

function toSVG(grid, cs, s) {
  const g = grid.geo, W = Math.round(grid.cols * g.cellW), H = Math.round(grid.rows * g.cellH);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`];
  if (s.bgMode !== "transparent") parts.push(`<rect width="100%" height="100%" fill="${s.bg}"/>`);
  if (s.bgMode === "mosaic") {
    const bg = hexToRgb(s.bg), m = clamp01(s.mosaicAmount);
    for (let r = 0; r < grid.rows; r++) {
      let start = 0, prev = null;
      for (let c = 0; c <= grid.cols; c++) {
        let hex = null;
        if (c < grid.cols) {
          const ci = r * grid.cols + c;
          hex = rgbToHex(...[0, 1, 2].map((k) => clamp255(bg[k] + (grid.rgb[ci * 3 + k] - bg[k]) * m)));
        }
        if (hex !== prev) {
          if (prev) parts.push(`<rect x="${(start * g.cellW).toFixed(2)}" y="${(r * g.cellH).toFixed(2)}" width="${((c - start) * g.cellW + 0.5).toFixed(2)}" height="${(g.cellH + 0.5).toFixed(2)}" fill="${prev}"/>`);
          start = c; prev = hex;
        }
      }
    }
  }
  parts.push(`<g font-family="Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="${g.size.toFixed(2)}" fill="${s.fg}" xml:space="preserve"${s.glyphOpacity < 1 ? ` fill-opacity="${s.glyphOpacity}"` : ""}>`);
  const baseOff = (g.cellH - g.glyphH) / 2 + g.glyphH * 0.79;
  for (let r = 0; r < grid.rows; r++) {
    const runs = colorRuns(grid, cs, r, s);
    const y = (r * g.cellH + baseOff).toFixed(2);
    const inner = s.colorMode === "mono" ? esc(runs.map((x) => x.text).join("")) : runs.map((x) => `<tspan fill="${x.hex}">${esc(x.text)}</tspan>`).join("");
    parts.push(`<text x="${((g.cellW - g.glyphW) / 2).toFixed(2)}" y="${y}" textLength="${((grid.cols - 1) * g.cellW + g.glyphW).toFixed(2)}" lengthAdjust="spacing">${inner}</text>`);
  }
  parts.push("</g></svg>");
  return parts.join("\n");
}

const Engine = { DIFFUSION, ORDERED, resampleGlyph, DEFAULTS, prepareAtlas, buildCharset, computeGeometry, computeGrid, render, flattenForPreview, gridLines, toText, toHTML, toSVG, hexToRgb, rgbToHex, luma };
if (typeof module !== "undefined") module.exports = Engine;
