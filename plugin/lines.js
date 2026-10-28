// "Lines" tab effect: topographic contour lines and ridge lines drawn from a height field. Pure JS (no
// Photoshop APIs), shared by the plugin (linesui.js) and the Node tools.
// prepare() turns an analysis image (and optionally a separate height image, such as a depth map) into a
// smoothed height field; render() draws any document rect of the frame at any scale from it. Every pixel is
// computed from document coordinates alone, so tiles, strips and previews match exactly.
"use strict";
const Engine = require("./engine.js"); // the Custom text syntax (parseCustom) for text on the lines
const { CHARSETS } = require("./charsets.js"); // character sets for textMode "set"
const Glitch = require("./glitch.js"); // gl… settings (applied in linesui)

const REF = 3000; // sizes are px on a 3000 px long side
const ANALYSIS = 1600; // long side of the height field
const SETTINGS_VERSION = 2;

const DEFAULTS = {
  version: SETTINGS_VERSION,
  style: "contours", // contours | ridges | maze (a labyrinth whose lines crowd where the height is low) | points (a 3D point cloud)
  // ---- height ----
  heightFrom: "source", // source = the source's brightness | layer = another layer (a depth map) | map = a map region
  heightLayer: null, // that layer's id
  mapPlace: "", // what was typed: a Google Maps link, "lat, lon" or a place name
  mapLat: null, mapLon: null, mapName: "", // where it was found
  mapWidthKm: 10, // width of the region
  seaFloor: false, // map: the sea floor's own depth (off: the sea is flat at sea level)
  invert: false, // dark (or low) is high
  equalize: true, // spread the levels evenly over the picture's tones (not with a metre interval)
  smooth: 8, // px: blur of the height field (bigger = rounder lines)
  // ---- spacing ----
  levels: 40, // number of contour lines from the lowest to the highest point
  mapInterval: 0, // map: metres between lines (0 = use levels)
  offset: 0, // 0..1: slides every line up or down the slope
  declutter: 0, // px: lines closer than this fade out (index lines stay)
  rows: 70, // ridge lines
  amp: 4, // ridge height in row spacings
  ridgeLocal: true, // lift each ridge from its own lowest point (off: from the lowest point overall)
  // ---- labyrinth (maze) ----
  mzSpacing: 9, // px: between the lines where the height is lowest (dark)
  mzRange: 5, // × that spacing where the height is highest (light)
  mzCurve: 1, // >1: more of the picture gets the close lines; <1: more gets the wide ones
  mzSeed: 1, // another labyrinth
  // ---- point cloud (points) ----
  pcSpacing: 10, // px: between neighbouring points before any are left out
  pcJitter: 1, // 0 = a regular grid, 1 = scattered
  pcToneDensity: 0.6, // -1..1: more points where the source is dark (negative: where it is light)
  pcHeightDensity: 0, // -1..1: more points high up (negative: low down)
  pcCut: 0, // 0..1: no points below this height (the background of a depth map)
  pcDepth: 0.3, // × the long side: how far the highest points come forward
  pcYaw: -25, pcPitch: 15, // degrees: the view turns left/right, up/down
  pcPersp: 0.5, // 0 = flat (orthographic) … 1 = strong perspective
  pcZoom: 0.9, // the cloud's size in the frame
  pcSizeNear: 1, // 0..2: near points bigger (1 = as perspective gives)
  pcFog: 0, // 0..1: far points fade out
  pcShape: "round", // round | square
  pcSeed: 1, // other places for the points
  // ---- width ----
  lineWidth: 2.5, // px
  toneWeight: 0, // -1..1: thicker where the source is dark (negative: where it is light)
  heightWeight: 0, // -1..1: thicker high up (negative: low down)
  indexEvery: 5, // every Nth line is an index line (0 = none)
  indexWidth: 2, // × lineWidth
  // ---- line colour ----
  lineFrom: "own", // own | image (sampled) | height (gradient low → high) | across (gradient at lineAngle)
  lineColor: "#111111",
  lineA: "#1b3a4b", lineMid: "#c1666b", lineMidOn: false, lineB: "#e8c170", lineAngle: 90,
  // the gradient's shape (height and across): the part of the height it spans, where the middle colour sits, a curve
  // (−1..1: more of the low or the high colour), hard steps (0 = smooth), repeats (mirrored = back and forth), reversed
  lineGradFrom: 0, lineGradTo: 1, lineGradMid: 0.5, lineGradCurve: 0, lineGradSteps: 0, lineGradRepeat: 1, lineGradMirror: true, lineGradReverse: false,
  sampleSat: 1, sampleBright: 0, // sampled colours: saturation ×, brightness −1..1
  lineOpacity: 1,
  indexColorOn: false, indexColor: "#000000",
  // ---- under the lines ----
  bgMode: "color", // color | gradient | transparent
  bgColor: "#ffffff", bgColor2: "#d9e4ea", bgAngle: 90,
  bands: "none", // none | steps | smooth | alternate (contours only)
  bandA: "#f3efe4", bandMid: "#c9b77d", bandMidOn: false, bandB: "#8fb39a",
  bandOpacity: 1,
  shade: 0, // 0..1: hill shading (contours)
  shadeAngle: 135, // light from (Photoshop's light angle: 0 = right, 90 = top)
  shadeRelief: 4, // how steep the shading thinks the slopes are
  followShape: true, // nothing where the source is transparent (not with a map)
  // ---- height labels ----
  labelsOn: false, // numbers on the contour lines
  labelEvery: 1, // on every Nth index line (every Nth line without index lines)
  labelSpacing: 650, // px: the least distance between two labels
  labelSize: 30, // px: height of the digits
  labelColorOn: false, labelColor: "#000000", // off: the line's own colour
  labelGap: true, // cut the lines under each label
  labelUphill: true, // the tops of the numbers face uphill, as on survey maps (off: always readable)
  labelUnits: "m", // map heights: m | ft
  peaks: 0, // spot heights: how many of the highest points get a ▲ and their height
  peakSpacing: 500, // px: the least distance between two spot heights
  // ---- text on the lines (contours) ----
  textOn: false, // write characters along the contour lines (see pathGlyphs)
  ptFont: "", ptFontName: "", // the text's font (PostScript name; "" = the built-in Menlo); spaced by each letter's width
  textMode: "text", // text = ptText along each line, turned with it | set = ptSet's characters at random | direction = - / | \ from the line's direction, upright
  ptText: "%h m · ", // Custom text syntax: [A|B] items, [?A|B] at random, {msg} / {msg*N} hidden messages; %h = the line's height.
  // Several rows: one per height, lowest line first, repeating (an empty row leaves that height without text)
  ptSet: "bourke", // textMode "set": a charsets.js id
  ptSize: 28, // px: height of the characters
  ptSpacing: 1, // × the character width
  ptWhich: "all", // all | index | others: the lines that get text (the rest stay lines)
  ptLineOpacity: 0, // the lines under the text (0 = text only)
  ptRotate: true, // the characters turn with the line (off: upright)
  ptVertical: false, // vertical type: the characters stand across the line, one below the other along it
  ptReadable: true, // the text reads left to right (off: the tops face uphill)
  ptRoom: 0.8, // × size: no characters where the lines are closer together than this (0 = everywhere)
  ptSeed: 1, // [?random] items and where the {messages} go
  ptMsgColorOn: true, ptMsgColor: "#e63946", // the {messages}' own colour (off: the line's)
  // lines you chose on the preview (see pickedLines): [{x, y (fractions of the frame), all (every line at that
  // height), mode: text (own text, or the text above when empty) | rain | line (no text) | hide, text, colorOn, color}]
  ptPicks: [],
  // Matrix rain on the lines (textMode "rain", or a chosen line set to rain): streams of random characters along
  // each line, brightest at the head
  prChars: String.fromCharCode(...Array.from({ length: 56 }, (_, i) => 0xff66 + i)) + "0123456789", // Custom text syntax; picked at random
  prLength: 12, // characters per stream
  prLengthVar: 0.5, // 0..1: how much the lengths vary
  prGaps: 0.6, // × a stream's length: the empty stretch after it
  prFade: 0.7, // 0..1: the tail fades out (0 = no fade)
  prHead: false, prHeadColor: "#ffffff", // the head (the leading character) in its own colour
  prColorOn: false, prColor: "#00ff41", // the rain's own colour (off: the line's)
  prReverse: false, // the streams run the other way along the lines
  prSeed: 1,
};
Object.assign(DEFAULTS, Glitch.DEFAULTS); // gl…: the glitch, on the result or on the picture before the lines (linesui)

const STYLES = [
  { id: "topo", name: "Topographic map", s: { style: "contours", labelsOn: true, peaks: 5, levels: 40, lineWidth: 2.5, indexEvery: 5, indexWidth: 2, smooth: 10, declutter: 0, toneWeight: 0, heightWeight: 0, lineFrom: "own", bands: "none", shade: 0, lineColor: "#5a3a1e", bgColor: "#f6f1e3", bgMode: "color" } },
  { id: "relief", name: "Shaded relief map", s: { style: "contours", labelsOn: true, peaks: 6, levels: 30, lineWidth: 1.4, indexEvery: 5, indexWidth: 2, smooth: 6, declutter: 2, toneWeight: 0, heightWeight: 0, lineFrom: "own", bands: "smooth", bandA: "#5e8c61", bandMid: "#e9dfb4", bandMidOn: true, bandB: "#f8f4ee", bandOpacity: 1, shade: 0.7, shadeAngle: 135, shadeRelief: 4, lineColor: "#5b4636", bgMode: "color" } },
  { id: "fine", name: "Fine contours", s: { style: "contours", levels: 90, lineWidth: 1.6, indexEvery: 0, smooth: 6, declutter: 0, toneWeight: 0, heightWeight: 0, lineFrom: "own", bands: "none", shade: 0, lineColor: "#111111", bgColor: "#ffffff", bgMode: "color" } },
  { id: "weighted", name: "Weighted by tone", s: { style: "contours", levels: 70, lineWidth: 2.4, indexEvery: 0, smooth: 7, declutter: 0, toneWeight: 0.85, heightWeight: 0, lineFrom: "own", bands: "none", shade: 0, lineColor: "#111111", bgColor: "#ffffff", bgMode: "color" } },
  { id: "sampled", name: "Image colours", s: { style: "contours", levels: 80, lineWidth: 2.2, indexEvery: 0, smooth: 6, declutter: 0, toneWeight: 0.5, heightWeight: 0, lineFrom: "image", sampleSat: 1.3, sampleBright: 0, bands: "none", shade: 0, bgColor: "#0b0b0e", bgMode: "color" } },
  { id: "neon", name: "Neon gradient", s: { style: "contours", levels: 50, lineWidth: 2, indexEvery: 0, smooth: 9, declutter: 0, toneWeight: 0, heightWeight: 0.4, lineFrom: "height", lineA: "#3a0ca3", lineMid: "#f72585", lineMidOn: true, lineB: "#4cc9f0", bands: "none", shade: 0, bgMode: "gradient", bgColor: "#07071a", bgColor2: "#1b0b2e", bgAngle: 90 } },
  { id: "hypso", name: "Coloured bands", s: { style: "contours", levels: 18, lineWidth: 1.6, indexEvery: 0, smooth: 12, declutter: 0, toneWeight: 0, heightWeight: 0, lineFrom: "own", bands: "steps", bandA: "#2f5d50", bandMidOn: false, bandB: "#f1e6c8", bandOpacity: 1, shade: 0, lineColor: "#1d2a24", bgMode: "color" } },
  { id: "maze", name: "Labyrinth", s: { style: "maze", mzSpacing: 9, mzRange: 5, mzCurve: 1, smooth: 6, lineWidth: 2, toneWeight: 0, heightWeight: 0, lineFrom: "own", lineColor: "#111111", bgColor: "#ffffff", bgMode: "color", bands: "none" } },
  { id: "mazeFilled", name: "Labyrinth, filled", s: { style: "maze", mzSpacing: 7, mzRange: 5, mzCurve: 1, smooth: 6, lineWidth: 0, toneWeight: 0, heightWeight: 0, lineFrom: "own", lineColor: "#111111", bgColor: "#f4efe6", bgMode: "color", bands: "alternate", bandA: "#1d1d1f", bandB: "#f4efe6", bandOpacity: 1 } },
  { id: "cloud", name: "Point cloud", s: { style: "points", pcSpacing: 9, pcJitter: 1, pcToneDensity: 0.3, pcHeightDensity: 0, pcCut: 0, pcDepth: 0.3, pcYaw: -25, pcPitch: 15, pcPersp: 0.5, pcZoom: 0.9, pcSizeNear: 1, pcFog: 0.35, pcShape: "round", lineWidth: 4, toneWeight: 0, heightWeight: 0, lineFrom: "height", lineA: "#3a0ca3", lineMid: "#f72585", lineMidOn: true, lineB: "#4cc9f0", bgMode: "color", bgColor: "#05050c" } },
  { id: "cloudImage", name: "Point cloud, image colours", s: { style: "points", pcSpacing: 6, pcJitter: 1, pcToneDensity: 0, pcHeightDensity: 0, pcCut: 0, pcDepth: 0.25, pcYaw: 20, pcPitch: -10, pcPersp: 0.4, pcZoom: 0.9, pcSizeNear: 1, pcFog: 0.3, pcShape: "round", lineWidth: 3.5, toneWeight: 0, heightWeight: 0, lineFrom: "image", sampleSat: 1.2, sampleBright: 0.1, bgMode: "color", bgColor: "#000000" } },
  { id: "rain", name: "Matrix rain on the lines", s: { style: "contours", levels: 45, lineWidth: 1, indexEvery: 0, smooth: 8, declutter: 0, toneWeight: 0, heightWeight: 0, lineFrom: "own", lineColor: "#0f5f2a", bands: "none", shade: 0, bgColor: "#000000", bgMode: "color",
    textOn: true, textMode: "rain", ptWhich: "all", ptSize: 26, ptSpacing: 1, ptRoom: 0.8, ptLineOpacity: 0.25, ptRotate: true, ptVertical: true, ptReadable: true, prLength: 14, prLengthVar: 0.5, prGaps: 0.7, prFade: 0.75, prHead: true, prHeadColor: "#d8ffe0", prColorOn: true, prColor: "#00ff41", prReverse: false } },
  { id: "ridges", name: "Ridge lines", s: { style: "ridges", rows: 55, amp: 8, ridgeLocal: true, lineWidth: 2.2, smooth: 8, toneWeight: 0, heightWeight: 0, lineFrom: "own", lineColor: "#ffffff", bgColor: "#000000", bgMode: "color" } },
];

// Settings saved by older versions.
function migrate(s) {
  if (s.bands === "gradient") s.bands = "steps";
  s.version = SETTINGS_VERSION;
  return s;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function hexToRgb(hex) {
  let h = String(hex || "#000").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Separable box blur, 3 passes (≈ gaussian with sigma ≈ r), edges clamped. In place.
function blur(A, w, h, r) {
  if (!(r > 0.3)) return A;
  const R = Math.max(1, Math.round(r)), tmp = new Float32Array(Math.max(w, h));
  const pass = (n, len, stride, step) => {
    for (let line = 0; line < n; line++) {
      const o = line * stride;
      let sum = 0;
      for (let i = -R; i <= R; i++) sum += A[o + Math.min(len - 1, Math.max(0, i)) * step];
      for (let i = 0; i < len; i++) {
        tmp[i] = sum / (2 * R + 1);
        sum += A[o + Math.min(len - 1, i + R + 1) * step] - A[o + Math.max(0, i - R) * step];
      }
      for (let i = 0; i < len; i++) A[o + i * step] = tmp[i];
    }
  };
  for (let k = 0; k < 3; k++) { pass(h, w, w, 1); pass(w, h, 1, w); }
  return A;
}

// The analysis size for a frame of fw × fh document px: z = analysis px per document px.
function analysisZ(fw, fh) { return Math.min(1, ANALYSIS / Math.max(fw, fh)); }

// img: {w, h, data RGBA} the source read at analysisZ (covering the frame, pixel i at document (i + 0.5)/z);
// heightImg: the same for a height layer, or {w, h, elev, min, max} metres from a map region, or null;
// fw, fh: the frame in document px. Returns the field render() draws from.
function prepare(img, heightImg, s, fw, fh) {
  const w = img.w, h = img.h, n = w * h, d = img.data;
  const H = new Float32Array(n), tone = new Float32Array(n), alpha = new Float32Array(n), rgb = new Uint8Array(n * 3);
  const fits = heightImg && heightImg.w === w && heightImg.h === h, elev = fits && heightImg.elev, hd = fits && !elev ? heightImg.data : null;
  let metres = null;
  if (elev) { // metres → 0..1 between the lowest and highest point (the sea flat at 0 unless seaFloor)
    const lo = s.seaFloor ? heightImg.min : Math.max(0, heightImg.min), hi = Math.max(lo + 1, s.seaFloor ? heightImg.max : Math.max(0, heightImg.max));
    metres = { lo, hi, invert: !!s.invert };
    for (let i = 0; i < n; i++) { const v = (Math.max(s.seaFloor ? -1e9 : 0, elev[i]) - lo) / (hi - lo); H[i] = s.invert ? 1 - v : v; }
  }
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255, lum = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    alpha[i] = elev ? 1 : a; // a map has no shape
    tone[i] = (1 - lum) * a;
    rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2];
    if (elev) continue;
    let v;
    if (hd) { const ha = hd[i * 4 + 3] / 255; v = ((0.2126 * hd[i * 4] + 0.7152 * hd[i * 4 + 1] + 0.0722 * hd[i * 4 + 2]) / 255) * ha; if (s.invert) v = ha - v; }
    else v = (s.invert ? 1 - lum : lum) * a;
    H[i] = v;
  }
  const k = analysisZ(fw, fh), docLong = Math.max(fw, fh); // analysis px per document px
  const px = (k * docLong) / REF; // analysis px per reference px
  if (s.equalize && !metres) equalize(H, hd ? null : alpha); // map heights stay in metres (labels read them)
  blur(H, w, h, s.smooth * px);
  blur(tone, w, h, Math.max(1, s.smooth * 0.4 * px));
  blur(alpha, w, h, 0.8);
  const [gx, gy] = gradient(H, w, h);
  // the hill shading's slopes, from a softer copy: shading shows every small step (8-bit banding) as a crease
  let sgx = gx, sgy = gy;
  if (s.shade > 0) { const soft = blur(Float32Array.from(H), w, h, 2.5); [sgx, sgy] = gradient(soft, w, h); }
  return { w, h, k, fw, fh, H, gx, gy, sgx, sgy, tone, alpha, rgb, docLong, metres };
}
// Gradient of A per analysis px: [gx, gy].
function gradient(A, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    gx[i] = (A[y * w + Math.min(w - 1, x + 1)] - A[y * w + Math.max(0, x - 1)]) / (x > 0 && x < w - 1 ? 2 : 1);
    gy[i] = (A[Math.min(h - 1, y + 1) * w + x] - A[Math.max(0, y - 1) * w + x]) / (y > 0 && y < h - 1 ? 2 : 1);
  }
  return [gx, gy];
}

// Histogram equalization of H (0..1), counting only cells that are visible (mask > 0.5) when a mask is given.
function equalize(H, mask) {
  const B = 1024, hist = new Float64Array(B);
  let total = 0;
  for (let i = 0; i < H.length; i++) { if (mask && mask[i] < 0.5) continue; hist[Math.min(B - 1, Math.floor(H[i] * B))]++; total++; }
  if (!total) return;
  const cdf = new Float32Array(B + 1);
  for (let b = 0, acc = 0; b < B; b++) { cdf[b] = acc / total; acc += hist[b]; cdf[B] = acc / total; }
  for (let i = 0; i < H.length; i++) {
    const f = Math.min(B - 1e-6, Math.max(0, H[i] * B)), b = Math.floor(f), t = f - b;
    const v = cdf[b] + (cdf[b + 1] - cdf[b]) * t;
    H[i] = mask ? v * Math.min(1, mask[i] * 2) : v; // transparent stays lowest
  }
}

// Catmull-Rom sample of A at analysis coordinates (pixel centres at integer + 0.5).
function cubic(A, w, h, x, y) {
  x -= 0.5; y -= 0.5;
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const wx0 = ((-0.5 * tx + 1) * tx - 0.5) * tx, wx1 = (1.5 * tx - 2.5) * tx * tx + 1, wx2 = ((-1.5 * tx + 2) * tx + 0.5) * tx, wx3 = (0.5 * tx - 0.5) * tx * tx;
  const wy0 = ((-0.5 * ty + 1) * ty - 0.5) * ty, wy1 = (1.5 * ty - 2.5) * ty * ty + 1, wy2 = ((-1.5 * ty + 2) * ty + 0.5) * ty, wy3 = (0.5 * ty - 0.5) * ty * ty;
  const cx = (o) => Math.min(w - 1, Math.max(0, ix + o));
  const x0 = cx(-1), x1 = cx(0), x2 = cx(1), x3 = cx(2);
  let v = 0;
  const rows = [wy0, wy1, wy2, wy3];
  for (let j = 0; j < 4; j++) {
    const r = Math.min(h - 1, Math.max(0, iy - 1 + j)) * w;
    v += rows[j] * (wx0 * A[r + x0] + wx1 * A[r + x1] + wx2 * A[r + x2] + wx3 * A[r + x3]);
  }
  return v;
}
function bilinear(A, w, h, x, y) {
  x -= 0.5; y -= 0.5;
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const x0 = Math.min(w - 1, Math.max(0, ix)), x1 = Math.min(w - 1, Math.max(0, ix + 1));
  const y0 = Math.min(h - 1, Math.max(0, iy)) * w, y1 = Math.min(h - 1, Math.max(0, iy + 1)) * w;
  return (A[y0 + x0] * (1 - tx) + A[y0 + x1] * tx) * (1 - ty) + (A[y1 + x0] * (1 - tx) + A[y1 + x1] * tx) * ty;
}
function sampleRGB(F, x, y, out) {
  x -= 0.5; y -= 0.5;
  const w = F.w, h = F.h, ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const x0 = Math.min(w - 1, Math.max(0, ix)), x1 = Math.min(w - 1, Math.max(0, ix + 1));
  const y0 = Math.min(h - 1, Math.max(0, iy)) * w, y1 = Math.min(h - 1, Math.max(0, iy + 1)) * w;
  for (let c = 0; c < 3; c++) {
    const g = (i) => F.rgb[i * 3 + c];
    out[c] = (g(y0 + x0) * (1 - tx) + g(y0 + x1) * tx) * (1 - ty) + (g(y1 + x0) * (1 - tx) + g(y1 + x1) * tx) * ty;
  }
  return out;
}

// A colour between a and b (and through m when it's given) at t (0..1), into out.
function ramp(a, m, b, t, out, mid) {
  t = clamp01(t);
  if (m && mid !== undefined && mid !== 0.5) { if (t < mid) { b = m; t /= mid; } else { a = m; t = (t - mid) / (1 - mid); } }
  else if (m) { if (t < 0.5) { b = m; t *= 2; } else { a = m; t = t * 2 - 1; } }
  for (let c = 0; c < 3; c++) out[c] = a[c] + (b[c] - a[c]) * t;
  return out;
}
// The line gradient's shape: position 0..1 (height or across) → position along the colours (lineGrad… settings).
function gradShape(s) {
  const from = s.lineGradFrom, to = s.lineGradTo, rep = Math.max(1, s.lineGradRepeat), steps = Math.round(s.lineGradSteps), k = Math.pow(4, -s.lineGradCurve);
  if (from === 0 && to === 1 && rep === 1 && !steps && !s.lineGradCurve && !s.lineGradReverse) return (t) => t;
  return (t) => {
    t = to === from ? (t >= to ? 1 : 0) : clamp01((t - from) / (to - from));
    if (rep > 1) { const u = t * rep; t = s.lineGradMirror ? (Math.floor(u) % 2 ? 1 - (u - Math.floor(u)) : u - Math.floor(u)) : u >= rep ? 1 : u - Math.floor(u); }
    if (k !== 1) t = Math.pow(t, k);
    if (steps >= 2) t = Math.min(steps - 1, Math.floor(t * steps)) / (steps - 1);
    return s.lineGradReverse ? 1 - t : t;
  };
}
// Position along a gradient at `angle` (degrees, 90 = bottom to top) over the frame: 0..1.
function across(F, angle) {
  const r = (angle * Math.PI) / 180, cx = Math.cos(r), cy = -Math.sin(r), span = Math.abs(F.fw * cx) + Math.abs(F.fh * cy) || 1;
  return (x, y) => ((x - F.fw / 2) * cx + (y - F.fh / 2) * cy) / span + 0.5;
}
// Width factor from a value t (0..1) and a weight −1..1 (negative: thicker where t is low).
const weightOf = (k, t) => (k >= 0 ? 1 + k * (1.7 * t - 0.75) : 1 - k * (1.7 * (1 - t) - 0.75));
// Coverage of a line of width wpx at distance d (output px) from its centre.
const coverage = (d, wpx) => Math.min(Math.min(1, wpx), Math.max(0, wpx / 2 + 0.5 - d));
// Mixes colour c (rgb) with coverage cov over the pixel at o.
function over(out, o, c, cov) {
  if (cov <= 0) return;
  const a0 = out[o + 3] / 255, a = cov + a0 * (1 - cov);
  if (a <= 0) return;
  for (let ch = 0; ch < 3; ch++) out[o + ch] = (c[ch] * cov + out[o + ch] * a0 * (1 - cov)) / a;
  out[o + 3] = a * 255;
}

// Everything render() needs from the settings, worked out once per call.
function context(F, s, z) {
  const rgb = (hex) => hexToRgb(hex), pxOut = (F.docLong / REF) * z;
  const c = {
    pxOut, base: s.lineWidth * pxOut,
    line: rgb(s.lineColor), lineA: rgb(s.lineA), lineMid: s.lineMidOn ? rgb(s.lineMid) : null, lineB: rgb(s.lineB),
    index: s.indexColorOn ? rgb(s.indexColor) : null, lineAcross: across(F, s.lineAngle), shape: gradShape(s), mid: s.lineGradMid,
    bg: rgb(s.bgColor), bg2: rgb(s.bgColor2), bgAcross: across(F, s.bgAngle),
    bandA: rgb(s.bandA), bandMid: s.bandMidOn ? rgb(s.bandMid) : null, bandB: rgb(s.bandB),
    tmp: [0, 0, 0], gaps: [],
  };
  // the light for hill shading: towards the light, 45° up
  const r = (s.shadeAngle * Math.PI) / 180;
  c.light = [Math.cos(r) * Math.SQRT1_2, -Math.sin(r) * Math.SQRT1_2, Math.SQRT1_2];
  c.relief = s.shadeRelief * Math.max(F.w, F.h) * 0.05; // height change across the frame → slope
  return c;
}
// The colour of a line at document point (x, y) (ax, ay: analysis px), height h, into c.tmp.
function lineColour(F, s, c, x, y, ax, ay, h, isIndex) {
  if (isIndex && c.index) return c.index;
  if (s.lineFrom === "image") {
    const o = sampleRGB(F, ax, ay, c.tmp), L = 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2], b = s.sampleBright;
    for (let ch = 0; ch < 3; ch++) {
      let v = L + (o[ch] - L) * s.sampleSat;
      v = b >= 0 ? v + (255 - v) * b : v * (1 + b);
      o[ch] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    return o;
  }
  if (s.lineFrom === "height") return ramp(c.lineA, c.lineMid, c.lineB, c.shape(h), c.tmp, c.mid);
  if (s.lineFrom === "across") return ramp(c.lineA, c.lineMid, c.lineB, c.shape(c.lineAcross(x, y)), c.tmp, c.mid);
  return c.line;
}

// Renders document rect `rect` (frame px) at scale z into RGBA (round(rect.w·z) × round(rect.h·z)).
// Output pixel (i, j) is the document point rect.x + (i + 0.5)/z, rect.y + (j + 0.5)/z. atlas: the glyph
// atlas for height labels (engine.js prepareAtlas); without it no labels are drawn.
// markAtlas: the atlas for height labels when it differs (the built-in one while the text has its own font).
function render(F, s, rect, z, atlas, markAtlas) {
  const W = Math.max(1, Math.round(rect.w * z)), Hh = Math.max(1, Math.round(rect.h * z));
  const out = new Uint8ClampedArray(W * Hh * 4), c = context(F, s, z), col = [0, 0, 0];
  const contours = s.style !== "ridges" && s.style !== "maze" && s.style !== "points";
  const mAtlas = markAtlas || atlas;
  c.marks = mAtlas && contours ? marksIn(F, s, mAtlas, rect) : [];
  c.gaps = s.labelGap ? c.marks : [];
  if (s.bgMode !== "transparent") {
    for (let j = 0; j < Hh; j++) {
      const y = rect.y + (j + 0.5) / z;
      for (let i = 0; i < W; i++) {
        const o = (j * W + i) * 4, b = s.bgMode === "gradient" ? ramp(c.bg, null, c.bg2, c.bgAcross(rect.x + (i + 0.5) / z, y), col) : c.bg;
        out[o] = b[0]; out[o + 1] = b[1]; out[o + 2] = b[2]; out[o + 3] = 255;
      }
    }
  }
  if (s.style === "ridges") renderRidges(F, s, c, rect, z, W, Hh, out);
  else if (s.style === "maze") renderMaze(F, s, c, rect, z, W, Hh, out);
  else if (s.style === "points") renderPoints(F, s, c, rect, z, W, Hh, out);
  else renderContours(F, s, c, rect, z, W, Hh, out);
  if (atlas && contours && textWanted(s)) drawPathText(F, s, c, atlas, rect, z, W, Hh, out, mAtlas);
  if (c.marks.length) drawMarks(F, s, c, mAtlas, rect, z, W, Hh, out);
  if (contours && s._pickHi != null) drawPickHighlight(F, s, rect, z, W, Hh, out); // preview only: the chosen line
  if (s.followShape && !F.metres && s.style !== "points") { // (the cloud leaves out its points there instead) // nothing where the source is transparent
    const k = F.k;
    for (let j = 0; j < Hh; j++) {
      const ay = (rect.y + (j + 0.5) / z) * k;
      for (let i = 0; i < W; i++) {
        const a = bilinear(F.alpha, F.w, F.h, (rect.x + (i + 0.5) / z) * k, ay);
        if (a < 0.999) out[(j * W + i) * 4 + 3] *= clamp01(a);
      }
    }
  }
  return out;
}

// How the levels are laid out: f = H·n + base + offset, lines where f is whole.
function levelsOf(F, s) {
  if (F.metres && s.mapInterval > 0) { // every mapInterval metres, on round heights
    const span = F.metres.hi - F.metres.lo;
    return { n: span / s.mapInterval, base: F.metres.lo / s.mapInterval };
  }
  return { n: Math.max(1, s.levels), base: 0 };
}

function renderContours(F, s, c, rect, z, W, Hh, out) {
  const k = F.k, { n, base: f0 } = levelsOf(F, s), every = Math.round(s.indexEvery) | 0, gapMin = s.declutter * c.pxOut;
  const band = [0, 0, 0], grad = (n * k) / z; // |∇f| in output px = |∇H| per analysis px × grad
  const shading = s.shade > 0, L = c.light, opaque = s.bgMode !== "transparent", textLines = s.textOn ? textOnLine(s) : null, picks = pickedLines(F, s);
  for (let j = 0; j < Hh; j++) {
    const y = rect.y + (j + 0.5) / z, ay = y * k;
    for (let i = 0; i < W; i++) {
      const x = rect.x + (i + 0.5) / z, ax = x * k, o = (j * W + i) * 4;
      const h = cubic(F.H, F.w, F.h, ax, ay), f = h * n + f0 + s.offset;
      const gxv = bilinear(F.gx, F.w, F.h, ax, ay), gyv = bilinear(F.gy, F.w, F.h, ax, ay);
      if (s.bands !== "none") {
        const b = Math.floor(f);
        if (s.bands === "alternate") { const odd = ((b % 2) + 2) % 2; for (let ch = 0; ch < 3; ch++) band[ch] = odd ? c.bandB[ch] : c.bandA[ch]; }
        else ramp(c.bandA, c.bandMid, c.bandB, s.bands === "smooth" ? h : (b + 0.5 - f0 - s.offset) / n, band);
        over(out, o, band, s.bandOpacity);
      }
      if (shading) { // hill shading: lit slopes lighter, the others darker; flat ground unchanged
        const nx = -bilinear(F.sgx, F.w, F.h, ax, ay) * c.relief, ny = -bilinear(F.sgy, F.w, F.h, ax, ay) * c.relief, len = Math.sqrt(nx * nx + ny * ny + 1);
        const lit = ((nx * L[0] + ny * L[1] + L[2]) / len) / L[2], t = (lit - 1) * s.shade;
        if (opaque || out[o + 3] > 0) for (let ch = 0; ch < 3; ch++) out[o + ch] = t < 0 ? out[o + ch] * (1 + t) : out[o + ch] + (255 - out[o + ch]) * Math.min(1, t);
        else over(out, o, t < 0 ? [0, 0, 0] : [255, 255, 255], Math.min(1, Math.abs(t))); // nothing under it: shadow and light on their own
      }
      if (!(c.base > 0)) continue;
      const g = Math.hypot(gxv, gyv) * grad;
      if (g < 1e-6) continue;
      const lv = Math.round(f), d = Math.abs(f - lv) / g, isIndex = every > 0 && ((lv % every) + every) % every === 0;
      let wpx = isIndex ? c.base * s.indexWidth : c.base;
      if (s.toneWeight) wpx *= weightOf(s.toneWeight, bilinear(F.tone, F.w, F.h, ax, ay));
      if (s.heightWeight) wpx *= weightOf(s.heightWeight, h);
      if (d > wpx / 2 + 1) continue;
      const pk = picks ? pickAt(picks, lv, x, y, (wpx / 2 + 1) / z) : null; // a line you chose
      if (pk && pk.mode === "hide") continue;
      let cov = coverage(d, wpx) * s.lineOpacity;
      if (c.gaps.length) cov *= 1 - gapAt(c.gaps, x, y, z);
      if (gapMin > 0 && !isIndex) cov *= clamp01((1 / g - gapMin * 0.6) / (gapMin * 0.4)); // crowded lines fade out
      if (pk ? pk.mode === "text" || pk.mode === "rain" : textLines && textLines(isIndex)) cov *= s.ptLineOpacity; // the text draws these lines
      if (cov <= 0) continue;
      over(out, o, pk && pk.colorOn ? pk.rgb : lineColour(F, s, c, x, y, ax, ay, h, isIndex), cov);
    }
  }
}

// The lowest height along analysis row ay over the whole frame width (the same for every tile).
function rowFloor(F, ay) {
  let m = Infinity;
  for (let x = 0; x < F.w; x++) m = Math.min(m, cubic(F.H, F.w, F.h, x + 0.5, ay));
  return m;
}
// Ridge lines ("Unknown Pleasures"): rows of horizontal lines lifted by the height; nearer (lower) rows hide
// the ones behind them.
function renderRidges(F, s, c, rect, z, W, Hh, out) {
  const k = F.k, rows = Math.max(2, Math.round(s.rows)), sp = F.fh / (rows + 1); // row spacing in document px
  const lift = s.amp * sp, R = rows + Math.ceil(Math.max(0, s.amp)); // rows below the bottom edge rise into view
  // Y[r][i]: row r's curve in document px at column i - 1 (one extra column each side, for the slope). Kept in
  // document px, so a pixel's distance is computed the same way in every tile.
  const Y = new Float64Array(R * (W + 2)), Wt = new Float32Array(R * (W + 2)), Hv = new Float32Array(R * (W + 2));
  for (let r = 0; r < R; r++) {
    const by = (r + 1) * sp, floor = s.ridgeLocal ? rowFloor(F, by * k) : 0;
    for (let i = -1; i <= W; i++) {
      const ax = (rect.x + (i + 0.5) / z) * k, ay = by * k, q = r * (W + 2) + i + 1, h = cubic(F.H, F.w, F.h, ax, ay);
      Y[q] = by - lift * (h - floor);
      Hv[q] = h;
      let wpx = c.base;
      if (s.toneWeight) wpx *= weightOf(s.toneWeight, bilinear(F.tone, F.w, F.h, ax, ay));
      if (s.heightWeight) wpx *= weightOf(s.heightWeight, h);
      Wt[q] = wpx;
    }
  }
  for (let i = 0; i < W; i++) {
    let top = Infinity; // the highest front curve so far (document px): everything below it is hidden
    const x = rect.x + (i + 0.5) / z, ax = x * k;
    for (let r = R - 1; r >= 0; r--) {
      const q = r * (W + 2) + i + 1, y = Y[q], slope = ((Y[q + 1] - Y[q - 1]) / 2) * z, stretch = Math.sqrt(1 + slope * slope);
      const wpx = Wt[q], reach = (wpx / 2 + 1) * stretch / z; // in document px
      const y0 = Math.max(0, Math.floor((y - reach - rect.y) * z - 0.5)), y1 = Math.min(Hh - 1, Math.ceil((Math.min(y + reach, top + 1 / z) - rect.y) * z - 0.5));
      if (y1 >= y0) {
        const by = (r + 1) * sp, colour = lineColour(F, s, c, x, by, ax, by * k, Hv[q], false);
        for (let j = y0; j <= y1; j++) {
          const py = rect.y + (j + 0.5) / z, vis = clamp01((top - py) * z + 0.5 - wpx / 2); // ends where the front line begins
          if (vis <= 0) continue;
          const cov = coverage((Math.abs(py - y) * z) / stretch, wpx) * vis * s.lineOpacity;
          if (cov > 0) over(out, (j * W + i) * 4, colour, cov);
        }
      }
      if (y < top) top = y;
    }
  }
}

// ---------- labyrinth ----------
// A Turing pattern (the stripes of reaction–diffusion) whose stripe width follows the height: low (dark) ground
// gets close lines, high (light) ground wide ones. Grown once per field on its own grid (cached on F) by
// repeated difference-of-Gaussians: a pixel turns on where its near neighbourhood is brighter than its wider
// one, at the scale its height asks for. The lines are the stripes' edges (u = 0), drawn per pixel like contours.

// Gaussian blur of A (w × h) with sigma in cells, in place: recursive filter (Young & van Vliet), any sigma at
// the same cost.
function gaussIIR(A, w, h, sigma, tmp) {
  if (!(sigma >= 0.5)) return A;
  const q = sigma >= 2.5 ? 0.98711 * sigma - 0.9633 : 3.97156 - 4.14554 * Math.sqrt(1 - 0.26891 * sigma);
  const q2 = q * q, q3 = q2 * q, b0 = 1.57825 + 2.44413 * q + 1.4281 * q2 + 0.422205 * q3;
  const b1 = (2.44413 * q + 2.85619 * q2 + 1.26661 * q3) / b0, b2 = -(1.4281 * q2 + 1.26661 * q3) / b0, b3 = (0.422205 * q3) / b0, B = 1 - (b1 + b2 + b3);
  const line = (o, len, step) => {
    let p1 = A[o], p2 = p1, p3 = p1;
    for (let i = 0; i < len; i++) { const v = B * A[o + i * step] + b1 * p1 + b2 * p2 + b3 * p3; tmp[i] = v; p3 = p2; p2 = p1; p1 = v; }
    p1 = p2 = p3 = tmp[len - 1];
    for (let i = len - 1; i >= 0; i--) { const v = B * tmp[i] + b1 * p1 + b2 * p2 + b3 * p3; A[o + i * step] = v; p3 = p2; p2 = p1; p1 = v; }
  };
  for (let y = 0; y < h; y++) line(y * w, w, 1);
  for (let x = 0; x < w; x++) line(x, h, w);
  return A;
}
const hash01 = (a, b, seed) => {
  let x = Math.imul(a ^ Math.imul(b, 0x27d4eb2d) ^ Math.imul(seed, 0x165667b1), 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};
const MAZE_CELLS = 1100; // the labyrinth grid's long side at most
const MAZE_MIN_PERIOD = 7; // cells per stripe pair at the finest
// The labyrinth of field F: {w, h, cell (document px per cell), U (−1..1), gx, gy (per cell)}.
function mazeField(F, s) {
  const key = [s.mzSpacing, s.mzRange, s.mzCurve, s.mzSeed].join("|");
  if (F._maze && F._maze.key === key) return F._maze;
  const docPx = F.docLong / REF, period = 2 * Math.max(1, s.mzSpacing) * docPx; // document px per stripe pair (two lines)
  const cell = Math.max(period / 9, F.docLong / MAZE_CELLS, 0.75); // (no finer than the document needs)
  const w = Math.max(8, Math.ceil(F.fw / cell)), h = Math.max(8, Math.ceil(F.fh / cell)), n = w * h;
  const pMin = Math.max(MAZE_MIN_PERIOD, period / cell), range = Math.max(1, s.mzRange), ratio = Math.SQRT2;
  const L = Math.max(1, Math.ceil(Math.log(range) / Math.log(ratio) - 1e-9) + 1); // scales: pMin·√2^l
  // each cell's scale (fractional level) from the height under it
  const lev = new Float32Array(n), k = F.k, curve = Math.max(0.05, s.mzCurve || 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = clamp01(bilinear(F.H, F.w, F.h, (x + 0.5) * cell * k, (y + 0.5) * cell * k));
    lev[y * w + x] = Math.min(L - 1, (Math.pow(t, curve) * Math.log(range)) / Math.log(ratio));
  }
  let U = new Float32Array(n);
  const seed = Math.round(s.mzSeed) | 0;
  for (let i = 0; i < n; i++) U[i] = hash01(i % w, (i / w) | 0, seed) * 2 - 1;
  // blurs at sigma = 0.18·period of scale l; the wide blur of scale l (2× sigma) is the near blur of l + 2
  const S = 0.18, blurs = [], tmp = new Float32Array(Math.max(w, h)), d = new Float32Array(n);
  for (let l = 0; l < L + 2; l++) blurs.push(new Float32Array(n));
  for (let it = 0; it < 20; it++) {
    for (let l = 0; l < L + 2; l++) { blurs[l].set(U); gaussIIR(blurs[l], w, h, S * pMin * Math.pow(ratio, l), tmp); }
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const f = lev[i], l0 = Math.floor(f), t = f - l0, l1 = Math.min(L - 1, l0 + 1);
      const v = (blurs[l0][i] - blurs[l0 + 2][i]) * (1 - t) + (blurs[l1][i] - blurs[l1 + 2][i]) * t;
      d[i] = v; ss += v * v;
    }
    const g = 1.5 / (Math.sqrt(ss / n) + 1e-9);
    for (let i = 0; i < n; i++) U[i] = Math.tanh(g * d[i]);
  }
  gaussIIR(U, w, h, 0.6, tmp); // rounder edges to trace
  const [gx, gy] = gradient(U, w, h);
  return (F._maze = { key, w, h, cell, U, gx, gy });
}
function renderMaze(F, s, c, rect, z, W, Hh, out) {
  const M = mazeField(F, s), k = F.k, inv = 1 / M.cell, grad = inv / z; // |∇u| per output px = per cell × grad
  const band = [0, 0, 0];
  for (let j = 0; j < Hh; j++) {
    const y = rect.y + (j + 0.5) / z, my = y * inv, ay = y * k;
    for (let i = 0; i < W; i++) {
      const x = rect.x + (i + 0.5) / z, mx = x * inv, ax = x * k, o = (j * W + i) * 4;
      const u = cubic(M.U, M.w, M.h, mx, my), h = bilinear(F.H, F.w, F.h, ax, ay);
      if (s.bands !== "none") { // the stripes filled: alternate = the two sides, otherwise a gradient by height on the stripes
        if (s.bands === "alternate") { const t = clamp01(0.5 + u * 4); for (let ch = 0; ch < 3; ch++) band[ch] = c.bandB[ch] + (c.bandA[ch] - c.bandB[ch]) * t; }
        else ramp(c.bandA, c.bandMid, c.bandB, h, band);
        over(out, o, band, s.bands === "alternate" ? s.bandOpacity : s.bandOpacity * clamp01(0.5 + u * 4));
      }
      if (!(c.base > 0)) continue;
      const g = Math.hypot(bilinear(M.gx, M.w, M.h, mx, my), bilinear(M.gy, M.w, M.h, mx, my)) * grad;
      if (g < 1e-6) continue;
      const dist = Math.abs(u) / g;
      let wpx = c.base;
      if (s.toneWeight) wpx *= weightOf(s.toneWeight, bilinear(F.tone, F.w, F.h, ax, ay));
      if (s.heightWeight) wpx *= weightOf(s.heightWeight, h);
      if (dist > wpx / 2 + 1) continue;
      const cov = coverage(dist, wpx) * s.lineOpacity;
      if (cov > 0) over(out, o, lineColour(F, s, c, x, y, ax, ay, h, false), cov);
    }
  }
}

// ---------- point cloud ----------
// Points scattered over the frame (denser where the settings ask), each lifted towards the viewer by its height
// and seen through a turned camera. Built once per field and settings (cached on F) in document px, sorted far
// to near and binned, so every tile draws the same points in the same order.
const PC_BIN = 64; // document px
function pointCloud(F, s, c) {
  const key = JSON.stringify([s.pcSpacing, s.pcJitter, s.pcToneDensity, s.pcHeightDensity, s.pcCut, s.pcDepth, s.pcYaw, s.pcPitch, s.pcPersp, s.pcZoom, s.pcSizeNear, s.pcFog, s.pcSeed, s.followShape,
    s.lineWidth, s.toneWeight, s.heightWeight, s.lineFrom, s.lineColor, s.lineA, s.lineMid, s.lineMidOn, s.lineB, s.lineAngle, s.sampleSat, s.sampleBright,
    s.lineGradFrom, s.lineGradTo, s.lineGradMid, s.lineGradCurve, s.lineGradSteps, s.lineGradRepeat, s.lineGradMirror, s.lineGradReverse]);
  if (F._cloud && F._cloud.key === key) return F._cloud;
  const docPx = F.docLong / REF, k = F.k, cx = F.fw / 2, cy = F.fh / 2;
  let sp = Math.max(0.5, s.pcSpacing * docPx);
  while ((F.fw / sp) * (F.fh / sp) > 4e6) sp *= 1.1; // at most ~4 million candidates
  const nx = Math.ceil(F.fw / sp), ny = Math.ceil(F.fh / sp), seed = Math.round(s.pcSeed) | 0;
  const yaw = (s.pcYaw * Math.PI) / 180, pitch = (s.pcPitch * Math.PI) / 180, cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), spt = Math.sin(pitch);
  const depth = s.pcDepth * F.docLong, persp = clamp01(s.pcPersp), D = F.docLong * (0.6 + 6 * (1 - persp) * (1 - persp)), zoom = s.pcZoom;
  const X = [], Y = [], Z = [], R = [], Hs = [], SX = [], SY = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const jx = s.pcJitter * (hash01(i, j, seed * 3 + 1) - 0.5), jy = s.pcJitter * (hash01(i, j, seed * 3 + 2) - 0.5);
    const x = (i + 0.5 + jx) * sp, y = (j + 0.5 + jy) * sp;
    if (x >= F.fw || y >= F.fh) continue;
    const ax = x * k, ay = y * k;
    if (s.followShape && !F.metres && bilinear(F.alpha, F.w, F.h, ax, ay) < 0.5) continue;
    const h = clamp01(cubic(F.H, F.w, F.h, ax, ay));
    if (h < s.pcCut) continue;
    let keep = 1;
    if (s.pcToneDensity) { const t = bilinear(F.tone, F.w, F.h, ax, ay); keep *= s.pcToneDensity > 0 ? 1 - s.pcToneDensity * (1 - t) : 1 + s.pcToneDensity * t; }
    if (s.pcHeightDensity) keep *= s.pcHeightDensity > 0 ? 1 - s.pcHeightDensity * (1 - h) : 1 + s.pcHeightDensity * h;
    if (hash01(i, j, seed * 3 + 3) >= keep) continue;
    // camera space: x right, y down, z away from the viewer; high ground comes forward
    const px0 = x - cx, py0 = y - cy, pz0 = -(h - 0.5) * depth;
    const px1 = px0 * cyw + pz0 * syw, pz1 = -px0 * syw + pz0 * cyw;
    const py2 = py0 * cp - pz1 * spt, pz2 = py0 * spt + pz1 * cp;
    const f = persp > 0 ? D / Math.max(D * 0.05, D + pz2) : 1;
    let r = s.lineWidth * docPx * 0.5 * zoom * Math.pow(f, s.pcSizeNear);
    if (s.toneWeight) r *= weightOf(s.toneWeight, bilinear(F.tone, F.w, F.h, ax, ay));
    if (s.heightWeight) r *= weightOf(s.heightWeight, h);
    if (!(r > 0)) continue;
    X.push(cx + px1 * f * zoom); Y.push(cy + py2 * f * zoom); Z.push(pz2); R.push(r); Hs.push(h); SX.push(x); SY.push(y);
  }
  const n = X.length, order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => Z[b] - Z[a] || a - b); // far first
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) { zmin = Math.min(zmin, Z[i]); zmax = Math.max(zmax, Z[i]); }
  const P = { key, n, X: new Float32Array(n), Y: new Float32Array(n), R: new Float32Array(n), A: new Float32Array(n), C: new Uint8Array(n * 3), rMax: 0 };
  for (let q = 0; q < n; q++) {
    const i = order[q], col = lineColour(F, s, c, X[i], Y[i], SX[i] * k, SY[i] * k, Hs[i], false);
    P.X[q] = X[i]; P.Y[q] = Y[i]; P.R[q] = R[i]; P.rMax = Math.max(P.rMax, R[i]);
    P.A[q] = s.pcFog > 0 && zmax > zmin ? 1 - s.pcFog * ((Z[i] - zmin) / (zmax - zmin)) : 1; // far = faint
    P.C[q * 3] = col[0]; P.C[q * 3 + 1] = col[1]; P.C[q * 3 + 2] = col[2];
  }
  // bins of PC_BIN document px over the frame (points outside it are dropped from the bins)
  const bw = Math.ceil(F.fw / PC_BIN), bh = Math.ceil(F.fh / PC_BIN), counts = new Uint32Array(bw * bh + 1), binOf = new Int32Array(n);
  for (let q = 0; q < n; q++) {
    const bx = Math.floor(P.X[q] / PC_BIN), by = Math.floor(P.Y[q] / PC_BIN);
    binOf[q] = bx >= 0 && by >= 0 && bx < bw && by < bh ? by * bw + bx : -1;
    if (binOf[q] >= 0) counts[binOf[q] + 1]++;
  }
  for (let b = 0; b < bw * bh; b++) counts[b + 1] += counts[b];
  const fillAt = counts.slice(), items = new Uint32Array(counts[bw * bh]);
  for (let q = 0; q < n; q++) if (binOf[q] >= 0) items[fillAt[binOf[q]]++] = q; // in depth order within each bin
  Object.assign(P, { bw, bh, start: counts, items });
  return (F._cloud = P);
}
function renderPoints(F, s, c, rect, z, W, Hh, out) {
  const P = pointCloud(F, s, c), reach = P.rMax + 2 / z, col = [0, 0, 0];
  const bx0 = Math.max(0, Math.floor((rect.x - reach) / PC_BIN)), bx1 = Math.min(P.bw - 1, Math.floor((rect.x + rect.w + reach) / PC_BIN));
  const by0 = Math.max(0, Math.floor((rect.y - reach) / PC_BIN)), by1 = Math.min(P.bh - 1, Math.floor((rect.y + rect.h + reach) / PC_BIN));
  const list = [];
  for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
    const b = by * P.bw + bx;
    for (let t = P.start[b]; t < P.start[b + 1]; t++) list.push(P.items[t]);
  }
  list.sort((a, b) => a - b); // the global far-to-near order
  const square = s.pcShape === "square";
  for (const q of list) {
    const r = P.R[q] * z, px = (P.X[q] - rect.x) * z - 0.5, py = (P.Y[q] - rect.y) * z - 0.5, a = P.A[q] * s.lineOpacity;
    if (a <= 0) continue;
    const i0 = Math.max(0, Math.floor(px - r - 1)), i1 = Math.min(W - 1, Math.ceil(px + r + 1)), j0 = Math.max(0, Math.floor(py - r - 1)), j1 = Math.min(Hh - 1, Math.ceil(py + r + 1));
    if (i0 > i1 || j0 > j1) continue;
    col[0] = P.C[q * 3]; col[1] = P.C[q * 3 + 1]; col[2] = P.C[q * 3 + 2];
    const small = r < 0.5 ? (Math.PI * r * r) / (square ? Math.PI / 4 : 1) : 0; // a dot under a pixel: its area
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      let cov;
      if (small) cov = i === Math.round(px) && j === Math.round(py) ? Math.min(1, square ? 4 * r * r : small) : 0;
      else if (square) cov = clamp01(r + 0.5 - Math.abs(i - px)) * clamp01(r + 0.5 - Math.abs(j - py));
      else cov = clamp01(r + 0.5 - Math.hypot(i - px, j - py));
      if (cov > 0) over(out, (j * W + i) * 4, col, cov * a);
    }
  }
}

// ---------- height labels and spot heights ----------
// Labels are placed once for the whole frame (cached on the field), in document px, so every tile and preview
// draws the same ones. A label sits on a calm stretch of its line (the line stays inside the label's box),
// where the neighbouring lines leave room, and at least labelSpacing from every other label.

// Digit size in the atlas: the rows the digits cover (cap height) and the advance (cell width).
function glyphMetrics(atlas) {
  if (atlas._digits) return atlas._digits;
  let top = atlas.cellH, bottom = 0;
  for (const ch of "0123456789") {
    const g = atlas.index.get(ch);
    if (g === undefined) continue;
    for (let y = 0; y < atlas.cellH; y++) for (let x = 0; x < atlas.cellW; x++) if (atlas.data[g * atlas.cellW * atlas.cellH + y * atlas.cellW + x] > 96) { top = Math.min(top, y); bottom = Math.max(bottom, y + 1); }
  }
  if (bottom <= top) { top = 0; bottom = atlas.cellH; }
  let adv = atlas.cellW;
  if (atlas.adv) { let sum = 0, cnt = 0; atlas.chars.forEach((ch, g) => { if (ch.trim()) { sum += atlas.adv[g]; cnt++; } }); if (cnt) adv = sum / cnt; } // a measured font: its mean advance
  return (atlas._digits = { top, cap: bottom - top, adv });
}
// The height a level (or a point's f value) stands for: metres or feet on a map, the level number otherwise.
function heightText(F, s, f) {
  const L = levelsOf(F, s), lv = f - L.base - s.offset;
  if (!F.metres) return String(Math.round(lv));
  const t = F.metres.invert ? 1 - lv / L.n : lv / L.n;
  let m = F.metres.lo + t * (F.metres.hi - F.metres.lo);
  if (s.labelUnits === "ft") m *= 3.28084;
  return String(Math.round(m));
}
// All labels and spot heights of the frame: [{kind, x, y (document px, centre), tx, ty (baseline direction),
// text, w, h (document px), lv}]. Cached on F per the settings they depend on.
function placeMarks(F, s, atlas) {
  const key = [s.labelsOn, s.labelEvery, s.labelSpacing, s.labelSize, s.labelUphill, s.labelUnits, s.peaks, s.peakSpacing, s.levels, s.mapInterval, s.offset, s.indexEvery, atlas.cellW, atlas.cellH].join("|");
  if (F._marks && F._marks.key === key) return F._marks.list;
  const list = [], gm = glyphMetrics(atlas), docPx = F.docLong / REF, k = F.k; // k: analysis px per document px
  const hDoc = s.labelSize * docPx, sc = hDoc / gm.cap, { n, base } = levelsOf(F, s);
  const fAt = (ax, ay) => cubic(F.H, F.w, F.h, ax, ay) * n + base + s.offset;
  const gAt = (ax, ay) => [bilinear(F.gx, F.w, F.h, ax, ay) * n, bilinear(F.gy, F.w, F.h, ax, ay) * n]; // per analysis px
  const far = (x, y, d) => list.every((m) => (m.x - x) ** 2 + (m.y - y) ** 2 >= d * d);
  const every = Math.round(s.indexEvery) | 0, step = Math.max(1, Math.round(s.labelEvery)) * (every > 0 ? every : 1);
  // spot heights first: they claim their places
  if (s.peaks > 0) {
    const cand = [], H = F.H, w = F.w, h = F.h, edge = Math.round(Math.max(w, h) * 0.03);
    for (let y = edge; y < h - edge; y++) for (let x = edge; x < w - edge; x++) {
      const v = H[y * w + x];
      let top = true;
      for (let dy = -2; dy <= 2 && top; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && H[(y + dy) * w + x + dx] >= v && (H[(y + dy) * w + x + dx] > v || dy < 0 || (dy === 0 && dx < 0))) { top = false; break; }
      if (top) cand.push([v, x, y]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    const gap = s.peakSpacing * docPx;
    for (const [, x, y] of cand) {
      if (list.length >= s.peaks) break;
      const X = (x + 0.5) / k, Y = (y + 0.5) / k;
      if (!far(X, Y, gap)) continue;
      const text = heightText(F, s, fAt(x + 0.5, y + 0.5));
      list.push(boxed({ kind: "peak", x: X, y: Y, tx: 1, ty: 0, text, w: text.length * gm.adv * sc, h: hDoc, sc }));
    }
  }
  if (s.labelsOn) {
    const cand = [], st = Math.max(2, Math.round((hDoc * k) / 2)); // candidate lattice, analysis px
    for (let y = st; y < F.h - st; y += st) for (let x = st; x < F.w - st; x += st) {
      const ax = x + 0.5, ay = y + 0.5, f = fAt(ax, ay), lv = Math.round(f);
      if (((lv % step) + step) % step !== 0) continue;
      const [gx, gy] = gAt(ax, ay), g2 = gx * gx + gy * gy;
      if (g2 < 1e-12) continue;
      const g = Math.sqrt(g2);
      if (Math.abs(f - lv) / g > st * 0.75) continue; // no line of this level nearby
      const px = ax - ((f - lv) * gx) / g2, py = ay - ((f - lv) * gy) / g2; // onto the line
      if (1 / g < hDoc * k * 0.9) continue; // the neighbouring lines are too close (the gap cuts the rest)
      const text = heightText(F, s, lv), wDoc = text.length * gm.adv * sc;
      // baseline along the line; the tops face uphill (towards +f) or are kept readable
      let tx = -gy / g, ty = gx / g;
      const upx = ty, upy = -tx; // "up" for this baseline, in screen coordinates
      if (s.labelUphill ? upx * gx + upy * gy < 0 : tx < -1e-9 || (Math.abs(tx) <= 1e-9 && ty > 0)) { tx = -tx; ty = -ty; }
      // calm: the line stays well inside the label's box along its whole length
      let dev = 0;
      const half = (wDoc * k) / 2 + hDoc * k * 0.3;
      for (let t = -half; t <= half && dev < 1; t += Math.max(1, half / 6)) {
        const qx = px + t * tx, qy = py + t * ty;
        if (qx < 1 || qy < 1 || qx > F.w - 1 || qy > F.h - 1) { dev = 9; break; }
        const [hx, hy] = gAt(qx, qy), gg = Math.hypot(hx, hy);
        dev = Math.max(dev, gg > 1e-9 ? Math.abs(fAt(qx, qy) - lv) / gg / (hDoc * k * 0.45) : 9);
      }
      if (dev >= 1) continue;
      cand.push({ dev, x: px / k, y: py / k, tx, ty, text, w: wDoc, lv });
    }
    cand.sort((a, b) => a.dev - b.dev);
    const gap = s.labelSpacing * docPx;
    for (const m of cand) if (far(m.x, m.y, Math.max(gap, m.w))) list.push(boxed({ kind: "label", x: m.x, y: m.y, tx: m.tx, ty: m.ty, text: m.text, w: m.w, h: hDoc, sc, lv: m.lv }));
  }
  F._marks = { key, list };
  return list;
}
// A mark's layout: tri (the ▲'s size), textX (the text's centre along the baseline) and its box (centre bx, by;
// half sizes bu along the baseline, bv across) with some room around it, for the gap in the lines.
function boxed(m) {
  m.tri = m.kind === "peak" ? m.h * 0.75 : 0;
  m.textX = m.kind === "peak" ? m.tri * 0.75 + m.h * 0.2 + m.w / 2 : 0;
  const u0 = m.kind === "peak" ? -m.tri * 0.6 : -m.w / 2, u1 = m.textX + m.w / 2, uc = (u0 + u1) / 2, pad = m.h * 0.35;
  m.bx = m.x + uc * m.tx; m.by = m.y + uc * m.ty; m.bu = (u1 - u0) / 2 + pad; m.bv = m.h / 2 + pad;
  return m;
}
// The marks that can touch rect (document px).
function marksIn(F, s, atlas, rect) {
  if (!s.labelsOn && !(s.peaks > 0)) return [];
  return placeMarks(F, s, atlas).filter((m) => { const r = Math.hypot(m.bu, m.bv) + 2; return m.bx + r > rect.x && m.bx - r < rect.x + rect.w && m.by + r > rect.y && m.by - r < rect.y + rect.h; });
}
// How much of the point (document px) lies in a label's gap: 0..1, with a one-pixel soft edge.
function gapAt(gaps, x, y, z) {
  let best = 0;
  for (const m of gaps) {
    const dx = x - m.bx, dy = y - m.by, u = Math.abs(dx * m.tx + dy * m.ty) - m.bu, v = Math.abs(-dx * m.ty + dy * m.tx) - m.bv;
    const o = clamp01(0.5 - Math.max(u, v) * z);
    if (o > best) best = o;
  }
  return best;
}
// Draws the labels and spot heights over the lines.
function drawMarks(F, s, c, atlas, rect, z, W, Hh, out) {
  const gm = glyphMetrics(atlas), cw = atlas.cellW, ch = atlas.cellH, own = s.labelColorOn ? hexToRgb(s.labelColor) : null;
  for (const m of c.marks) {
    const k = F.k, colour = own || lineColour(F, s, c, m.x, m.y, m.x * k, m.y * k, cubic(F.H, F.w, F.h, m.x * k, m.y * k), m.kind === "label" && Math.round(s.indexEvery) > 0);
    const col = [colour[0], colour[1], colour[2]];
    // peaks: a triangle with the height to its right
    const tri = m.tri, textX = m.textX, r = Math.hypot(m.bu, m.bv) + 2 / z;
    const i0 = Math.max(0, Math.floor((m.bx - r - rect.x) * z)), i1 = Math.min(W - 1, Math.ceil((m.bx + r - rect.x) * z));
    const j0 = Math.max(0, Math.floor((m.by - r - rect.y) * z)), j1 = Math.min(Hh - 1, Math.ceil((m.by + r - rect.y) * z));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = rect.x + (i + 0.5) / z, y = rect.y + (j + 0.5) / z, dx = x - m.x, dy = y - m.y;
      const u = dx * m.tx + dy * m.ty, v = dx * m.ty - dy * m.tx; // along the baseline; up
      let a = 0;
      if (tri) { // ▲ centred at the peak, pointing up
        const hh = tri, inside = Math.min(v + hh / 2, hh / 2 - v - Math.abs(u) * 1.7) * z;
        a = clamp01(inside + 0.5);
      }
      // text: atlas px from the text box's top-left corner
      const gx = (u - textX + m.w / 2) / m.sc, gy = gm.top + gm.cap / 2 - v / m.sc;
      if (gx >= 0 && gx < m.text.length * cw && gy >= 0 && gy < ch) {
        const ci = Math.floor(gx / cw), g = atlas.index.get(m.text[ci]);
        if (g !== undefined) a = Math.max(a, sampleGlyph(atlas, g, gx - ci * cw, gy) / 255);
      }
      if (a > 0) over(out, (j * W + i) * 4, col, a);
    }
  }
}
function sampleGlyph(atlas, g, x, y) {
  const cw = atlas.cellW, ch = atlas.cellH, d = atlas.data, o = g * cw * ch;
  x -= 0.5; y -= 0.5;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= cw || yy >= ch ? 0 : d[o + yy * cw + xx]);
  return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
}

// ---------- text on the lines ----------
// With textOn the contour lines are written with characters: each line is traced as a polyline (marching
// squares), and the characters are laid along it at an even spacing, turned with the line. The layout is made
// once per field and settings (cached on F, document px) and drawn per pixel, so tiles and previews match.

const hashT = (seed, a, b) => {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(a | 0, 0x85ebca77) ^ Math.imul(b | 0, 0xc2b2ae3d)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
// Which lines get text: (isIndex) → bool.
function textOnLine(s) {
  if (s.ptWhich === "picked") return () => false; // only the lines you chose (ptPicks)
  const index = (Math.round(s.indexEvery) | 0) > 0;
  if (s.ptWhich === "index" && index) return (isIndex) => isIndex;
  if (s.ptWhich === "others" && index) return (isIndex) => !isIndex;
  return () => true;
}
// The contour lines as polylines in document px: [{lv, isIndex, pts: [x0, y0, x1, y1, …], closed}]. Cached on F.
function contourPolylines(F, s) {
  const { n, base } = levelsOf(F, s), every = Math.round(s.indexEvery) | 0, key = [n, base, s.offset, every].join("|");
  if (F._polys && F._polys.key === key) return F._polys.list;
  const list = [], k = F.k, segs = contourSegments(F, n, base + s.offset);
  for (const lv of Array.from(segs.keys()).sort((a, b) => a - b)) {
    const isIndex = every > 0 && ((lv % every) + every) % every === 0;
    for (const poly of stitchContours(segs.get(lv))) {
      if (poly.length < 2) continue;
      const a = poly[0], b = poly[poly.length - 1], closed = poly.length > 3 && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
      const m = closed ? poly.length - 1 : poly.length, pts = new Float64Array(m * 2);
      for (let i = 0; i < m; i++) { pts[i * 2] = (poly[i][0] + 0.5) / k; pts[i * 2 + 1] = (poly[i][1] + 0.5) / k; }
      list.push({ lv, isIndex, pts, closed });
    }
  }
  F._polys = { key, list };
  return list;
}
// Arc-length walker over a polyline: at(t) → [x, y] (t wraps on a closed line, clamps on an open one).
function walker(pts, closed) {
  const m = pts.length / 2, segN = closed ? m : m - 1, cum = new Float64Array(segN + 1);
  for (let i = 0; i < segN; i++) { const j = (i + 1) % m; cum[i + 1] = cum[i] + Math.hypot(pts[j * 2] - pts[i * 2], pts[j * 2 + 1] - pts[i * 2 + 1]); }
  const len = cum[segN];
  const at = (t, o) => {
    if (closed) t = ((t % len) + len) % len; else t = t < 0 ? 0 : t > len ? len : t;
    let lo = 0, hi = segN - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= t) lo = mid; else hi = mid - 1; }
    const i = lo, j = (i + 1) % m, d = cum[i + 1] - cum[i], f = d > 0 ? (t - cum[i]) / d : 0;
    o[0] = pts[i * 2] + (pts[j * 2] - pts[i * 2]) * f; o[1] = pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * f;
    return o;
  };
  return { len, at };
}
// ---------- lines you chose ----------
// Each pick is the contour piece nearest its point (x, y: fractions of the frame), so it follows its line when
// the settings move the lines a little; with `all`, every piece at that line's height. A piece you chose wins
// over a whole height. {list, one: poly index → pick, level: lv → pick, …}, cached on F; null without picks.
function pickedLines(F, s) {
  const picks = s.ptPicks;
  if (!picks || !picks.length) return null;
  const polys = contourPolylines(F, s), key = F._polys.key + "|" + JSON.stringify(picks);
  if (F._picks && F._picks.key === key) return F._picks;
  const one = new Map(), level = new Map(), lvs = new Set();
  const list = picks.map((p) => Object.assign({}, p, { rgb: hexToRgb(p.color || "#e63946") }));
  for (const p of list) {
    const near = nearestLine(polys, p.x * F.fw, p.y * F.fh);
    p.line = near ? near.i : -1;
    if (!near) continue;
    p.lv = polys[near.i].lv;
    if (p.all) { if (!level.has(p.lv)) level.set(p.lv, p); } else if (!one.has(near.i)) { one.set(near.i, p); lvs.add(p.lv); }
  }
  // the single pieces' segments in buckets, to tell per pixel which piece of a height a line pixel belongs to
  const B = 48, bw = Math.ceil(F.fw / B) + 1, bh = Math.ceil(F.fh / B) + 1, buckets = new Map();
  const bx = (x) => Math.min(bw - 1, Math.max(0, Math.floor(x / B))), by = (y) => Math.min(bh - 1, Math.max(0, Math.floor(y / B)));
  for (const i of one.keys()) {
    const P = polys[i], m = P.pts.length / 2, segN = P.closed ? m : m - 1;
    for (let a = 0; a < segN; a++) {
      const b = (a + 1) % m, x0 = P.pts[a * 2], y0 = P.pts[a * 2 + 1], x1 = P.pts[b * 2], y1 = P.pts[b * 2 + 1];
      for (let yy = by(Math.min(y0, y1)); yy <= by(Math.max(y0, y1)); yy++) for (let xx = bx(Math.min(x0, x1)); xx <= bx(Math.max(x0, x1)); xx++) {
        const k = yy * bw + xx; let arr = buckets.get(k); if (!arr) buckets.set(k, (arr = [])); arr.push(i, a);
      }
    }
  }
  F._picks = { key, list, one, level, lvs, polys, B, bw, bh, buckets, bx, by, slack: 1.5 / F.k };
  return F._picks;
}
// The nearest contour piece to document point (x, y): {i, d, x, y (the nearest point on it)} or null.
function nearestLine(polys, x, y) {
  let best = null;
  polys.forEach((P, i) => {
    const m = P.pts.length / 2, segN = P.closed ? m : m - 1;
    for (let a = 0; a < segN; a++) {
      const b = (a + 1) % m, q = segPoint(P.pts[a * 2], P.pts[a * 2 + 1], P.pts[b * 2], P.pts[b * 2 + 1], x, y), d = Math.hypot(q[0] - x, q[1] - y);
      if (!best || d < best.d) best = { i, d, x: q[0], y: q[1] };
    }
  });
  return best;
}
function segPoint(x0, y0, x1, y1, x, y) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
  return [x0 + dx * t, y0 + dy * t];
}
// The pick a line pixel at level lv, document point (x, y) belongs to (r: the line's half width in document px).
function pickAt(P, lv, x, y, r) {
  if (P.lvs.has(lv)) {
    const reach = r + P.slack, x0 = P.bx(x - reach), x1 = P.bx(x + reach), y0 = P.by(y - reach), y1 = P.by(y + reach);
    let best = Infinity, who = null;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const arr = P.buckets.get(yy * P.bw + xx);
      if (!arr) continue;
      for (let q = 0; q < arr.length; q += 2) {
        const Pl = P.polys[arr[q]];
        if (Pl.lv !== lv) continue;
        const m = Pl.pts.length / 2, a = arr[q + 1], b = (a + 1) % m, p = segPoint(Pl.pts[a * 2], Pl.pts[a * 2 + 1], Pl.pts[b * 2], Pl.pts[b * 2 + 1], x, y), d = Math.hypot(p[0] - x, p[1] - y);
        if (d < best) { best = d; who = arr[q]; }
      }
    }
    if (who !== null && best <= reach) return P.one.get(who);
  }
  return P.level.get(lv) || null;
}
// The pick of contour piece i (at level lv), or null.
const pickOf = (P, i, lv) => (P ? P.one.get(i) || P.level.get(lv) || null : null);
// Whether any characters go on the lines: the text on the lines, or a chosen line with text or rain.
function textWanted(s) {
  return !!s.textOn || (s.ptPicks || []).some((p) => p && (p.mode === "text" || p.mode === "rain"));
}
const rainWanted = (s) => (s.textOn && s.textMode === "rain") || (s.ptPicks || []).some((p) => p && p.mode === "rain");
// The rain's characters.
function rainChars(s) {
  const p = Engine.parseCustom(String(s.prChars || "")), all = p.text + (p.fill ? p.fill.items.join("") : "");
  const set = Array.from(new Set(Array.from(all))).filter((ch) => ch.trim());
  return set.length ? set : ["0", "1"];
}
// textMode "set": the set's characters (no blanks).
function setChars(s) {
  const cs = CHARSETS.find((c) => c.id === s.ptSet) || CHARSETS.find((c) => c.id === "bourke");
  return Array.from(new Set(Array.from(cs.chars))).filter((ch) => ch.trim());
}
// ptText's rows: one text per height, lowest line first (trailing empty rows dropped; one row = every line).
function textRows(s) {
  const rows = String(s.ptText || "").split(/\r?\n/);
  while (rows.length > 1 && !rows[rows.length - 1].trim()) rows.pop();
  return rows;
}
// The characters the text needs (for an atlas that has them all).
function textChars(s) {
  let t = "";
  if (s.textOn && s.textMode === "direction") t = "-\\|/";
  else if (s.textOn && s.textMode === "set") t = setChars(s).join("");
  else if (s.textOn && s.textMode !== "rain") t = textRows(s).join("").replace(/%h/g, "") + "0123456789-";
  const own = (s.ptPicks || []).filter((p) => p && p.mode === "text" && p.text).map((p) => p.text).join("");
  if (own) t += own.replace(/%h/g, "") + "0123456789-";
  if (rainWanted(s)) t += rainChars(s).join("");
  if (s.ptPicks && s.ptPicks.some((p) => p && p.mode === "text" && !p.text) && s.textMode === "text") t += textRows(s).join("").replace(/%h/g, "") + "0123456789-";
  if (t && s.ptFont) t += "0123456789"; // (a font's size is set by its digits)
  return t;
}
// Preview only: the chosen line s.ptPicks[s._pickHi] drawn over everything in a bright colour.
function drawPickHighlight(F, s, rect, z, W, Hh, out) {
  const P = pickedLines(F, s), p = P && P.list[s._pickHi];
  if (!p || p.line < 0) return;
  const lines = p.all ? P.polys.filter((l) => l.lv === p.lv) : [P.polys[p.line]], half = 1.6 / z, col = [255, 43, 214];
  for (const l of lines) {
    const m = l.pts.length / 2, segN = l.closed ? m : m - 1;
    for (let a = 0; a < segN; a++) {
      const b = (a + 1) % m, x0 = l.pts[a * 2], y0 = l.pts[a * 2 + 1], x1 = l.pts[b * 2], y1 = l.pts[b * 2 + 1];
      const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - half - rect.x) * z)), i1 = Math.min(W - 1, Math.ceil((Math.max(x0, x1) + half - rect.x) * z));
      const j0 = Math.max(0, Math.floor((Math.min(y0, y1) - half - rect.y) * z)), j1 = Math.min(Hh - 1, Math.ceil((Math.max(y0, y1) + half - rect.y) * z));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = rect.x + (i + 0.5) / z, y = rect.y + (j + 0.5) / z, q = segPoint(x0, y0, x1, y1, x, y), d = Math.hypot(q[0] - x, q[1] - y) * z;
        if (d < 2.2) { const o = (j * W + i) * 4; out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255; }
      }
    }
  }
}
// What one line writes: next() → a character (" " = a gap) and whether it belongs to a {message}.
// Plain text repeats; with a [ ] fill the plain text comes once at the start, then the fill items repeat.
function lineStream(spec, heightStr, seed, lineNo, msgs) {
  const sub = (t) => t.replace(/%h/g, heightStr);
  let plain = Array.from(sub(spec.text));
  if (plain.length && !spec.fill && plain[plain.length - 1] !== " ") plain.push(" ");
  const items = spec.fill ? spec.fill.items.map((t) => Array.from(sub(t)).concat(spec.fill.sep ? [" "] : [])) : null;
  let slot = 0, q = 0, queue = [], n = 0, inPlain = true;
  return () => {
    const m = msgs && msgs.find((mm) => slot >= mm.at && slot < mm.at + mm.chars.length);
    if (m) { const ch = m.chars[slot - m.at]; slot++; return [ch, true]; }
    slot++;
    if (inPlain && plain.length) {
      if (q < plain.length) return [plain[q++], false];
      if (items) { inPlain = false; q = 0; } else { q = 1; return [plain[0], false]; }
    }
    if (!items) return [" ", false];
    if (q >= queue.length) { queue = spec.fill.random ? items[Math.floor(hashT(seed, lineNo * 7919 + n, 11) * items.length)] : items[n % items.length]; n++; q = 0; }
    return [queue[q++], false];
  };
}
// The layout: every character's centre (x, y, document px), direction (cos, sin), glyph, height and flags
// (1 index line, 2 message), plus buckets for finding the ones near a rect. Cached on F.
function pathGlyphs(F, s, atlas, markAtlas) {
  const mAtlas = markAtlas || atlas; // the labels' glyphs (for the gaps under them)
  const polys = contourPolylines(F, s);
  const picks = pickedLines(F, s), rain = rainWanted(s);
  const key = [F._polys.key, s.textOn, s.textMode, s.ptText, s.textMode === "set" ? s.ptSet : "", s.ptSize, s.ptSpacing, s.ptWhich, s.ptRotate, s.ptVertical, s.ptReadable, s.ptRoom, s.ptSeed, s.labelUnits,
    s.labelGap, s.labelsOn, s.labelEvery, s.labelSpacing, s.labelSize, s.labelUphill, s.peaks, s.peakSpacing, picks ? picks.key : "",
    rain ? [s.prChars, s.prLength, s.prLengthVar, s.prGaps, s.prFade, s.prHead, s.prHeadColor, s.prColorOn, s.prColor, s.prReverse, s.prSeed].join("/") : ""].join("|");
  if (F._pt && F._pt.key === key && F._pt.atlas === atlas && F._pt.mAtlas === mAtlas) return F._pt;
  const gm = glyphMetrics(atlas), docPx = F.docLong / REF, size = Math.max(1, s.ptSize) * docPx, sc = size / gm.cap;
  const vert = !!s.ptVertical && s.textMode !== "direction"; // vertical type: stacked at the cap height plus some leading
  const prop = !!atlas.adv && !vert && s.textMode !== "direction"; // proportional text (a measured font)
  const adv = Math.max(0.2, s.ptSpacing) * (vert ? gm.cap * 1.35 : gm.adv) * sc, which = s.textOn ? textOnLine(s) : () => false, dir = s.textMode === "direction", k = F.k;
  const { n } = levelsOf(F, s), room = s.ptRoom * size, gaps = s.labelGap ? (s.labelsOn || s.peaks > 0 ? placeMarks(F, s, mAtlas) : []) : [];
  // the text of each height: ptText's rows (or the set's characters at random), lowest line first, repeating
  const rows = textRows(s), minLv = polys.reduce((m, P) => Math.min(m, P.lv), Infinity);
  const specs = dir || s.textMode === "rain" ? [] : s.textMode === "set" ? [{ text: "", messages: [], fill: { items: setChars(s), random: true, sep: "" } }]
    : rows.map((r) => (rows.length > 1 && !r.trim() ? null : Engine.parseCustom(r)));
  const specAt = (lv) => (specs.length ? specs[(((lv - minLv) % specs.length) + specs.length) % specs.length] : null), own = new Map(); // own: a chosen line's text → its spec
  const X = [], Y = [], C = [], S = [], G = [], Hs = [], FL = [], A = [], K = [], OX = [], p = [0, 0], q0 = [0, 0], q1 = [0, 0];
  // each line: what it writes (kind "text" with its spec, "dir" or "rain"; null = no characters)
  const lines = polys.map((P, i) => {
    const pk = pickOf(picks, i, P.lv);
    let kind = null, sp = null;
    if (pk ? pk.mode === "rain" : which(P.isIndex) && s.textMode === "rain") kind = "rain";
    else if (pk && pk.mode === "text" && pk.text) { kind = "text"; if (!own.has(pk.text)) own.set(pk.text, Engine.parseCustom(pk.text)); sp = own.get(pk.text); }
    else if (pk ? pk.mode === "text" : which(P.isIndex)) {
      kind = dir ? "dir" : s.textMode === "rain" ? "rain" : "text"; sp = specAt(P.lv);
      if (kind === "text" && !sp) kind = null; // an empty row: no text at this height
    }
    return { P, i, pk, kind, spec: sp, w: kind ? walker(P.pts, P.closed) : null };
  });
  // a character's place at arc length d along line l (half: half its advance; sign: the way the text runs):
  // centre, direction and whether it can show there (Room: not on a line you chose; label gaps)
  const slotAt = (l, d, half, sign) => {
    const w = l.w;
    w.at(d, p); w.at(d - half, q0); w.at(d + half, q1);
    let tx = (q1[0] - q0[0]) * sign, ty = (q1[1] - q0[1]) * sign;
    const tl = Math.hypot(tx, ty), ax = p[0] * k, ay = p[1] * k;
    let ok = tl > 1e-9;
    if (ok) { tx /= tl; ty /= tl; }
    if (ok && room > 0 && !l.pk) { const g = Math.hypot(bilinear(F.gx, F.w, F.h, ax, ay), bilinear(F.gy, F.w, F.h, ax, ay)) * n * k; if (g > 0 && 1 / g < room) ok = false; }
    if (ok && gaps.length && gapAt(gaps, p[0], p[1], 1e9) > 0) ok = false;
    return { x: p[0], y: p[1], tx, ty, ok };
  };
  // 1. the slots of every line: centre, direction and whether a character can show there
  for (const l of lines) {
    const { P, w } = l;
    l.slots = [];
    if (!w || w.len < adv * 2) continue;
    // runs of the line and which way the text goes along each: [t0, t1, sign]. Readable: the text always runs
    // left to right and turns round where the line does (with some hysteresis); uphill: one way, tops uphill.
    const runs = []; // (Room leaves a line you chose alone: it gets its text wherever it goes)
    if (s.ptReadable || l.kind === "dir") {
      const step = adv / 2, N = Math.max(1, Math.floor(w.len / step));
      let sign = 0, from = 0;
      for (let a = 0; a <= N; a++) {
        const d = Math.min(w.len, a * step);
        w.at(d - adv / 2, q0); w.at(d + adv / 2, q1);
        const tx = q1[0] - q0[0], ty = q1[1] - q0[1], tl = Math.hypot(tx, ty) || 1, cx = tx / tl, cy = ty / tl;
        // horizontal text runs to the right; vertical text downwards, tilted a little to the right, so lines
        // that run across the picture all stack the same way
        const along = vert ? cx * 0.5 + cy * 0.866 : cx, across = vert ? cy * 0.5 - cx * 0.866 : cy;
        const want = sign === 0 ? (Math.abs(along) > 0.2 ? Math.sign(along) : across > 0 ? -1 : 1) : sign > 0 ? (along < -0.35 ? -1 : 1) : (along > 0.35 ? 1 : -1);
        if (sign === 0) sign = want;
        else if (want !== sign) { runs.push([from, d, sign]); from = d; sign = want; }
      }
      runs.push([from, w.len, sign]);
      if (P.closed && runs.length > 1 && runs[0][2] === runs[runs.length - 1][2]) { const last = runs.pop(); runs[0][0] = last[0] - w.len; } // join across the start
    } else {
      w.at(w.len / 2, p); w.at(w.len / 2 + 1, q1);
      const tx = q1[0] - p[0], ty = q1[1] - p[1], ax = p[0] * k, ay = p[1] * k;
      runs.push([0, w.len, ty * bilinear(F.gx, F.w, F.h, ax, ay) - tx * bilinear(F.gy, F.w, F.h, ax, ay) < 0 ? -1 : 1]); // up = (ty, −tx) should face +f
    }
    l.runs = runs;
    for (const [t0, t1, sign] of runs) {
      const slots = Math.floor((t1 - t0) / adv);
      if (slots < 1) continue;
      const start = t0 + (t1 - t0 - slots * adv) / 2 + adv / 2;
      for (let u = 0; u < slots; u++) {
        const d = sign > 0 ? start + u * adv : start + (slots - 1 - u) * adv, sl = slotAt(l, d, adv / 2, sign);
        sl.first = u === 0; sl.d = d;
        l.slots.push(sl);
      }
    }
  }
  // 2. where the {messages} go: hashed onto stretches of slots that all show (within one run), at a hashed place
  const msgsOf = new Map();
  let r = 0;
  for (const sp of Array.from(new Set(specs)).concat(Array.from(own.values()))) {
    if (!sp || !sp.messages.length) continue;
    for (const msg of sp.messages) {
      const chars = Array.from(msg.text), need = chars.length;
      const fits = []; // [line, first slot of a free stretch, its length]
      for (const l of lines) {
        if (l.spec !== sp) continue;
        let a = -1; // start of the current stretch
        for (let j = 0; j <= l.slots.length; j++) {
          const sl = l.slots[j];
          if (a >= 0 && (!sl || !sl.ok || sl.first)) { if (j - a >= need) fits.push([l, a, j - a]); a = -1; }
          if (sl && sl.ok && a < 0) a = j;
        }
      }
      for (let c = 0; c < msg.count && fits.length; c++, r++) {
        const [l, a, len] = fits[Math.floor(hashT(s.ptSeed, r, 21) * fits.length)], at = a + Math.floor(hashT(s.ptSeed, r, 22) * (len - need + 1));
        if (!msgsOf.has(l.i)) msgsOf.set(l.i, []);
        msgsOf.get(l.i).push({ at, chars });
      }
    }
  }
  // 3. the characters: each line's text runs through all its slots; the ones that show become glyphs
  const rainSet = rain ? rainChars(s) : null, headRgb = hexToRgb(s.prHeadColor), rainRgb = s.prColorOn ? hexToRgb(s.prColor) : null;
  for (const l of lines) {
    if (!l.slots.length) continue;
    const upright = l.kind === "dir" || !s.ptRotate, ownRgb = l.pk && l.pk.colorOn ? l.pk.rgb : null;
    const put = (sl, g, fl, a, rgb, ox) => {
      // the glyph's x axis (cos, sin): along the line, or for vertical type across it (its down then runs along the line)
      const co = upright ? 1 : vert ? sl.ty : sl.tx, si = upright ? 0 : vert ? -sl.tx : sl.ty, o = ox || 0; // ox: cell centre past the character's centre, along its x axis
      X.push(sl.x + co * o); Y.push(sl.y + si * o); C.push(co); S.push(si); G.push(g); OX.push(o);
      Hs.push(cubic(F.H, F.w, F.h, sl.x * k, sl.y * k)); FL.push((l.P.isIndex ? 1 : 0) | fl); A.push(a); K.push(rgb);
    };
    if (prop && l.kind === "text") { // a measured font: each character as wide as it is, centred in each run
      const next = lineStream(l.spec, heightText(F, s, l.P.lv), s.ptSeed, l.i, msgsOf.get(l.i)), sp = Math.max(0.2, s.ptSpacing), minA = size * 0.05;
      for (const [t0, t1, sign] of l.runs || []) {
        const len = t1 - t0, row = [];
        let used = 0;
        for (;;) {
          const [ch, isMsg] = next(), g = atlas.index.get(ch), a = Math.max(minA, (g === undefined ? 0 : atlas.adv[g]) * sc * sp);
          if (used + a > len) break;
          row.push([ch, isMsg, g, a]); used += a;
        }
        let pen = (len - used) / 2;
        for (const [ch, isMsg, g, a] of row) {
          const d = sign > 0 ? t0 + pen + a / 2 : t1 - pen - a / 2;
          pen += a;
          if (ch === " " || g === undefined) continue;
          const sl = slotAt(l, d, Math.max(a, adv) / 2, sign);
          if (!sl.ok && !(isMsg && sl.tx * sl.tx + sl.ty * sl.ty > 0.5)) continue; // (a message shows wherever it landed)
          put(sl, g, isMsg ? 2 : 0, 1, ownRgb, (atlas.cellW / 2 - atlas.ox[g] - atlas.adv[g] / 2) * sc);
        }
      }
      continue;
    }
    if (l.kind === "rain") { // streams laid along the line by arc length, each brightest at its head
      const len = l.w.len, mean = Math.max(1, s.prLength) * adv, streams = [];
      let pos = -hashT(s.prSeed, l.i, 41) * mean, n = 0;
      while (pos < len) {
        const sl = Math.max(adv, mean * (1 - s.prLengthVar * hashT(s.prSeed, l.i * 7919 + n, 42)));
        streams.push(pos, pos + sl);
        pos += sl + sl * s.prGaps * (0.5 + hashT(s.prSeed, l.i * 7919 + n, 43));
        n++;
      }
      l.slots.forEach((sl, u) => {
        if (!sl.ok) return;
        const d = l.P.closed ? ((sl.d % len) + len) % len : sl.d;
        let a0 = -1, a1 = 0;
        for (let q = 0; q < streams.length; q += 2) if (d >= streams[q] && d < streams[q + 1]) { a0 = streams[q]; a1 = streams[q + 1]; break; }
        if (a0 < 0) return;
        const t = s.prReverse ? (a1 - d) / (a1 - a0) : (d - a0) / (a1 - a0), head = (s.prReverse ? d - a0 : a1 - d) <= adv;
        const g = atlas.index.get(rainSet[Math.floor(hashT(s.prSeed, l.i * 7919 + u, 44) * rainSet.length)]);
        if (g === undefined) return;
        const a = s.prFade > 0 ? Math.pow(Math.max(0, t), s.prFade * 2.5) : 1;
        if (a < 0.02 && !head) return;
        put(sl, g, 4, head ? 1 : a, head && s.prHead ? headRgb : rainRgb || ownRgb);
      });
      continue;
    }
    const isDir = l.kind === "dir", next = isDir ? null : lineStream(l.spec, heightText(F, s, l.P.lv), s.ptSeed, l.i, msgsOf.get(l.i));
    for (const sl of l.slots) {
      const [ch, isMsg] = isDir ? ["", false] : next();
      if (!sl.ok) continue;
      let c = ch;
      if (isDir) { let a = Math.atan2(sl.ty, sl.tx); if (a < 0) a += Math.PI; c = a < Math.PI / 8 || a >= (7 * Math.PI) / 8 ? "-" : a < (3 * Math.PI) / 8 ? "\\" : a < (5 * Math.PI) / 8 ? "|" : "/"; }
      if (c === " ") continue;
      const g = atlas.index.get(c);
      if (g === undefined) continue;
      put(sl, g, isMsg ? 2 : 0, 1, ownRgb);
    }
  }
  // buckets by centre
  const B = Math.max(8, size * 4), bw = Math.ceil(F.fw / B) + 1, bh = Math.ceil(F.fh / B) + 1, buckets = new Map();
  for (let q = 0; q < X.length; q++) {
    const bk = Math.min(bh - 1, Math.max(0, Math.floor(Y[q] / B))) * bw + Math.min(bw - 1, Math.max(0, Math.floor(X[q] / B)));
    let a = buckets.get(bk); if (!a) buckets.set(bk, (a = [])); a.push(q);
  }
  F._pt = { key, atlas, mAtlas, n: X.length, X, Y, C, S, G, Hs, FL, A, K, OX, sc, size, B, bw, bh, buckets, r: (Math.hypot(atlas.cellW, atlas.cellH) / 2) * sc };
  return F._pt;
}
// The characters whose box can touch rect (document px), in layout order.
function pathGlyphsIn(P, rect) {
  const r = P.r + 1, out = [];
  const bx0 = Math.max(0, Math.floor((rect.x - r) / P.B)), bx1 = Math.min(P.bw - 1, Math.floor((rect.x + rect.w + r) / P.B));
  const by0 = Math.max(0, Math.floor((rect.y - r) / P.B)), by1 = Math.min(P.bh - 1, Math.floor((rect.y + rect.h + r) / P.B));
  for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
    const a = P.buckets.get(by * P.bw + bx);
    if (a) for (const q of a) if (P.X[q] + r > rect.x && P.X[q] - r < rect.x + rect.w && P.Y[q] + r > rect.y && P.Y[q] - r < rect.y + rect.h) out.push(q);
  }
  return out.sort((a, b) => a - b);
}
function drawPathText(F, s, c, atlas, rect, z, W, Hh, out, markAtlas) {
  const P = pathGlyphs(F, s, atlas, markAtlas);
  if (!P.n) return;
  const cw = atlas.cellW, gm = glyphMetrics(atlas), vc = gm.top + gm.cap / 2, sc = P.sc, k = F.k;
  const ss = Math.min(4, Math.max(1, Math.ceil(1 / (sc * z) / 1.5))), inv = 1 / (ss * ss * 255); // supersampling when the characters are small
  const msgCol = s.ptMsgColorOn ? hexToRgb(s.ptMsgColor) : null, col = [0, 0, 0], r = P.r + 1 / z;
  for (const q of pathGlyphsIn(P, rect)) {
    const x0 = P.X[q], y0 = P.Y[q], co = P.C[q], si = P.S[q], g = P.G[q], fl = P.FL[q];
    const colour = fl & 2 && msgCol ? msgCol : P.K[q] || lineColour(F, s, c, x0, y0, x0 * k, y0 * k, P.Hs[q], !!(fl & 1)), alpha = P.A[q] * s.lineOpacity;
    col[0] = colour[0]; col[1] = colour[1]; col[2] = colour[2];
    const i0 = Math.max(0, Math.floor((x0 - r - rect.x) * z)), i1 = Math.min(W - 1, Math.ceil((x0 + r - rect.x) * z));
    const j0 = Math.max(0, Math.floor((y0 - r - rect.y) * z)), j1 = Math.min(Hh - 1, Math.ceil((y0 + r - rect.y) * z));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      let acc = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const dx = rect.x + (i + (sx + 0.5) / ss) / z - x0, dy = rect.y + (j + (sy + 0.5) / ss) / z - y0;
        const gx = (dx * co + dy * si) / sc + cw / 2, gy = (dy * co - dx * si) / sc + vc;
        if (gx > -1 && gx < cw + 1 && gy > -1 && gy < atlas.cellH + 1) acc += sampleGlyph(atlas, g, gx, gy);
      }
      if (acc > 0) over(out, (j * W + i) * 4, col, Math.min(1, acc * inv) * alpha);
    }
  }
}

// RGB of RGBA `px` over RGB `under` (both n pixels), for the preview.
function composite(px, under, n) {
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = px[i * 4 + c] * a + under[i * 3 + c] * (1 - a);
  }
  return out;
}
// The source's own colours at analysis resolution for rect at z (RGB), for previews over a transparent layer.
function sourceRGB(F, rect, z) {
  const W = Math.max(1, Math.round(rect.w * z)), Hh = Math.max(1, Math.round(rect.h * z)), out = new Uint8Array(W * Hh * 3), c = [0, 0, 0];
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const ax = (rect.x + (i + 0.5) / z) * F.k, ay = (rect.y + (j + 0.5) / z) * F.k, a = bilinear(F.alpha, F.w, F.h, ax, ay);
    sampleRGB(F, ax, ay, c);
    for (let ch = 0; ch < 3; ch++) out[(j * W + i) * 3 + ch] = c[ch] * a + 255 * (1 - a); // transparent shows as white
  }
  return out;
}

const rgbToHex = (r, g, b) => "#" + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);

function simplifyPoly(poly, tol) {
  if (poly.length <= 2) return poly;
  const out = [poly[0]];
  for (let i = 1; i < poly.length - 1; i++) {
    const prev = out[out.length - 1], curr = poly[i], next = poly[i + 1];
    const dx = next[0] - prev[0], dy = next[1] - prev[1], len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    const dist = Math.abs((curr[0] - prev[0]) * dy - (curr[1] - prev[1]) * dx) / len;
    if (dist >= tol) out.push(curr);
  }
  out.push(poly[poly.length - 1]);
  return out;
}

function stitchContours(segs) {
  if (!segs.length) return [];
  const lines = [], Q = 100;
  const key = (p) => Math.round(p[0] * Q) * 4194304 + Math.round(p[1] * Q); // exact up to 41943 px
  const startMap = new Map(), endMap = new Map();
  const unvis = new Uint8Array(segs.length / 2);
  unvis.fill(1);
  for (let i = 0; i < segs.length; i += 2) {
    const si = i >> 1, sk = key(segs[i]), ek = key(segs[i + 1]);
    let sl = startMap.get(sk); if (!sl) startMap.set(sk, (sl = [])); sl.push(si);
    let el = endMap.get(ek); if (!el) endMap.set(ek, (el = [])); el.push(si);
  }
  for (let i = 0; i < unvis.length; i++) {
    if (!unvis[i]) continue;
    unvis[i] = 0;
    const poly = [segs[i * 2], segs[i * 2 + 1]];
    let curr = poly[poly.length - 1];
    while (true) {
      const ck = key(curr), nexts = startMap.get(ck);
      let found = false;
      if (nexts) {
        for (let j = 0; j < nexts.length; j++) {
          const idx = nexts[j];
          if (unvis[idx]) { unvis[idx] = 0; curr = segs[idx * 2 + 1]; poly.push(curr); found = true; break; }
        }
      }
      if (!found) {
        const revs = endMap.get(ck);
        if (revs) {
          for (let j = 0; j < revs.length; j++) {
            const idx = revs[j];
            if (unvis[idx]) { unvis[idx] = 0; curr = segs[idx * 2]; poly.push(curr); found = true; break; }
          }
        }
      }
      if (!found) break;
    }
    curr = poly[0];
    while (true) {
      const ck = key(curr), prevs = endMap.get(ck);
      let found = false;
      if (prevs) {
        for (let j = 0; j < prevs.length; j++) {
          const idx = prevs[j];
          if (unvis[idx]) { unvis[idx] = 0; curr = segs[idx * 2]; poly.unshift(curr); found = true; break; }
        }
      }
      if (!found) {
        const revs = startMap.get(ck);
        if (revs) {
          for (let j = 0; j < revs.length; j++) {
            const idx = revs[j];
            if (unvis[idx]) { unvis[idx] = 0; curr = segs[idx * 2 + 1]; poly.unshift(curr); found = true; break; }
          }
        }
      }
      if (!found) break;
    }
    lines.push(poly);
  }
  return lines;
}

// Marching squares on the height field: line segments per level (f = H·n + f0 whole), as point pairs in analysis
// grid coordinates (sample (x, y) of F.H sits at analysis px x + 0.5, y + 0.5).
function contourSegments(F, n, f0) {
  const w = F.w, h = F.h, Hfield = F.H, segsByLevel = new Map();

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v0 = Hfield[y * w + x], v1 = Hfield[y * w + x + 1], v2 = Hfield[(y + 1) * w + x + 1], v3 = Hfield[(y + 1) * w + x];
      const minV = Math.min(v0, v1, v2, v3), maxV = Math.max(v0, v1, v2, v3);
      const minL = Math.ceil(minV * n + f0), maxL = Math.floor(maxV * n + f0);
      if (minL > maxL) continue;

      for (let lv = minL; lv <= maxL; lv++) {
        const th = (lv - f0) / n;
        const code = (v0 >= th ? 1 : 0) | (v1 >= th ? 2 : 0) | (v2 >= th ? 4 : 0) | (v3 >= th ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const pTop = [x + (th - v0) / (v1 - v0), y];
        const pRight = [x + 1, y + (th - v1) / (v2 - v1)];
        const pBot = [x + (th - v3) / (v2 - v3), y + 1];
        const pLeft = [x, y + (th - v0) / (v3 - v0)];
        let list = segsByLevel.get(lv);
        if (!list) segsByLevel.set(lv, (list = []));
        switch (code) {
          case 1: case 14: list.push(pLeft, pTop); break;
          case 2: case 13: list.push(pTop, pRight); break;
          case 3: case 12: list.push(pLeft, pRight); break;
          case 4: case 11: list.push(pRight, pBot); break;
          case 5:
            if ((v0 + v1 + v2 + v3) / 4 >= th) list.push(pLeft, pTop, pRight, pBot);
            else list.push(pLeft, pBot, pTop, pRight);
            break;
          case 6: case 9: list.push(pTop, pBot); break;
          case 7: case 8: list.push(pLeft, pBot); break;
          case 10:
            if ((v0 + v1 + v2 + v3) / 4 >= th) list.push(pTop, pRight, pLeft, pBot);
            else list.push(pLeft, pTop, pRight, pBot);
            break;
        }
      }
    }
  }
  return segsByLevel;
}

// Exports the line art to an SVG vector string.
function toSVG(F, s, atlas, markAtlas) {
  const W = F.fw, H = F.fh, px = F.docLong / REF;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`];
  if (s.bgMode !== "transparent") out.push(`<rect width="100%" height="100%" fill="${s.bgColor}"/>`);

  const c = context(F, s, 1);

  if (s.style === "maze") { // the stripes' edges: one path per traced line, coloured at its first point
    const M = mazeField(F, s), k = F.k, segs = contourSegments({ w: M.w, h: M.h, H: M.U }, 0.5, 0).get(0) || [];
    const op = s.lineOpacity < 1 ? ` stroke-opacity="${s.lineOpacity}"` : "", lw = (s.lineWidth * px).toFixed(2);
    out.push(`<g id="labyrinth" fill="none" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"${op}>`);
    if (s.lineWidth > 0) for (const poly of stitchContours(segs)) {
      if (poly.length < 2) continue;
      const sp = simplifyPoly(poly, 0.15), P = (q) => [(q[0] + 0.5) * M.cell, (q[1] + 0.5) * M.cell];
      const [x0, y0] = P(sp[0]), col = rgbToHex(...lineColour(F, s, c, x0, y0, x0 * k, y0 * k, bilinear(F.H, F.w, F.h, x0 * k, y0 * k), false));
      let d = `M${x0.toFixed(1)} ${y0.toFixed(1)}`;
      for (let i = 1; i < sp.length; i++) { const [x, y] = P(sp[i]); d += `L${x.toFixed(1)} ${y.toFixed(1)}`; }
      out.push(`<path d="${d}" stroke="${col}"/>`);
    }
    out.push(`</g>`);
  } else if (s.style === "points") { // far to near, like the render
    const P = pointCloud(F, s, c), square = s.pcShape === "square";
    out.push(`<g id="points">`);
    for (let q = 0; q < P.n; q++) {
      const a = P.A[q] * s.lineOpacity, x = P.X[q], y = P.Y[q], r = P.R[q];
      if (a <= 0 || x + r < 0 || y + r < 0 || x - r > W || y - r > H) continue;
      const fill = rgbToHex(P.C[q * 3], P.C[q * 3 + 1], P.C[q * 3 + 2]), op = a < 1 ? ` fill-opacity="${a.toFixed(3)}"` : "";
      out.push(square ? `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${(2 * r).toFixed(2)}" height="${(2 * r).toFixed(2)}" fill="${fill}"${op}/>`
        : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${fill}"${op}/>`);
    }
    out.push(`</g>`);
  } else if (s.style === "ridges") {
    const k = F.k, rows = Math.max(2, Math.round(s.rows)), sp = F.fh / (rows + 1);
    const lift = s.amp * sp, R = rows + Math.ceil(Math.max(0, s.amp));
    const bgFill = s.bgMode !== "transparent" ? s.bgColor : "none";
    const wpx = (s.lineWidth * px).toFixed(1);
    const op = s.lineOpacity < 1 ? ` stroke-opacity="${s.lineOpacity}"` : "";
    const dx = Math.max(1, Math.round(W / 600));

    out.push(`<g id="ridges">`);
    for (let r = 0; r < R; r++) {
      const by = (r + 1) * sp, floor = s.ridgeLocal ? rowFloor(F, by * k) : 0;
      const pts = [];
      for (let x = 0; x <= W; x += dx) {
        const ax = x * k, ay = by * k;
        const h = cubic(F.H, F.w, F.h, ax, ay);
        const y = by - lift * (h - floor);
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      if (bgFill !== "none") out.push(`<polygon points="0,${H} ${pts.join(" ")} ${W},${H}" fill="${bgFill}"/>`);
      out.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${s.lineColor}" stroke-width="${wpx}" stroke-linecap="round" stroke-linejoin="round"${op}/>`);
    }
    out.push(`</g>`);
  } else {
    // Contours
    const k = F.k;
    const { n, base } = levelsOf(F, s);
    const offset = s.offset, every = Math.round(s.indexEvery) | 0;
    const baseW = s.lineWidth * px;
    const segsByLevel = contourSegments(F, n, base + offset), picks = pickedLines(F, s);
    // with chosen lines: their pieces apart (own colour, hidden, under text)
    const pieceOf = new Map();
    if (picks) for (const [i, P] of contourPolylines(F, s).entries()) { const pk = pickOf(picks, i, P.lv); if (pk) pieceOf.set(P.pts[0].toFixed(3) + "," + P.pts[1].toFixed(3) + "," + P.lv, pk); }

    out.push(`<g id="contours">`);
    for (const [lv, segs] of segsByLevel) {
      const all = stitchContours(segs);
      const isIndex = every > 0 && ((lv % every) + every) % every === 0;
      const groups = new Map(); // pick (or null) → its pieces
      for (const poly of all) {
        const pk = picks && poly.length ? pieceOf.get(((poly[0][0] + 0.5) / k).toFixed(3) + "," + ((poly[0][1] + 0.5) / k).toFixed(3) + "," + lv) || null : null;
        if (!groups.has(pk)) groups.set(pk, []);
        groups.get(pk).push(poly);
      }
      for (const [pk, polylines] of groups) {
      if (pk && pk.mode === "hide") continue;
      const lw = (isIndex ? baseW * s.indexWidth : baseW).toFixed(1);
      let color = s.lineColor;
      if (pk && pk.colorOn) color = pk.color;
      else if (isIndex && s.indexColorOn) color = s.indexColor;
      else if (s.lineFrom === "height") {
        const th = (lv - base - offset) / n;
        color = rgbToHex(...ramp(c.lineA, c.lineMid, c.lineB, c.shape(th), c.tmp, c.mid));
      }
      const dParts = [];
      for (const poly of polylines) {
        if (poly.length < 2) continue;
        const sp = simplifyPoly(poly, 0.2);
        let d = `M${((sp[0][0] + 0.5) / k).toFixed(1)} ${((sp[0][1] + 0.5) / k).toFixed(1)}`;
        for (let i = 1; i < sp.length; i++) d += `L${((sp[i][0] + 0.5) / k).toFixed(1)} ${((sp[i][1] + 0.5) / k).toFixed(1)}`;
        dParts.push(d);
      }
      const texted = pk ? pk.mode === "text" || pk.mode === "rain" : s.textOn && textOnLine(s)(isIndex);
      const lineOp = s.lineOpacity * (texted ? s.ptLineOpacity : 1); // the text draws these lines
      if (dParts.length && lineOp > 0) {
        const op = lineOp < 1 ? ` stroke-opacity="${lineOp}"` : "";
        out.push(`<path d="${dParts.join(" ")}" fill="none" stroke="${color}" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"${op}/>`);
      }
      }
    }
    out.push(`</g>`);

    if (atlas && textWanted(s)) { // the text on the lines: one <text> per character, turned with the line
      const P = pathGlyphs(F, s, atlas, markAtlas), esc = (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[ch] || ch);
      const fs = (atlas.fontSize || atlas.cellH * 0.85) * P.sc, msgCol = s.ptMsgColorOn ? s.ptMsgColor : null, op = s.lineOpacity < 1 ? ` fill-opacity="${s.lineOpacity}"` : "";
      const family = s.ptFont ? `'${String(s.ptFontName || s.ptFont).replace(/['"<>&]/g, "")}', '${String(s.ptFont).replace(/['"<>&]/g, "")}', ` : "";
      out.push(`<g id="text" font-family="${family}Menlo, Consolas, monospace" font-size="${fs.toFixed(1)}" text-anchor="middle" dominant-baseline="central"${op}>`);
      for (let q = 0; q < P.n; q++) {
        const x = P.X[q] - P.OX[q] * P.C[q], y = P.Y[q] - P.OX[q] * P.S[q], col = P.FL[q] & 2 && msgCol ? msgCol : P.K[q] ? rgbToHex(...P.K[q]) : rgbToHex(...lineColour(F, s, c, x, y, x * k, y * k, P.Hs[q], !!(P.FL[q] & 1)));
        const deg = (Math.atan2(P.S[q], P.C[q]) * 180) / Math.PI, rot = Math.abs(deg) > 0.05 ? ` transform="rotate(${deg.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"` : "";
        const a = P.A[q] < 1 ? ` fill-opacity="${(P.A[q] * s.lineOpacity).toFixed(3)}"` : ""; // (the rain's fade; replaces the group's opacity)
        out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${col}"${rot}${a}>${esc(atlas.chars[P.G[q]])}</text>`);
      }
      out.push(`</g>`);
    }

    if ((markAtlas || atlas) && (s.labelsOn || s.peaks > 0)) {
      const marks = placeMarks(F, s, markAtlas || atlas);
      if (marks.length) {
        const col = s.labelColorOn ? s.labelColor : s.lineColor;
        out.push(`<g id="labels">`);
        for (const m of marks) {
          const halo = s.labelGap && s.bgMode !== "transparent" ? ` stroke="${s.bgColor}" stroke-width="${(m.h * 0.35).toFixed(1)}" paint-order="stroke fill" stroke-linejoin="round"` : "";
          if (m.kind === "peak") {
            out.push(`<text x="${m.x.toFixed(1)}" y="${m.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="Menlo, Consolas, sans-serif" font-size="${m.h.toFixed(1)}" fill="${col}"${halo}>▲ ${m.text}</text>`);
          } else {
            const deg = (Math.atan2(m.ty, m.tx) * 180 / Math.PI).toFixed(1);
            out.push(`<text x="${m.x.toFixed(1)}" y="${m.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${deg} ${m.x.toFixed(1)} ${m.y.toFixed(1)})" font-family="Menlo, Consolas, sans-serif" font-size="${m.h.toFixed(1)}" fill="${col}"${halo}>${m.text}</text>`);
          }
        }
        out.push(`</g>`);
      }
    }
  }

  out.push("</svg>");
  return out.join("\n");
}

// The contour piece nearest frame point (x, y) for picking a line on the preview: {x, y (the nearest point on
// it), d, line (its index), lv, height (its height as text)} or null.
function lineAt(F, s, x, y) {
  const polys = contourPolylines(F, s), near = nearestLine(polys, x, y);
  return near ? { x: near.x, y: near.y, d: near.d, line: near.i, lv: polys[near.i].lv, height: heightText(F, s, polys[near.i].lv) } : null;
}
// The heights that have contour lines now, lowest first, as text (for filling ptText with one row per height).
function lineHeights(F, s) {
  const lvs = Array.from(new Set(contourPolylines(F, s).map((P) => P.lv))).sort((a, b) => a - b);
  if (!lvs.length) return [];
  const out = [];
  for (let lv = lvs[0]; lv <= lvs[lvs.length - 1]; lv++) out.push(heightText(F, s, lv));
  return out;
}
// What the chosen lines resolve to now: [{line, lv, height, found}] per pick (for the panel's list).
function picksInfo(F, s) {
  const P = pickedLines(F, s);
  return P ? P.list.map((p) => ({ line: p.line, lv: p.lv, height: p.line >= 0 ? heightText(F, s, p.lv) : "", found: p.line >= 0 })) : [];
}

const Lines = { REF, ANALYSIS, SETTINGS_VERSION, DEFAULTS, STYLES, migrate, analysisZ, levelsOf, prepare, render, composite, sourceRGB, hexToRgb, toSVG, textChars, pathGlyphs, lineAt, picksInfo, lineHeights };
if (typeof module !== "undefined") module.exports = Lines;
