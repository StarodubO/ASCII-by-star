// "Dither" tab effect (pure JS, like engine.js; Photoshop I/O is in ditherui.js).
// The frame is cut into cells of `pixel` document px. prepare() takes the source at one sample per cell, adjusts
// it (blur, sharpen, tone, hue, channels, grain) and dithers it to a few colours: along a palette ordered dark to
// light (tone), to the nearest palette colour, to grey levels between two colours, or to levels per RGB channel.
// The result is a grid of cell colours (plus hand edits); render() draws any frame rect at any scale from it, with
// the cells drawn as squares, dots, diamonds or lines, so tiles, previews and the live view match exactly.
"use strict";
const Glitch = require("./glitch.js");

const SETTINGS_VERSION = 1;

const DEFAULTS = {
  v: SETTINGS_VERSION,
  pixel: 4, // document px per cell
  // ---- adjust (on the cells, before dithering) ----
  blur: 0, // cells: softens the source first (calmer patterns)
  sharpen: 0, // unsharp amount at one cell
  brightness: 0, contrast: 0, gamma: 1, // -1..1, -1..1, 0.2..5
  hue: 0, saturation: 0, // degrees, -1..1
  red: 0, green: 0, blue: 0, // -1..1: each channel weaker or stronger
  grain: 0, // noise added before dithering
  invert: false,
  // ---- colours ----
  mode: "tone", // tone = the palette along the brightness, dark to light | palette = the nearest palette colour | gray = levels between two colours | rgb = levels per channel
  palette: ["#141414", "#b8232f", "#e95d2b", "#f6b84a"],
  paletteFrom: "own", // own | image (found in the picture: autoCount colours)
  autoCount: 6,
  metric: "oklab", // rgb | weighted | oklab: how "nearest colour" is measured
  toneReverse: false,
  grayLevels: 2, grayDark: "#000000", grayLight: "#ffffff",
  rgbLevels: 2,
  // ---- dither ----
  algo: "fs", // see ALGOS
  amount: 1, // error diffusion: how much error moves on; ordered: how wide the pattern spreads
  serpentine: true,
  errThreshold: 0, // errors smaller than this (× a step) aren't passed on: flat areas stay clean
  jitter: 0, // random threshold noise in error diffusion (breaks up worms)
  kernel: [7, 0, 0, 3, 5, 1, 0, 0], // custom: right, right 2, down-left 2, down-left, down, down-right, down-right 2, down 2
  patternScale: 1, // ordered and noise: cells per pattern step
  patternAngle: 0, // ordered and noise: rotation of the pattern
  screenSize: 6, screenShape: "round", // halftone screen: period in cells, dot shape
  seed: 1,
  // ---- pixels ----
  shape: "square", // square | circle | diamond | hline | vline | plus
  gap: 0, // share of the cell left empty around the shape
  bgMode: "transparent", // transparent | color: what shows in the gaps and in empty cells
  bgColor: "#000000",
  // ---- transparency ----
  alphaMode: "keep", // keep (cells mostly transparent stay empty) | dither (the edge is dithered too) | ignore
  clearColor: -1, // palette index drawn as empty (-1 = none)
  // ---- hand edits ----
  edits: [], // {op: paint | erase | restore, color, size (cells), round, pts: [x, y, …] (frame fractions)}
};
Object.assign(DEFAULTS, Glitch.DEFAULTS); // gl…: the glitch, on the result (ditherui) or on the picture before dithering (gridOf)

// Algorithms: id → [name, group]. Error diffusion kernels: [dx, dy, weight] (÷ their sum unless KDIV says).
const ALGOS = {
  fs: ["Floyd–Steinberg", "diffusion"], falsefs: ["False Floyd–Steinberg", "diffusion"], jjn: ["Jarvis–Judice–Ninke", "diffusion"],
  stucki: ["Stucki", "diffusion"], burkes: ["Burkes", "diffusion"], sierra3: ["Sierra", "diffusion"], sierra2: ["Two-row Sierra", "diffusion"],
  sierralite: ["Sierra Lite", "diffusion"], atkinson: ["Atkinson", "diffusion"], fan: ["Fan", "diffusion"], shiaufan: ["Shiau–Fan", "diffusion"],
  shiaufan2: ["Shiau–Fan 2", "diffusion"], row: ["Along rows", "diffusion"], column: ["Down columns", "diffusion"], two: ["Right and down", "diffusion"],
  grid: ["Grid", "diffusion"], skip1: ["Skip a neighbour", "diffusion"], skip2: ["Skip two neighbours", "diffusion"], skip3: ["Skip three neighbours", "diffusion"],
  custom: ["Your own weights", "diffusion"], riemersma: ["Riemersma (Hilbert curve)", "curve"],
  bayer2: ["Bayer 2×2", "ordered"], bayer4: ["Bayer 4×4", "ordered"], bayer8: ["Bayer 8×8", "ordered"], bayer16: ["Bayer 16×16", "ordered"],
  cluster4: ["Cluster 4×4", "ordered"], cluster8: ["Cluster 8×8", "ordered"], halftone5: ["Halftone 5×5", "ordered"], halftone8: ["Halftone 8×8", "ordered"],
  screen: ["Halftone screen (any size and angle)", "ordered"],
  bluenoise: ["Blue noise", "noise"], whitenoise: ["White noise", "noise"], ign: ["Interleaved gradient noise", "noise"], golden: ["Golden ratio", "noise"],
  threshold: ["Threshold (no dither)", "ordered"],
};
const KERNELS = {
  fs: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]],
  falsefs: [[1, 0, 3], [0, 1, 3], [1, 1, 2]],
  jjn: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]],
  stucki: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]],
  burkes: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]],
  sierra3: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]],
  sierra2: [[1, 0, 4], [2, 0, 3], [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]],
  sierralite: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]],
  atkinson: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]],
  fan: [[1, 0, 7], [-2, 1, 1], [-1, 1, 3], [0, 1, 5]],
  shiaufan: [[1, 0, 4], [-2, 1, 1], [-1, 1, 1], [0, 1, 2]],
  shiaufan2: [[1, 0, 8], [-3, 1, 1], [-2, 1, 1], [-1, 1, 2], [0, 1, 4]],
  row: [[1, 0, 1]], column: [[0, 1, 1]], two: [[1, 0, 1], [0, 1, 1]],
  grid: [[1, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1]],
  skip1: [[2, 0, 7], [-2, 2, 3], [0, 2, 5], [2, 2, 1]],
  skip2: [[3, 0, 7], [-3, 3, 3], [0, 3, 5], [3, 3, 1]],
  skip3: [[4, 0, 7], [-4, 4, 3], [0, 4, 5], [4, 4, 1]],
};
const KDIV = { atkinson: 8 }; // Atkinson passes on only 6/8 of the error
const CUSTOM_TAPS = [[1, 0], [2, 0], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [0, 2]];
const isDiffusion = (algo) => ALGOS[algo] && ALGOS[algo][1] === "diffusion";

// Palettes: [id, name, colours dark to light where it matters]
const PALETTES = [
  ["sunset", "Sunset poster", ["#141414", "#b8232f", "#e95d2b", "#f6b84a"]],
  ["bw", "1-bit black & white", ["#000000", "#ffffff"]],
  ["gray4", "Grey 4", ["#000000", "#555555", "#aaaaaa", "#ffffff"]],
  ["gameboy", "Game Boy", ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]],
  ["cga", "CGA (cyan, magenta)", ["#000000", "#55ffff", "#ff55ff", "#ffffff"]],
  ["cga2", "CGA (red, green, yellow)", ["#000000", "#aa0000", "#00aa00", "#aa5500"]],
  ["ega", "EGA 16", ["#000000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa", "#555555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#ffffff"]],
  ["pico8", "PICO-8", ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"]],
  ["c64", "Commodore 64", ["#000000", "#ffffff", "#68372b", "#70a4b2", "#6f3d86", "#588d43", "#352879", "#b8c76f", "#6f4f25", "#433900", "#9a6759", "#444444", "#6c6c6c", "#9ad284", "#6c5eb5", "#959595"]],
  ["zx", "ZX Spectrum", ["#000000", "#0000d7", "#d70000", "#d700d7", "#00d700", "#00d7d7", "#d7d700", "#d7d7d7", "#0000ff", "#ff0000", "#ff00ff", "#00ff00", "#00ffff", "#ffff00", "#ffffff"]],
  ["teletext", "Teletext", ["#000000", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff"]],
  ["cmyk", "CMYK", ["#000000", "#00a0e9", "#e4007f", "#fff100", "#ffffff"]],
  ["riso", "Riso pink & blue", ["#1f3f8f", "#0078bf", "#ff48b0", "#f4efe4"]],
  ["thermal", "Thermal", ["#000000", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"]],
  ["blueprint", "Blueprint", ["#0b3d91", "#e8f0ff"]],
  ["sepia", "Sepia", ["#2b1d0e", "#6b4a2b", "#b08d57", "#efe2c4"]],
  ["vapor", "Vaporwave", ["#1a0933", "#5b1e8a", "#ff2a6d", "#05d9e8", "#f9f871"]],
  ["matrix", "Phosphor green", ["#000000", "#003b00", "#008f11", "#00ff41"]],
  ["amber", "Amber screen", ["#0d0600", "#663300", "#ff9900", "#ffcc66"]],
];

const pal = (id) => PALETTES.find((p) => p[0] === id)[2].slice();
// Built-in looks: {id, name, s} (only the settings they change).
const STYLES = [
  { id: "poster", name: "Sunset poster", s: { mode: "tone", palette: pal("sunset"), algo: "bluenoise", pixel: 6, amount: 1, shape: "square", gap: 0 } },
  { id: "atkinson", name: "1-bit Atkinson (classic Mac)", s: { mode: "gray", grayLevels: 2, grayDark: "#000000", grayLight: "#ffffff", algo: "atkinson", pixel: 2, contrast: 0.15 } },
  { id: "fs1", name: "1-bit Floyd–Steinberg", s: { mode: "gray", grayLevels: 2, grayDark: "#000000", grayLight: "#ffffff", algo: "fs", pixel: 2 } },
  { id: "gameboy", name: "Game Boy", s: { mode: "tone", palette: pal("gameboy"), algo: "bayer4", pixel: 4, contrast: 0.2 } },
  { id: "news", name: "Newspaper halftone", s: { mode: "gray", grayLevels: 2, grayDark: "#1b1b1b", grayLight: "#f2eee3", algo: "screen", screenSize: 8, screenShape: "round", patternAngle: 45, pixel: 1 } },
  { id: "riso", name: "Riso duotone", s: { mode: "tone", palette: pal("riso"), algo: "bluenoise", pixel: 3, grain: 0.05 } },
  { id: "pico8", name: "PICO-8", s: { mode: "palette", palette: pal("pico8"), algo: "bayer4", pixel: 5, metric: "oklab", saturation: 0.2 } },
  { id: "c64", name: "Commodore 64", s: { mode: "palette", palette: pal("c64"), algo: "bayer4", pixel: 6, metric: "oklab", patternScale: 1 } },
  { id: "cga", name: "CGA", s: { mode: "palette", palette: pal("cga"), algo: "bayer8", pixel: 4, metric: "weighted" } },
  { id: "thermal", name: "Thermal camera", s: { mode: "tone", palette: pal("thermal"), algo: "riemersma", pixel: 3, blur: 1 } },
  { id: "blueprint", name: "Blueprint lines", s: { mode: "tone", palette: pal("blueprint"), algo: "screen", screenShape: "line", screenSize: 5, patternAngle: 30, pixel: 1 } },
  { id: "led", name: "LED wall", s: { mode: "rgb", rgbLevels: 3, algo: "bayer4", pixel: 10, shape: "circle", gap: 0.18, bgMode: "color", bgColor: "#050505", saturation: 0.3 } },
  { id: "crt", name: "CRT scanlines", s: { mode: "tone", palette: pal("matrix"), algo: "bayer8", pixel: 4, shape: "hline", gap: 0.35, bgMode: "color", bgColor: "#000000" } },
  { id: "rgb8", name: "8 colours (RGB)", s: { mode: "rgb", rgbLevels: 2, algo: "fs", pixel: 3 } },
  { id: "auto", name: "Colours from the picture", s: { mode: "palette", paletteFrom: "image", autoCount: 8, algo: "jjn", pixel: 3, metric: "oklab" } },
  { id: "worms", name: "Organic (Riemersma)", s: { mode: "gray", grayLevels: 2, grayDark: "#101418", grayLight: "#e9e4d8", algo: "riemersma", pixel: 2 } },
];

// ---------- small helpers ----------
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function hexToRgb(hex) {
  let h = String(hex || "#000000").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r, g, b) => "#" + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// integer hash → [0, 1)
function hash3(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// sRGB 0..1 → OKLab
function oklab(r, g, b) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
// colour → coordinates where plain distance means "how different" (metric)
function metricOf(metric) {
  if (metric === "oklab") return (r, g, b) => oklab(r, g, b);
  if (metric === "weighted") return (r, g, b) => { const rm = r * 0.5; return [r * Math.sqrt(2 + rm), g * 2, b * Math.sqrt(3 - rm)]; }; // "redmean"
  return (r, g, b) => [r, g, b];
}

// ---------- settings ----------
function migrate(s) {
  if (!Array.isArray(s.palette) || !s.palette.length) s.palette = DEFAULTS.palette.slice();
  if (!Array.isArray(s.kernel) || s.kernel.length !== 8) s.kernel = DEFAULTS.kernel.slice();
  if (!Array.isArray(s.edits)) s.edits = [];
  if (!ALGOS[s.algo]) s.algo = "fs";
  s.v = SETTINGS_VERSION;
  return s;
}

// ---------- thresholds (ordered and noise) ----------
function bayer(n) {
  let m = [0];
  for (let size = 1; size < n; size *= 2) {
    const next = new Array(size * 2 * size * 2);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = m[y * size + x] * 4, S = size * 2;
      next[y * S + x] = v; next[y * S + x + size] = v + 2; next[(y + size) * S + x] = v + 3; next[(y + size) * S + x + size] = v + 1;
    }
    m = next;
  }
  return Float32Array.from(m, (v) => (v + 0.5) / (n * n));
}
// A clustered matrix: cells ranked by a spot function (small at the dot's middle, which inks first).
function spotMatrix(n, spot) {
  const cells = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) cells.push([spot(((x + 0.5) / n) * 2 - 1, ((y + 0.5) / n) * 2 - 1) + (x * 31 + y * 17) * 1e-9, y * n + x]);
  cells.sort((a, b) => a[0] - b[0]);
  const m = new Float32Array(n * n);
  cells.forEach(([, i], r) => { m[i] = 1 - (r + 0.5) / (n * n); });
  return m;
}
const SPOTS = {
  round: (u, v) => u * u + v * v,
  ellipse: (u, v) => u * u + 2.4 * v * v,
  square: (u, v) => Math.max(Math.abs(u), Math.abs(v)),
  diamond: (u, v) => Math.abs(u) + Math.abs(v),
  line: (u, v) => Math.abs(v),
  cross: (u, v) => Math.min(Math.abs(u), Math.abs(v)),
  ring: (u, v) => Math.abs(Math.sqrt(u * u + v * v) - 0.6),
};
// the classic 45° halftone: two half-dots per tile (one in the middle, one split over the corners)
const halftoneSpot = (u, v) => Math.min(u * u + v * v, (1 - Math.abs(u)) * (1 - Math.abs(u)) + (1 - Math.abs(v)) * (1 - Math.abs(v)));
const MATRICES = {};
function matrixOf(algo) {
  if (MATRICES[algo]) return MATRICES[algo];
  const make = {
    bayer2: () => [2, bayer(2)], bayer4: () => [4, bayer(4)], bayer8: () => [8, bayer(8)], bayer16: () => [16, bayer(16)],
    cluster4: () => [4, spotMatrix(4, SPOTS.diamond)], cluster8: () => [8, spotMatrix(8, SPOTS.diamond)],
    halftone5: () => [5, spotMatrix(5, halftoneSpot)], halftone8: () => [8, spotMatrix(8, halftoneSpot)],
    bluenoise: () => [64, blueNoise(64)],
  }[algo];
  return (MATRICES[algo] = make ? make() : null);
}
// Void-and-cluster blue noise (Ulichney), N×N, values (rank + 0.5) / N². Made once (≈0.2 s for 64).
function blueNoise(N) {
  const n = N * N, sigma = 1.5, g = new Float32Array(n), rnd = mulberry(7);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = Math.min(x, N - x), dy = Math.min(y, N - y); g[y * N + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)); }
  const energy = new Float32Array(n), bits = new Uint8Array(n);
  const splat = (E, p, sg) => { const px = p % N, py = (p / N) | 0; for (let y = 0; y < N; y++) { const gy = ((y - py + N) % N) * N, row = y * N; for (let x = 0; x < N; x++) E[row + x] += sg * g[gy + ((x - px + N) % N)]; } };
  const extreme = (E, B, want, max) => { let best = -1, bv = max ? -Infinity : Infinity; for (let i = 0; i < n; i++) if (B[i] === want && (max ? E[i] > bv : E[i] < bv)) { bv = E[i]; best = i; } return best; };
  const ones = Math.max(1, Math.round(n / 10));
  for (let k = 0; k < ones;) { const p = Math.floor(rnd() * n); if (!bits[p]) { bits[p] = 1; splat(energy, p, 1); k++; } }
  for (let it = 0; it < n; it++) { // spread the first points evenly
    const c = extreme(energy, bits, 1, true); bits[c] = 0; splat(energy, c, -1);
    const v = extreme(energy, bits, 0, false);
    if (v === c) { bits[c] = 1; splat(energy, c, 1); break; }
    bits[v] = 1; splat(energy, v, 1);
  }
  const rank = new Float32Array(n), b2 = bits.slice(), e2 = energy.slice();
  for (let r = ones - 1; r >= 0; r--) { const c = extreme(e2, b2, 1, true); b2[c] = 0; splat(e2, c, -1); rank[c] = r; }
  for (let r = ones; r < n; r++) { const v = extreme(energy, bits, 0, false); bits[v] = 1; splat(energy, v, 1); rank[v] = r; }
  for (let i = 0; i < n; i++) rank[i] = (rank[i] + 0.5) / n;
  return rank;
}
// A spot function made even: the share of the tile below each value (so every tone gets its share of ink).
const SCREEN_CDF = {};
function screenCdf(shape) {
  if (SCREEN_CDF[shape]) return SCREEN_CDF[shape];
  const f = SPOTS[shape] || SPOTS.round, N = 96, vals = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) vals[y * N + x] = f(((x + 0.5) / N) * 2 - 1, ((y + 0.5) / N) * 2 - 1);
  vals.sort();
  return (SCREEN_CDF[shape] = vals);
}
function cdfAt(vals, v) {
  let lo = 0, hi = vals.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < v) lo = m + 1; else hi = m; }
  return lo / vals.length;
}
// θ(x, y) ∈ [0, 1) for cell (x, y): the threshold of the ordered and noise algorithms.
function thresholdFn(s) {
  const algo = s.algo, sc = Math.max(1, s.patternScale), a = (s.patternAngle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const ox = Math.floor(hash3(s.seed, 1, 99) * 4096), oy = Math.floor(hash3(s.seed, 2, 99) * 4096); // where the pattern starts (seed)
  const rot = (x, y) => [(ca * (x + 0.5) + sa * (y + 0.5)) / sc, (-sa * (x + 0.5) + ca * (y + 0.5)) / sc];
  if (algo === "threshold") return () => 0.5;
  if (algo === "whitenoise") return (x, y) => hash3(Math.floor(rot(x, y)[0]), Math.floor(rot(x, y)[1]), s.seed);
  if (algo === "ign") return (x, y) => { const [u, v] = rot(x, y), X = Math.floor(u) + ox, Y = Math.floor(v) + oy, t = 0.06711056 * X + 0.00583715 * Y; return (52.9829189 * (t - Math.floor(t))) % 1; };
  if (algo === "golden") return (x, y) => { const [u, v] = rot(x, y), t = (Math.floor(u) + ox) * 0.7548776662 + (Math.floor(v) + oy) * 0.5698402910; return t - Math.floor(t); };
  if (algo === "screen") {
    const period = Math.max(2, s.screenSize), vals = screenCdf(s.screenShape), f = SPOTS[s.screenShape] || SPOTS.round;
    return (x, y) => {
      const u = (ca * (x + 0.5) + sa * (y + 0.5)) / period, v = (-sa * (x + 0.5) + ca * (y + 0.5)) / period;
      const fu = (u - Math.floor(u)) * 2 - 1, fv = (v - Math.floor(v)) * 2 - 1;
      return Math.min(0.9999, 1 - cdfAt(vals, f(fu, fv)));
    };
  }
  const M = matrixOf(algo);
  if (!M) return () => 0.5;
  const [n, m] = M;
  return (x, y) => { const [u, v] = rot(x, y), i = (((Math.floor(u) + ox) % n) + n) % n, j = (((Math.floor(v) + oy) % n) + n) % n; return m[j * n + i]; };
}

// Generalized Hilbert curve ("gilbert"): calls cb(x, y) for every cell of a w×h grid, each next to the last.
function gilbert(w, h, cb) {
  const sg = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const gen = (x, y, ax, ay, bx, by) => {
    const W = Math.abs(ax + ay), H = Math.abs(bx + by), dax = sg(ax), day = sg(ay), dbx = sg(bx), dby = sg(by);
    if (H === 1) { for (let i = 0; i < W; i++) { cb(x, y); x += dax; y += day; } return; }
    if (W === 1) { for (let i = 0; i < H; i++) { cb(x, y); x += dbx; y += dby; } return; }
    let ax2 = Math.floor(ax / 2), ay2 = Math.floor(ay / 2), bx2 = Math.floor(bx / 2), by2 = Math.floor(by / 2);
    const w2 = Math.abs(ax2 + ay2), h2 = Math.abs(bx2 + by2);
    if (2 * W > 3 * H) {
      if (w2 % 2 && W > 2) { ax2 += dax; ay2 += day; }
      gen(x, y, ax2, ay2, bx, by);
      gen(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by);
    } else {
      if (h2 % 2 && H > 2) { bx2 += dbx; by2 += dby; }
      gen(x, y, bx2, by2, ax2, ay2);
      gen(x + bx2, y + by2, ax, ay, bx - bx2, by - by2);
      gen(x + (ax - dax) + (bx2 - dbx), y + (ay - day) + (by2 - dby), -bx2, -by2, -(ax - ax2), -(ay - ay2));
    }
  };
  if (w >= h) gen(0, 0, w, 0, 0, h); else gen(0, 0, 0, h, w, 0);
}

// ---------- adjust ----------
// Separable box blur ×3 ≈ Gaussian with sigma (cells), in place on a Float32 plane.
function blurPlane(P, w, h, sigma) {
  if (sigma <= 0) return;
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2)), tmp = new Float32Array(Math.max(w, h));
  const pass = (len, count, at) => {
    for (let c = 0; c < count; c++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += P[at(c, Math.min(len - 1, Math.max(0, i)))];
      for (let i = 0; i < len; i++) {
        tmp[i] = acc / (2 * r + 1);
        acc += P[at(c, Math.min(len - 1, i + r + 1))] - P[at(c, Math.max(0, i - r))];
      }
      for (let i = 0; i < len; i++) P[at(c, i)] = tmp[i];
    }
  };
  for (let k = 0; k < 3; k++) { pass(w, h, (c, i) => c * w + i); pass(h, w, (c, i) => i * w + c); }
}
// The adjusted cells as float planes R, G, B (0..1) and alpha A.
function adjust(src, w, h, s) {
  const n = w * h, R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n), d = src.data;
  for (let i = 0; i < n; i++) { const a = d[i * 4 + 3] / 255; A[i] = a; R[i] = d[i * 4] / 255; G[i] = d[i * 4 + 1] / 255; B[i] = d[i * 4 + 2] / 255; }
  for (const P of [R, G, B]) {
    if (s.blur > 0) blurPlane(P, w, h, s.blur);
    if (s.sharpen > 0) { const soft = P.slice(); blurPlane(soft, w, h, 1); for (let i = 0; i < n; i++) P[i] += s.sharpen * (P[i] - soft[i]); }
  }
  const hr = (s.hue * Math.PI) / 180, ch = Math.cos(hr), sh = Math.sin(hr), sat = 1 + s.saturation;
  const con = s.contrast >= 0 ? 1 / Math.max(0.02, 1 - s.contrast) : 1 + s.contrast, gam = 1 / Math.max(0.05, s.gamma);
  const gr = 1 + s.red, gg = 1 + s.green, gb = 1 + s.blue;
  for (let i = 0; i < n; i++) {
    let r = R[i], g = G[i], b = B[i];
    if (s.invert) { r = 1 - r; g = 1 - g; b = 1 - b; }
    r *= gr; g *= gg; b *= gb;
    if (hr || sat !== 1) { // YIQ: hue turns I/Q, saturation scales them
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      let I = 0.596 * r - 0.274 * g - 0.322 * b, Q = 0.211 * r - 0.523 * g + 0.312 * b;
      const I2 = (I * ch - Q * sh) * sat, Q2 = (I * sh + Q * ch) * sat;
      I = I2; Q = Q2;
      r = y + 0.956 * I + 0.621 * Q; g = y - 0.272 * I - 0.647 * Q; b = y - 1.106 * I + 1.703 * Q;
    }
    r = (r - 0.5) * con + 0.5 + s.brightness; g = (g - 0.5) * con + 0.5 + s.brightness; b = (b - 0.5) * con + 0.5 + s.brightness;
    r = clamp01(r); g = clamp01(g); b = clamp01(b);
    if (gam !== 1) { r = Math.pow(r, gam); g = Math.pow(g, gam); b = Math.pow(b, gam); }
    if (s.grain > 0) { const x = i % w, yy = (i / w) | 0, k = (hash3(x, yy, s.seed + 77) - 0.5) * s.grain; r += k; g += k; b += k; }
    R[i] = r; G[i] = g; B[i] = b;
  }
  return { R, G, B, A };
}

// ---------- palette from the picture ----------
// k-means (k-means++ start, seeded) on up to 20000 cells, in OKLab. Returns hex colours sorted dark to light.
function autoPalette(src, w, h, k, seed) {
  const n = w * h, step = Math.max(1, Math.floor(n / 20000)), pts = [], d = src.data;
  for (let i = 0; i < n; i += step) if (d[i * 4 + 3] > 127) pts.push([d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255]);
  if (!pts.length) return ["#000000", "#ffffff"];
  const P = pts.map((p) => oklab(p[0], p[1], p[2])), rnd = mulberry(seed || 1), K = Math.max(2, Math.min(32, Math.round(k), P.length));
  const C = [P[Math.floor(rnd() * P.length)].slice()], dist = new Float32Array(P.length).fill(Infinity);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  while (C.length < K) {
    let sum = 0;
    for (let i = 0; i < P.length; i++) { dist[i] = Math.min(dist[i], d2(P[i], C[C.length - 1])); sum += dist[i]; }
    let t = rnd() * sum, pick = 0;
    for (; pick < P.length - 1 && (t -= dist[pick]) > 0; pick++);
    C.push(P[pick].slice());
  }
  const lab = new Int32Array(P.length);
  for (let it = 0; it < 14; it++) {
    for (let i = 0; i < P.length; i++) { let best = 0, bv = Infinity; for (let c = 0; c < K; c++) { const v = d2(P[i], C[c]); if (v < bv) { bv = v; best = c; } } lab[i] = best; }
    const acc = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < P.length; i++) { const a = acc[lab[i]]; a[0] += pts[i][0]; a[1] += pts[i][1]; a[2] += pts[i][2]; a[3]++; }
    for (let c = 0; c < K; c++) if (acc[c][3]) C[c] = oklab(acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]);
  }
  // the mean sRGB colour of each cluster
  const acc = C.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < P.length; i++) { const a = acc[lab[i]]; a[0] += pts[i][0]; a[1] += pts[i][1]; a[2] += pts[i][2]; a[3]++; }
  return acc.filter((a) => a[3]).map((a) => [a[0] / a[3], a[1] / a[3], a[2] / a[3]]).sort((a, b) => luma(...a) - luma(...b)).map((c) => rgbToHex(c[0] * 255, c[1] * 255, c[2] * 255));
}

// The colours in use: the palette (own or from the picture), as hex.
function paletteOf(s, src, w, h) {
  if (s.mode === "gray") {
    const a = hexToRgb(s.grayDark), b = hexToRgb(s.grayLight), K = Math.max(2, Math.round(s.grayLevels)), out = [];
    for (let i = 0; i < K; i++) { const t = i / (K - 1); out.push(rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)); }
    return out;
  }
  if (s.mode === "rgb") return [];
  const p = s.paletteFrom === "image" && src ? autoPalette(src, w, h, s.autoCount, s.seed) : (s.palette || []).slice();
  return p.length ? p : ["#000000", "#ffffff"];
}

// ---------- dithering ----------
// src: {w, h, data RGBA} at one sample per cell. Returns the grid {w, h, rgba (Uint8Array), idx (Int16Array: palette
// index, -1 = rgb mode or empty), palette (hex)}.
function dither(src, s) {
  const w = src.w, h = src.h, n = w * h, { R, G, B, A } = adjust(src, w, h, s);
  const pal = paletteOf(s, src, w, h), out = new Uint8Array(n * 4), idx = new Int16Array(n).fill(-1);
  const algo = s.algo, diff = isDiffusion(algo), curve = algo === "riemersma", theta = diff || curve ? null : thresholdFn(s), amt = s.amount;
  let taps = KERNELS[algo];
  if (algo === "custom") taps = CUSTOM_TAPS.map(([dx, dy], i) => [dx, dy, Math.max(0, Number(s.kernel[i]) || 0)]).filter((t) => t[2] > 0);
  let div = KDIV[algo] || (taps ? taps.reduce((a, t) => a + t[2], 0) : 1) || 1;
  const thr = Math.max(0, s.errThreshold), jit = Math.max(0, s.jitter);
  // the order cells are visited in (diffusion: rows, serpentine optional; Riemersma: along the curve)
  const visit = (fn) => {
    if (curve) { gilbert(w, h, (x, y) => fn(x, y, 1)); return; }
    if (!diff) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(x, y, 1); return; }
    for (let y = 0; y < h; y++) {
      const rev = s.serpentine && y % 2 === 1;
      if (rev) for (let x = w - 1; x >= 0; x--) fn(x, y, -1); else for (let x = 0; x < w; x++) fn(x, y, 1);
    }
  };
  const spread = (planes, errs, x, y, dir, step) => { // error diffusion to the neighbours
    for (const [dx, dy, wt] of taps) {
      const X = x + dx * dir, Y = y + dy;
      if (X < 0 || X >= w || Y >= h) continue;
      const j = Y * w + X, f = (wt / div) * amt;
      for (let c = 0; c < planes.length; c++) if (Math.abs(errs[c]) >= thr * step) planes[c][j] += errs[c] * f;
    }
  };
  // Riemersma: the last 16 errors along the curve, the newest weighing most (1 … 1/16)
  const Q = 16, RW = Float32Array.from({ length: Q }, (_, i) => Math.pow(1 / 16, (Q - 1 - i) / (Q - 1))), RWS = RW.reduce((a, b) => a + b, 0);
  const makeHist = (ch) => ({ buf: Array.from({ length: ch }, () => new Float32Array(Q)), at: 0 });
  const histErr = (H, c) => { let e = 0; for (let k = 0; k < Q; k++) e += H.buf[c][(H.at + k) % Q] * RW[k]; return (e / RWS) * amt; };
  const histPush = (H, errs) => { for (let c = 0; c < errs.length; c++) H.buf[c][H.at] = errs[c]; H.at = (H.at + 1) % Q; };

  if (s.mode === "tone" || s.mode === "gray") {
    // one value per cell (brightness), quantized along the stops
    const stops = (s.mode === "tone" && s.toneReverse ? pal.slice().reverse() : pal).map(hexToRgb), K = stops.length, V = new Float32Array(n);
    for (let i = 0; i < n; i++) V[i] = luma(R[i], G[i], B[i]);
    const H = curve ? makeHist(1) : null;
    visit((x, y, dir) => {
      const i = y * w + x;
      let v = V[i] + (H ? histErr(H, 0) : 0);
      let q;
      if (theta) { const p = clamp01(v) * (K - 1), f0 = Math.floor(p), t = 0.5 + (theta(x, y) - 0.5) * amt; q = Math.min(K - 1, f0 + (p - f0 > t ? 1 : 0)); }
      else { const vj = jit ? v + (hash3(x, y, s.seed) - 0.5) * jit / (K - 1) : v; q = Math.max(0, Math.min(K - 1, Math.round(clamp01(vj) * (K - 1)))); }
      const e = v - q / (K - 1);
      if (H) histPush(H, [Math.abs(e) >= thr / (K - 1) ? e : 0]);
      else if (diff) spread([V], [e], x, y, dir, 1 / (K - 1));
      idx[i] = q;
      const c = stops[q]; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
    });
    if (s.mode === "tone" && s.toneReverse) for (let i = 0; i < n; i++) idx[i] = K - 1 - idx[i]; // index into the palette as listed
  } else if (s.mode === "rgb") {
    const L = Math.max(2, Math.round(s.rgbLevels)), H = curve ? makeHist(3) : null, P = [R, G, B];
    visit((x, y, dir) => {
      const i = y * w + x, errs = [0, 0, 0], t = theta ? 0.5 + (theta(x, y) - 0.5) * amt : 0;
      for (let c = 0; c < 3; c++) {
        const v = P[c][i] + (H ? histErr(H, c) : 0);
        let q;
        if (theta) { const p = clamp01(v) * (L - 1), f0 = Math.floor(p); q = Math.min(L - 1, f0 + (p - f0 > t ? 1 : 0)); }
        else { const vj = jit ? v + (hash3(x, y, s.seed + c) - 0.5) * jit / (L - 1) : v; q = Math.max(0, Math.min(L - 1, Math.round(clamp01(vj) * (L - 1)))); }
        errs[c] = v - q / (L - 1);
        out[i * 4 + c] = Math.round((q / (L - 1)) * 255);
      }
      out[i * 4 + 3] = 255;
      if (H) histPush(H, errs.map((e) => (Math.abs(e) >= thr / (L - 1) ? e : 0)));
      else if (diff) spread(P, errs, x, y, dir, 1 / (L - 1));
    });
  } else { // nearest palette colour
    const cols = pal.map(hexToRgb), toM = metricOf(s.metric), PM = cols.map((c) => toM(c[0] / 255, c[1] / 255, c[2] / 255)), K = cols.length;
    const lut = new Int16Array(1 << 18).fill(-1); // 6 bits per channel
    const nearest = (r, g, b) => {
      const key = ((Math.round(clamp01(r) * 63) << 12) | (Math.round(clamp01(g) * 63) << 6) | Math.round(clamp01(b) * 63));
      let q = lut[key];
      if (q < 0) {
        const m = toM((key >> 12) / 63, ((key >> 6) & 63) / 63, (key & 63) / 63);
        let bv = Infinity;
        for (let c = 0; c < K; c++) { const v = (m[0] - PM[c][0]) ** 2 + (m[1] - PM[c][1]) ** 2 + (m[2] - PM[c][2]) ** 2; if (v < bv) { bv = v; q = c; } }
        lut[key] = q;
      }
      return q;
    };
    const Rng = 1 / Math.cbrt(K), H = curve ? makeHist(3) : null, P = [R, G, B];
    visit((x, y, dir) => {
      const i = y * w + x;
      let r = R[i], g = G[i], b = B[i];
      if (H) { r += histErr(H, 0); g += histErr(H, 1); b += histErr(H, 2); }
      let q;
      if (theta) { const o = (theta(x, y) - 0.5) * amt * Rng; q = nearest(r + o, g + o, b + o); }
      else if (jit) { const o = (hash3(x, y, s.seed) - 0.5) * jit * Rng; q = nearest(r + o, g + o, b + o); }
      else q = nearest(r, g, b);
      const c = cols[q], errs = [r - c[0] / 255, g - c[1] / 255, b - c[2] / 255];
      if (H) histPush(H, errs.map((e) => (Math.abs(e) >= thr * Rng ? e : 0)));
      else if (diff) spread(P, errs, x, y, dir, Rng);
      idx[i] = q; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
    });
  }
  // transparency: the source's own, and a palette colour drawn as empty
  const athr = s.alphaMode === "dither" ? (theta || thresholdFn(Object.assign({}, s, { algo: "bluenoise" }))) : null;
  for (let i = 0; i < n; i++) {
    const a = A[i], x = i % w, y = (i / w) | 0;
    const empty = s.alphaMode === "ignore" ? false : athr ? a <= athr(x, y) : a < 0.5;
    if (empty || (s.clearColor >= 0 && idx[i] === s.clearColor && s.mode !== "rgb")) { out[i * 4 + 3] = 0; }
  }
  return { w, h, rgba: out, idx, palette: pal };
}

// Hand edits (s.edits) on top of the dithered grid: paint a colour, erase (empty) or restore the dither.
function applyEdits(G, s, frameW, frameH, pixel) {
  if (!s.edits || !s.edits.length) return G;
  const base = G.rgba, rgba = base.slice(), idx = G.idx.slice(), w = G.w, h = G.h;
  for (const e of s.edits) {
    const pts = e.pts || [], size = Math.max(1, e.size || 1), r = size / 2, col = e.op === "paint" ? hexToRgb(e.color) : null;
    const pi = e.op === "paint" ? G.palette.findIndex((c) => c.toLowerCase() === String(e.color).toLowerCase()) : -1;
    const dab = (cx, cy) => {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (e.round !== false && size > 1 ? dx * dx + dy * dy > r * r : Math.abs(dx) > r || Math.abs(dy) > r) continue;
        const i = y * w + x;
        if (e.op === "paint") { rgba[i * 4] = col[0]; rgba[i * 4 + 1] = col[1]; rgba[i * 4 + 2] = col[2]; rgba[i * 4 + 3] = 255; idx[i] = pi; }
        else if (e.op === "erase") { rgba[i * 4 + 3] = 0; }
        else { for (let c = 0; c < 4; c++) rgba[i * 4 + c] = base[i * 4 + c]; idx[i] = G.idx[i]; }
      }
    };
    const cell = (k) => [(pts[k] * frameW) / pixel, (pts[k + 1] * frameH) / pixel];
    for (let k = 0; k + 1 < pts.length; k += 2) {
      const [x1, y1] = cell(k);
      if (k === 0) { dab(size === 1 ? Math.floor(x1) + 0.5 : x1, size === 1 ? Math.floor(y1) + 0.5 : y1); continue; }
      const [x0, y0] = cell(k - 2), len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, Math.ceil(len * 2));
      for (let t = 1; t <= steps; t++) { const x = x0 + ((x1 - x0) * t) / steps, y = y0 + ((y1 - y0) * t) / steps; dab(size === 1 ? Math.floor(x) + 0.5 : x, size === 1 ? Math.floor(y) + 0.5 : y); }
    }
  }
  return Object.assign({}, G, { rgba, idx });
}

// The settings that change the grid (everything but the pixel shape and the background).
const GRID_KEYS = Object.keys(DEFAULTS).filter((k) => !["shape", "gap", "bgMode", "bgColor", "edits", "v"].includes(k) && !Glitch.KEYS.includes(k));
const glitchBefore = (s) => s.glWhere === "before" && Glitch.active(s);
const gridKey = (s) => JSON.stringify(GRID_KEYS.map((k) => s[k])) + (glitchBefore(s) ? Glitch.keyOf(s) : "");

// The field for a frame: {frameW, frameH, pixel, w, h, src}; prepare() dithers it (cached on F per settings).
function makeField(src, frameW, frameH, pixel) { return { frameW, frameH, pixel, w: src.w, h: src.h, src }; }
function gridOf(F, s) {
  const key = gridKey(s);
  if (!F._g || F._g.key !== key) {
    let src = F.src;
    if (glitchBefore(s)) { const d = new Uint8Array(src.data); Glitch.apply(d, src.w, src.h, 0, 0, 1 / F.pixel, F.frameW, F.frameH, s); src = { w: src.w, h: src.h, data: d }; }
    F._g = { key, G: dither(src, s) };
  }
  const ek = JSON.stringify(s.edits || []);
  if (!F._e || F._e.key !== key + ek) F._e = { key: key + ek, G: applyEdits(F._g.G, s, F.frameW, F.frameH, F.pixel) };
  return F._e.G;
}
// Cells across and down for a frame.
const cellsOf = (frameW, frameH, pixel) => ({ w: Math.max(1, Math.ceil(frameW / pixel)), h: Math.max(1, Math.ceil(frameH / pixel)) });

// Coverage test for a point (fx, fy) ∈ [0,1)² in a cell: is it inside the drawn shape?
function shapeTest(shape, gap) {
  const r = (1 - Math.max(0, Math.min(0.95, gap))) / 2, t = r / 3;
  switch (shape) {
    case "circle": return (fx, fy) => (fx - 0.5) ** 2 + (fy - 0.5) ** 2 <= r * r;
    case "diamond": return (fx, fy) => Math.abs(fx - 0.5) + Math.abs(fy - 0.5) <= r;
    case "hline": return (fx, fy) => Math.abs(fy - 0.5) <= r;
    case "vline": return (fx) => Math.abs(fx - 0.5) <= r;
    case "plus": return (fx, fy) => { const dx = Math.abs(fx - 0.5), dy = Math.abs(fy - 0.5); return (dx <= r && dy <= t) || (dy <= r && dx <= t); };
    default: return (fx, fy) => Math.abs(fx - 0.5) <= r && Math.abs(fy - 0.5) <= r;
  }
}

// Frame rect {x, y, w, h} (document px, from the frame's corner) at scale z → RGBA (Uint8Array).
// only: a packed 0xRRGGBB colour: just the cells of that colour (one layer per colour); "bg": just the background.
function render(F, s, rect, z, only) {
  const G = gridOf(F, s), W = Math.max(1, Math.round(rect.w * z)), H = Math.max(1, Math.round(rect.h * z)), out = new Uint8Array(W * H * 4);
  const p = F.pixel, cw = G.w, ch = G.h, cells = G.rgba, plain = s.shape === "square" && !(s.gap > 0), test = shapeTest(s.shape, s.gap);
  const bg = s.bgMode === "color" ? hexToRgb(s.bgColor) : null, wantBg = only === undefined || only === "bg", wantCells = only !== "bg";
  const cellPx = p * z; // a cell's size on the output
  const SS = plain ? 1 : cellPx >= 24 ? 2 : cellPx >= 1.5 ? 4 : 1; // samples per output px (each way) for shaped cells
  const colOf = (cx, cy) => { // [r, g, b, a] of a cell or null
    if (cx < 0 || cy < 0 || cx >= cw || cy >= ch) return null;
    const i = (cy * cw + cx) * 4;
    if (!cells[i + 3]) return null;
    if (only !== undefined && only !== "bg" && ((cells[i] << 16) | (cells[i + 1] << 8) | cells[i + 2]) !== only) return null;
    return i;
  };
  if (z === 1 && Number.isInteger(p) && Number.isInteger(rect.x) && Number.isInteger(rect.y)) { // full size: each pixel's coverage within its cell, worked out once
    const cov = new Float32Array(p * p);
    for (let ly = 0; ly < p; ly++) for (let lx = 0; lx < p; lx++) {
      let c = 0;
      if (plain) c = 1;
      else for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (test((lx + (sx + 0.5) / SS) / p, (ly + (sy + 0.5) / SS) / p)) c++;
      cov[ly * p + lx] = plain ? 1 : c / (SS * SS);
    }
    for (let j = 0; j < H; j++) {
      const Y = rect.y + j, cy = Math.floor(Y / p), ly = Y - cy * p;
      if (Y >= F.frameH || cy >= ch) continue;
      for (let i = 0; i < W; i++) {
        const X = rect.x + i, cx = Math.floor(X / p);
        if (X >= F.frameW || cx >= cw) continue;
        const k = wantCells ? colOf(cx, cy) : null, c = k !== null ? cov[ly * p + X - cx * p] : 0, o = (j * W + i) * 4;
        if (bg && wantBg) { for (let q = 0; q < 3; q++) out[o + q] = Math.round((k !== null ? cells[k + q] * c : 0) + bg[q] * (1 - c)); out[o + 3] = 255; }
        else if (c > 0) { out[o] = cells[k]; out[o + 1] = cells[k + 1]; out[o + 2] = cells[k + 2]; out[o + 3] = Math.round(c * 255); }
      }
    }
    return out;
  }
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      if (cellPx < 1) { // cells smaller than an output pixel: average every cell under it
        const x0 = rect.x + i / z, x1 = rect.x + (i + 1) / z, y0 = rect.y + j / z, y1 = rect.y + (j + 1) / z;
        const cx0 = Math.floor(x0 / p), cx1 = Math.max(cx0, Math.ceil(x1 / p) - 1), cy0 = Math.floor(y0 / p), cy1 = Math.max(cy0, Math.ceil(y1 / p) - 1);
        const stepX = Math.max(1, Math.floor((cx1 - cx0 + 1) / 8)), stepY = Math.max(1, Math.floor((cy1 - cy0 + 1) / 8)); // at most 8×8 samples
        const cov = plain ? 1 : shapeArea(s.shape, s.gap);
        for (let cy = cy0; cy <= cy1; cy += stepY) for (let cx = cx0; cx <= cx1; cx += stepX) {
          cnt++;
          const k = wantCells ? colOf(cx, cy) : null;
          if (k !== null) { const ca = cov; r += cells[k] * ca; g += cells[k + 1] * ca; b += cells[k + 2] * ca; a += ca; if (bg && wantBg) { r += bg[0] * (1 - ca); g += bg[1] * (1 - ca); b += bg[2] * (1 - ca); a += 1 - ca; } }
          else if (bg && wantBg && (cx >= 0 && cy >= 0 && cx < cw && cy < ch)) { r += bg[0]; g += bg[1]; b += bg[2]; a += 1; }
        }
      } else {
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
          cnt++;
          const X = rect.x + (i + (sx + 0.5) / SS) / z, Y = rect.y + (j + (sy + 0.5) / SS) / z, cx = Math.floor(X / p), cy = Math.floor(Y / p);
          if (cx < 0 || cy < 0 || cx >= cw || cy >= ch || X >= F.frameW || Y >= F.frameH) continue;
          const k = wantCells ? colOf(cx, cy) : null;
          if (k !== null && (plain || test(X / p - cx, Y / p - cy))) { r += cells[k]; g += cells[k + 1]; b += cells[k + 2]; a += 1; }
          else if (bg && wantBg) { r += bg[0]; g += bg[1]; b += bg[2]; a += 1; }
        }
      }
      if (a > 0) { const o = (j * W + i) * 4; out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = Math.round((a / cnt) * 255); }
    }
  }
  return out;
}
// render() with the glitch on the result (s.glWhere "after"); cache: a Map kept per preview or apply (strips).
function renderFx(F, s, rect, z, only, cache) {
  if (s.glWhere === "before" || !Glitch.active(s)) return render(F, s, rect, z, only);
  return Glitch.renderWith((r, zz) => render(F, s, r, zz, only), rect, z, F.frameW, F.frameH, s, cache, String(only));
}
// the share of a cell the shape covers (for previews where cells are smaller than a pixel)
const AREAS = {};
function shapeArea(shape, gap) {
  const k = shape + "|" + gap;
  if (AREAS[k] !== undefined) return AREAS[k];
  const t = shapeTest(shape, gap), N = 32;
  let c = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (t((x + 0.5) / N, (y + 0.5) / N)) c++;
  return (AREAS[k] = c / (N * N));
}

// The colours the grid uses (packed 0xRRGGBB), most cells first, for one layer per colour.
function colorsUsed(F, s) {
  const G = gridOf(F, s), count = new Map();
  for (let i = 0; i < G.w * G.h; i++) if (G.rgba[i * 4 + 3]) { const c = (G.rgba[i * 4] << 16) | (G.rgba[i * 4 + 1] << 8) | G.rgba[i * 4 + 2]; count.set(c, (count.get(c) || 0) + 1); }
  return Array.from(count.entries()).sort((a, b) => b[1] - a[1]).map(([c, k]) => ({ color: c, hex: "#" + ((1 << 24) | c).toString(16).slice(1), cells: k }));
}

// Preview: RGBA over a checkerboard → RGB.
function flatten(rgba, W, H) {
  const out = new Uint8Array(W * H * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const o = (j * W + i) * 4, a = rgba[o + 3] / 255, ck = ((i >> 3) + (j >> 3)) & 1 ? 200 : 236, q = (j * W + i) * 3;
    out[q] = rgba[o] * a + ck * (1 - a); out[q + 1] = rgba[o + 1] * a + ck * (1 - a); out[q + 2] = rgba[o + 2] * a + ck * (1 - a);
  }
  return out;
}

// The cell colour of the source at frame point (x, y) (for picking palette colours on the preview).
function sourceAt(F, x, y) {
  const cx = Math.min(F.w - 1, Math.max(0, Math.floor(x / F.pixel))), cy = Math.min(F.h - 1, Math.max(0, Math.floor(y / F.pixel))), i = (cy * F.w + cx) * 4, d = F.src.data;
  return rgbToHex(d[i], d[i + 1], d[i + 2]);
}
function resultAt(F, s, x, y) {
  const G = gridOf(F, s), cx = Math.floor(x / F.pixel), cy = Math.floor(y / F.pixel);
  if (cx < 0 || cy < 0 || cx >= G.w || cy >= G.h) return null;
  const i = (cy * G.w + cx) * 4;
  return G.rgba[i + 3] ? rgbToHex(G.rgba[i], G.rgba[i + 1], G.rgba[i + 2]) : null;
}

// Vector export: one <path> per colour; square cells merge into runs along each row, other shapes are drawn per cell.
function toSVG(F, s) {
  const G = gridOf(F, s), p = F.pixel, W = F.frameW, H = F.frameH, byCol = new Map(), r = (1 - Math.max(0, Math.min(0.95, s.gap))) / 2;
  const add = (c, d) => { if (!byCol.has(c)) byCol.set(c, []); byCol.get(c).push(d); };
  const f = (v) => (Math.round(v * 100) / 100).toString();
  for (let y = 0; y < G.h; y++) {
    for (let x = 0; x < G.w; x++) {
      const i = (y * G.w + x) * 4;
      if (!G.rgba[i + 3]) continue;
      const c = rgbToHex(G.rgba[i], G.rgba[i + 1], G.rgba[i + 2]), cx = (x + 0.5) * p, cy = (y + 0.5) * p, R = r * p;
      if (s.shape === "square" && !(s.gap > 0)) { // a run of this colour
        let e = x;
        while (e + 1 < G.w) { const k = (y * G.w + e + 1) * 4; if (!G.rgba[k + 3] || rgbToHex(G.rgba[k], G.rgba[k + 1], G.rgba[k + 2]) !== c) break; e++; }
        add(c, `M${f(x * p)} ${f(y * p)}h${f(Math.min(W, (e + 1) * p) - x * p)}v${f(Math.min(H, (y + 1) * p) - y * p)}h${f(-(Math.min(W, (e + 1) * p) - x * p))}z`);
        x = e;
      } else if (s.shape === "circle") add(c, `M${f(cx - R)} ${f(cy)}a${f(R)} ${f(R)} 0 1 0 ${f(2 * R)} 0a${f(R)} ${f(R)} 0 1 0 ${f(-2 * R)} 0z`);
      else if (s.shape === "diamond") add(c, `M${f(cx)} ${f(cy - R)}L${f(cx + R)} ${f(cy)}L${f(cx)} ${f(cy + R)}L${f(cx - R)} ${f(cy)}z`);
      else if (s.shape === "hline") add(c, `M${f(x * p)} ${f(cy - R)}h${f(p)}v${f(2 * R)}h${f(-p)}z`);
      else if (s.shape === "vline") add(c, `M${f(cx - R)} ${f(y * p)}h${f(2 * R)}v${f(p)}h${f(-2 * R)}z`);
      else if (s.shape === "plus") { const t = R / 3; add(c, `M${f(cx - R)} ${f(cy - t)}h${f(2 * R)}v${f(2 * t)}h${f(-2 * R)}zM${f(cx - t)} ${f(cy - R)}h${f(2 * t)}v${f(2 * R)}h${f(-2 * t)}z`); }
      else add(c, `M${f(cx - R)} ${f(cy - R)}h${f(2 * R)}v${f(2 * R)}h${f(-2 * R)}z`);
    }
  }
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">`];
  if (s.bgMode === "color") parts.push(`<rect width="${W}" height="${H}" fill="${s.bgColor}"/>`);
  for (const [c, ds] of byCol) parts.push(`<path fill="${c}" d="${ds.join("")}"/>`);
  parts.push("</svg>");
  return parts.join("\n");
}

const Dither = { SETTINGS_VERSION, DEFAULTS, ALGOS, KERNELS, PALETTES, STYLES, migrate, isDiffusion, hexToRgb, rgbToHex, luma, autoPalette, paletteOf, dither, makeField, gridOf, cellsOf, render, colorsUsed, flatten, sourceAt, resultAt, toSVG, gridKey, renderFx };
if (typeof module !== "undefined") module.exports = Dither;
