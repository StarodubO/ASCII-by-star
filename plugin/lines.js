// "Lines" tab effect: topographic contour lines and ridge lines drawn from a height field. Pure JS (no
// Photoshop APIs), shared by the plugin (linesui.js) and the Node tools.
// prepare() turns an analysis image (and optionally a separate height image, such as a depth map) into a
// smoothed height field; render() draws any document rect of the frame at any scale from it. Every pixel is
// computed from document coordinates alone, so tiles, strips and previews match exactly.
"use strict";
const Engine = require("./engine.js"); // the Custom text syntax (parseCustom) for text on the lines

const REF = 3000; // sizes are px on a 3000 px long side
const ANALYSIS = 1600; // long side of the height field
const SETTINGS_VERSION = 2;

const DEFAULTS = {
  version: SETTINGS_VERSION,
  style: "contours", // contours | ridges
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
  textMode: "text", // text = ptText along each line, turned with it | direction = - / | \ from the line's direction, upright
  ptText: "%h m · ", // Custom text syntax: [A|B] items, [?A|B] at random, {msg} / {msg*N} hidden messages; %h = the line's height
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
};

const STYLES = [
  { id: "topo", name: "Topographic map", s: { style: "contours", labelsOn: true, peaks: 5, levels: 40, lineWidth: 2.5, indexEvery: 5, indexWidth: 2, smooth: 10, declutter: 0, toneWeight: 0, heightWeight: 0, lineFrom: "own", bands: "none", shade: 0, lineColor: "#5a3a1e", bgColor: "#f6f1e3", bgMode: "color" } },
  { id: "relief", name: "Shaded relief map", s: { style: "contours", labelsOn: true, peaks: 6, levels: 30, lineWidth: 1.4, indexEvery: 5, indexWidth: 2, smooth: 6, declutter: 2, toneWeight: 0, heightWeight: 0, lineFrom: "own", bands: "smooth", bandA: "#5e8c61", bandMid: "#e9dfb4", bandMidOn: true, bandB: "#f8f4ee", bandOpacity: 1, shade: 0.7, shadeAngle: 135, shadeRelief: 4, lineColor: "#5b4636", bgMode: "color" } },
  { id: "fine", name: "Fine contours", s: { style: "contours", levels: 90, lineWidth: 1.6, indexEvery: 0, smooth: 6, declutter: 0, toneWeight: 0, heightWeight: 0, lineFrom: "own", bands: "none", shade: 0, lineColor: "#111111", bgColor: "#ffffff", bgMode: "color" } },
  { id: "weighted", name: "Weighted by tone", s: { style: "contours", levels: 70, lineWidth: 2.4, indexEvery: 0, smooth: 7, declutter: 0, toneWeight: 0.85, heightWeight: 0, lineFrom: "own", bands: "none", shade: 0, lineColor: "#111111", bgColor: "#ffffff", bgMode: "color" } },
  { id: "sampled", name: "Image colours", s: { style: "contours", levels: 80, lineWidth: 2.2, indexEvery: 0, smooth: 6, declutter: 0, toneWeight: 0.5, heightWeight: 0, lineFrom: "image", sampleSat: 1.3, sampleBright: 0, bands: "none", shade: 0, bgColor: "#0b0b0e", bgMode: "color" } },
  { id: "neon", name: "Neon gradient", s: { style: "contours", levels: 50, lineWidth: 2, indexEvery: 0, smooth: 9, declutter: 0, toneWeight: 0, heightWeight: 0.4, lineFrom: "height", lineA: "#3a0ca3", lineMid: "#f72585", lineMidOn: true, lineB: "#4cc9f0", bands: "none", shade: 0, bgMode: "gradient", bgColor: "#07071a", bgColor2: "#1b0b2e", bgAngle: 90 } },
  { id: "hypso", name: "Coloured bands", s: { style: "contours", levels: 18, lineWidth: 1.6, indexEvery: 0, smooth: 12, declutter: 0, toneWeight: 0, heightWeight: 0, lineFrom: "own", bands: "steps", bandA: "#2f5d50", bandMidOn: false, bandB: "#f1e6c8", bandOpacity: 1, shade: 0, lineColor: "#1d2a24", bgMode: "color" } },
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
function ramp(a, m, b, t, out) {
  t = clamp01(t);
  if (m) { if (t < 0.5) { b = m; t *= 2; } else { a = m; t = t * 2 - 1; } }
  for (let c = 0; c < 3; c++) out[c] = a[c] + (b[c] - a[c]) * t;
  return out;
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
    index: s.indexColorOn ? rgb(s.indexColor) : null, lineAcross: across(F, s.lineAngle),
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
  if (s.lineFrom === "height") return ramp(c.lineA, c.lineMid, c.lineB, h, c.tmp);
  if (s.lineFrom === "across") return ramp(c.lineA, c.lineMid, c.lineB, c.lineAcross(x, y), c.tmp);
  return c.line;
}

// Renders document rect `rect` (frame px) at scale z into RGBA (round(rect.w·z) × round(rect.h·z)).
// Output pixel (i, j) is the document point rect.x + (i + 0.5)/z, rect.y + (j + 0.5)/z. atlas: the glyph
// atlas for height labels (engine.js prepareAtlas); without it no labels are drawn.
function render(F, s, rect, z, atlas) {
  const W = Math.max(1, Math.round(rect.w * z)), Hh = Math.max(1, Math.round(rect.h * z));
  const out = new Uint8ClampedArray(W * Hh * 4), c = context(F, s, z), col = [0, 0, 0];
  c.marks = atlas && s.style !== "ridges" ? marksIn(F, s, atlas, rect) : [];
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
  else renderContours(F, s, c, rect, z, W, Hh, out);
  if (atlas && s.textOn && s.style !== "ridges") drawPathText(F, s, c, atlas, rect, z, W, Hh, out);
  if (c.marks.length) drawMarks(F, s, c, atlas, rect, z, W, Hh, out);
  if (s.followShape && !F.metres) { // nothing where the source is transparent
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
  const shading = s.shade > 0, L = c.light, opaque = s.bgMode !== "transparent", textLines = s.textOn ? textOnLine(s) : null;
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
      let cov = coverage(d, wpx) * s.lineOpacity;
      if (c.gaps.length) cov *= 1 - gapAt(c.gaps, x, y, z);
      if (gapMin > 0 && !isIndex) cov *= clamp01((1 / g - gapMin * 0.6) / (gapMin * 0.4)); // crowded lines fade out
      if (textLines && textLines(isIndex)) cov *= s.ptLineOpacity; // the text draws these lines
      if (cov <= 0) continue;
      over(out, o, lineColour(F, s, c, x, y, ax, ay, h, isIndex), cov);
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
  return (atlas._digits = { top, cap: bottom - top, adv: atlas.cellW });
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
// The characters the text needs (for an atlas that has them all).
function textChars(s) {
  if (!s.textOn) return "";
  if (s.textMode === "direction") return "-\\|/";
  return String(s.ptText || "").replace(/%h/g, "") + "0123456789-";
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
function pathGlyphs(F, s, atlas) {
  const polys = contourPolylines(F, s);
  const key = [F._polys.key, s.textMode, s.ptText, s.ptSize, s.ptSpacing, s.ptWhich, s.ptRotate, s.ptVertical, s.ptReadable, s.ptRoom, s.ptSeed, s.labelUnits,
    s.labelGap, s.labelsOn, s.labelEvery, s.labelSpacing, s.labelSize, s.labelUphill, s.peaks, s.peakSpacing].join("|");
  if (F._pt && F._pt.key === key && F._pt.atlas === atlas) return F._pt;
  const gm = glyphMetrics(atlas), docPx = F.docLong / REF, size = Math.max(1, s.ptSize) * docPx, sc = size / gm.cap;
  const vert = !!s.ptVertical && s.textMode !== "direction"; // vertical type: stacked at the cap height plus some leading
  const adv = Math.max(0.2, s.ptSpacing) * (vert ? gm.cap * 1.35 : gm.adv) * sc, which = textOnLine(s), dir = s.textMode === "direction", k = F.k;
  const { n } = levelsOf(F, s), room = s.ptRoom * size, gaps = s.labelGap ? (s.labelsOn || s.peaks > 0 ? placeMarks(F, s, atlas) : []) : [];
  const spec = dir ? null : Engine.parseCustom(s.ptText);
  const X = [], Y = [], C = [], S = [], G = [], Hs = [], FL = [], p = [0, 0], q0 = [0, 0], q1 = [0, 0];
  const lines = polys.map((P, i) => ({ P, i, w: which(P.isIndex) ? walker(P.pts, P.closed) : null }));
  // 1. the slots of every line: centre, direction and whether a character can show there
  for (const l of lines) {
    const { P, w } = l;
    l.slots = [];
    if (!w || w.len < adv * 2) continue;
    // runs of the line and which way the text goes along each: [t0, t1, sign]. Readable: the text always runs
    // left to right and turns round where the line does (with some hysteresis); uphill: one way, tops uphill.
    const runs = [];
    if (s.ptReadable || dir) {
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
    for (const [t0, t1, sign] of runs) {
      const slots = Math.floor((t1 - t0) / adv);
      if (slots < 1) continue;
      const start = t0 + (t1 - t0 - slots * adv) / 2 + adv / 2;
      for (let u = 0; u < slots; u++) {
        const d = sign > 0 ? start + u * adv : start + (slots - 1 - u) * adv;
        w.at(d, p); w.at(d - adv / 2, q0); w.at(d + adv / 2, q1);
        let tx = (q1[0] - q0[0]) * sign, ty = (q1[1] - q0[1]) * sign;
        const tl = Math.hypot(tx, ty), ax = p[0] * k, ay = p[1] * k;
        let ok = tl > 1e-9;
        if (ok) { tx /= tl; ty /= tl; }
        if (ok && room > 0) { const g = Math.hypot(bilinear(F.gx, F.w, F.h, ax, ay), bilinear(F.gy, F.w, F.h, ax, ay)) * n * k; if (g > 0 && 1 / g < room) ok = false; }
        if (ok && gaps.length && gapAt(gaps, p[0], p[1], 1e9) > 0) ok = false;
        l.slots.push({ x: p[0], y: p[1], tx, ty, ok, first: u === 0 });
      }
    }
  }
  // 2. where the {messages} go: hashed onto stretches of slots that all show (within one run), at a hashed place
  const msgsOf = new Map();
  if (spec && spec.messages.length) {
    let r = 0;
    for (const msg of spec.messages) {
      const chars = Array.from(msg.text), need = chars.length;
      const fits = []; // [line, first slot of a free stretch, its length]
      for (const l of lines) {
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
  for (const l of lines) {
    if (!l.slots.length) continue;
    const next = dir ? null : lineStream(spec, heightText(F, s, l.P.lv), s.ptSeed, l.i, msgsOf.get(l.i));
    for (const sl of l.slots) {
      const [ch, isMsg] = dir ? ["", false] : next();
      if (!sl.ok) continue;
      let c = ch;
      if (dir) { let a = Math.atan2(sl.ty, sl.tx); if (a < 0) a += Math.PI; c = a < Math.PI / 8 || a >= (7 * Math.PI) / 8 ? "-" : a < (3 * Math.PI) / 8 ? "\\" : a < (5 * Math.PI) / 8 ? "|" : "/"; }
      if (c === " ") continue;
      const g = atlas.index.get(c);
      if (g === undefined) continue;
      const upright = dir || !s.ptRotate;
      // the glyph's x axis (cos, sin): along the line, or for vertical type across it (its down then runs along the line)
      X.push(sl.x); Y.push(sl.y); C.push(upright ? 1 : vert ? sl.ty : sl.tx); S.push(upright ? 0 : vert ? -sl.tx : sl.ty); G.push(g);
      Hs.push(cubic(F.H, F.w, F.h, sl.x * k, sl.y * k)); FL.push((l.P.isIndex ? 1 : 0) | (isMsg ? 2 : 0));
    }
  }
  // buckets by centre
  const B = Math.max(8, size * 4), bw = Math.ceil(F.fw / B) + 1, bh = Math.ceil(F.fh / B) + 1, buckets = new Map();
  for (let q = 0; q < X.length; q++) {
    const bk = Math.min(bh - 1, Math.max(0, Math.floor(Y[q] / B))) * bw + Math.min(bw - 1, Math.max(0, Math.floor(X[q] / B)));
    let a = buckets.get(bk); if (!a) buckets.set(bk, (a = [])); a.push(q);
  }
  F._pt = { key, atlas, n: X.length, X, Y, C, S, G, Hs, FL, sc, size, B, bw, bh, buckets, r: (Math.hypot(atlas.cellW, atlas.cellH) / 2) * sc };
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
function drawPathText(F, s, c, atlas, rect, z, W, Hh, out) {
  const P = pathGlyphs(F, s, atlas);
  if (!P.n) return;
  const cw = atlas.cellW, gm = glyphMetrics(atlas), vc = gm.top + gm.cap / 2, sc = P.sc, k = F.k;
  const ss = Math.min(4, Math.max(1, Math.ceil(1 / (sc * z) / 1.5))), inv = 1 / (ss * ss * 255); // supersampling when the characters are small
  const msgCol = s.ptMsgColorOn ? hexToRgb(s.ptMsgColor) : null, col = [0, 0, 0], r = P.r + 1 / z;
  for (const q of pathGlyphsIn(P, rect)) {
    const x0 = P.X[q], y0 = P.Y[q], co = P.C[q], si = P.S[q], g = P.G[q], fl = P.FL[q];
    const colour = fl & 2 && msgCol ? msgCol : lineColour(F, s, c, x0, y0, x0 * k, y0 * k, P.Hs[q], !!(fl & 1));
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
      if (acc > 0) over(out, (j * W + i) * 4, col, Math.min(1, acc * inv) * s.lineOpacity);
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
function toSVG(F, s, atlas) {
  const W = F.fw, H = F.fh, px = F.docLong / REF;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`];
  if (s.bgMode !== "transparent") out.push(`<rect width="100%" height="100%" fill="${s.bgColor}"/>`);

  const c = context(F, s, 1);

  if (s.style === "ridges") {
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
    const segsByLevel = contourSegments(F, n, base + offset);

    out.push(`<g id="contours">`);
    for (const [lv, segs] of segsByLevel) {
      const polylines = stitchContours(segs);
      const isIndex = every > 0 && ((lv % every) + every) % every === 0;
      const lw = (isIndex ? baseW * s.indexWidth : baseW).toFixed(1);
      let color = s.lineColor;
      if (isIndex && s.indexColorOn) color = s.indexColor;
      else if (s.lineFrom === "height") {
        const th = (lv - base - offset) / n;
        color = rgbToHex(...ramp(c.lineA, c.lineMid, c.lineB, th, c.tmp));
      }
      const dParts = [];
      for (const poly of polylines) {
        if (poly.length < 2) continue;
        const sp = simplifyPoly(poly, 0.2);
        let d = `M${((sp[0][0] + 0.5) / k).toFixed(1)} ${((sp[0][1] + 0.5) / k).toFixed(1)}`;
        for (let i = 1; i < sp.length; i++) d += `L${((sp[i][0] + 0.5) / k).toFixed(1)} ${((sp[i][1] + 0.5) / k).toFixed(1)}`;
        dParts.push(d);
      }
      const lineOp = s.lineOpacity * (s.textOn && textOnLine(s)(isIndex) ? s.ptLineOpacity : 1); // the text draws these lines
      if (dParts.length && lineOp > 0) {
        const op = lineOp < 1 ? ` stroke-opacity="${lineOp}"` : "";
        out.push(`<path d="${dParts.join(" ")}" fill="none" stroke="${color}" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"${op}/>`);
      }
    }
    out.push(`</g>`);

    if (atlas && s.textOn) { // the text on the lines: one <text> per character, turned with the line
      const P = pathGlyphs(F, s, atlas), esc = (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[ch] || ch);
      const fs = (atlas.fontSize || atlas.cellH * 0.85) * P.sc, msgCol = s.ptMsgColorOn ? s.ptMsgColor : null, op = s.lineOpacity < 1 ? ` fill-opacity="${s.lineOpacity}"` : "";
      out.push(`<g id="text" font-family="Menlo, Consolas, monospace" font-size="${fs.toFixed(1)}" text-anchor="middle" dominant-baseline="central"${op}>`);
      for (let q = 0; q < P.n; q++) {
        const x = P.X[q], y = P.Y[q], col = P.FL[q] & 2 && msgCol ? msgCol : rgbToHex(...lineColour(F, s, c, x, y, x * k, y * k, P.Hs[q], !!(P.FL[q] & 1)));
        const deg = (Math.atan2(P.S[q], P.C[q]) * 180) / Math.PI, rot = Math.abs(deg) > 0.05 ? ` transform="rotate(${deg.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"` : "";
        out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${col}"${rot}>${esc(atlas.chars[P.G[q]])}</text>`);
      }
      out.push(`</g>`);
    }

    if (atlas && (s.labelsOn || s.peaks > 0)) {
      const marks = placeMarks(F, s, atlas);
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

const Lines = { REF, ANALYSIS, SETTINGS_VERSION, DEFAULTS, STYLES, migrate, analysisZ, levelsOf, prepare, render, composite, sourceRGB, hexToRgb, toSVG, textChars, pathGlyphs };
if (typeof module !== "undefined") module.exports = Lines;
