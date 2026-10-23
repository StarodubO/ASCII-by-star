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
  textMode: "ramp", // custom text: ramp (one character per brightness step) | words | phrase (written out, repeating)
  phraseShade: true, // phrase: letters fade with the image
  phraseWrap: true, // phrase: carry on where the previous line stopped (off: every line starts the text again)
  sortByDensity: true,
  font: "", // PostScript name of an installed font; "" = built-in Menlo atlas
  fontName: "",
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
  keepAlpha: true, // the background only covers the source's opaque parts
  bgOpacity: 1, // strength of the solid or mosaic background (0 = characters only)
  mosaicAmount: 0.35,
  glyphOpacity: 1,
  // shadows: drawn between the background and the characters. Sizes are fractions of the font size, so they
  // scale with it; the light angle follows Photoshop (135° = light from the top left, shadow falls down-right).
  shadowAngle: 135,
  dropOn: false, dropColor: "#000000", dropOpacity: 0.6, dropDistance: 0.15, dropSize: 0.3,
  longOn: false, longColor: "#000000", longOpacity: 0.4, longLength: 1.5, longFade: 1,
  offOn: false, offColor: "#ff2a6d", offOpacity: 1, offDistance: 0.12,
  glowOn: false, glowTextColor: true, glowColor: "#ffffff", glowOpacity: 0.8, glowSize: 0.4,
  // outline for hard-edged shapes (text, logos); see applyOutline
  outlineOn: false, outlineLevel: 0.5, outlineWidth: 1, outlinePos: "outside", // outside | center | inside
  outlineStyle: "lines", outlineChars: "#", outlineColor: "#ff2a6d", // lines (follow the edge) | chars
  outlineFill: "image", outlineFillChars: ".", // image | none | chars (in order) | random (your characters, shuffled)
  hideSeed: 1, // where hidden {messages} go
  cellEdits: [], // symbols changed by hand (Edit symbols; see applyEdits)
  // [ ] fill in custom text (see parseCustom)
  fillLevel: 0.5, // with ramp characters outside the brackets: cells darker than this get the fill
  fillSeed: 1, // order of [?random] items
  // Matrix rain (inert unless rainOn; see applyRain). Lengths and distances are in character cells.
  rainOn: false, rainFrom: "object", // object (falls from the shape's lower edges) | everywhere (the whole image)
  rainCharset: "katakana_half", rainChars: "01", // a character set id, or "custom" for rainChars ([ ] syntax works)
  rainLength: 8, rainLengthVar: 0.5, rainAmount: 0.5, rainDistance: 24, rainGaps: 0, rainAngle: 0,
  rainFade: 0.8, rainHead: true, rainHeadColor: "#ffffff", rainOutside: 0.4, rainSeed: 1,
  rainColorMode: "own", rainColor: "#00ff41", // own | art (the shape's colours) | gradient (tail → head)
  rainGradient: ["#003b00", "#00c832", "#b8ffb8"], rainGradientMid: true,
  rainArtLook: null, // "art" colours from these captured colour settings ({colorMode, fg, gradient, …}); null: the current ones
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
// The tone ramp is built from `str`. opts.extra: characters (outline, fill, hidden messages) that are drawable
// but never picked by tone; they come after the ramp, so n, level, vec and lut only cover the ramp.
// opts.spread: see MAX_FIRST.
const MAX_FIRST = 0.25; // highest tone level of the lightest visible character in a spread, density-sorted ramp
function buildCharset(atlas, str, sortByDensity, opts) {
  const extra = (opts && opts.extra) || "";
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
  for (const ch of new Set(Array.from(extra))) {
    const g = atlas.index.get(ch);
    if (g !== undefined && !list.includes(g)) list.push(g);
  }
  const glyphs = Int32Array.from(list), all = list.length;
  const cov = new Float32Array(all), level = new Float32Array(n), vec = new Float32Array(n * 9);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < all; i++) cov[i] = atlas.cov[glyphs[i]];
  for (let i = 0; i < n; i++) { mn = Math.min(mn, cov[i]); mx = Math.max(mx, cov[i]); }
  const span = mx - mn > 1e-6 ? mx - mn : 1;
  for (let i = 0; i < n; i++) {
    level[i] = sortByDensity !== false ? (cov[i] - mn) / span : n > 1 ? i / (n - 1) : 1;
    for (let k = 0; k < 9; k++) vec[i * 9 + k] = Math.max(0, (atlas.vec[glyphs[i] * 9 + k] - mn) / span);
  }
  // When even the lightest visible character carries a lot of ink (digits, letters, 01), it would take every
  // mid tone on its own. Move it down to MAX_FIRST and spread the others over the range that frees up.
  // Not when dithering: error diffusion needs the true densities and mixes the characters by itself.
  const l1 = level[1];
  if (opts && opts.spread && sortByDensity !== false && n > 2 && l1 > MAX_FIRST) {
    for (let i = 1; i < n; i++) level[i] = MAX_FIRST + (1 - MAX_FIRST) * (l1 < 1 - 1e-6 ? (level[i] - l1) / (1 - l1) : (i - 1) / (n - 2));
  }
  const lut = new Uint16Array(256);
  for (let v = 0; v < 256; v++) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(level[i] - v / 255); if (d < bd) { bd = d; best = i; } }
    lut[v] = best;
  }
  const chars = Array.from(glyphs, (g) => atlas.chars[g]), charIndex = new Map();
  chars.forEach((ch, i) => { if (!charIndex.has(ch)) charIndex.set(ch, i); });
  return { n, glyphs, cov, level, vec, lut, chars, charIndex, rain: (opts && opts.rain) || null };
}

// Custom text syntax:
//   {message} hides "message" once somewhere in the picture, {message*5} five times.
//   [STAR] fills the artwork with STAR written out over and over; [STAR|LOVE|★] cycles through the items and
//   [?STAR|LOVE|★] picks them at random; [?01] (one item, random) picks single characters. Items longer than
//   one character get a space between them. Several [ ] groups make one fill.
// Everything outside the braces and brackets is the ramp, words or phrase as usual (with a fill, it draws the
// lighter tones and the fill takes cells darker than fillLevel); "{}" and "[]" stay plain characters.
function fillSpec(items, random) {
  const sep = items.length > 1 && items.some((t) => Array.from(t).length > 1) ? " " : "";
  return { items, random, sep };
}
function parseFill(body) {
  body = body.trim();
  const random = body[0] === "?";
  let items = (random ? body.slice(1) : body).split("|").map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (random && items.length === 1) items = Array.from(items[0]).filter((ch) => ch !== " ");
  return items.length ? fillSpec(items, random) : null;
}
function parseCustom(str) {
  const messages = [], fills = [];
  const text = String(str || "").replace(/\{([^{}]+)\}/g, (all, body) => {
    const m = body.match(/^([\s\S]*?)\*(\d+)$/), t = (m ? m[1] : body).replace(/\s+/g, " ").trim();
    if (!t) return all;
    messages.push({ text: t, count: m ? Math.min(99, Math.max(1, Number(m[2]))) : 1 });
    return "";
  }).replace(/\[([^[\]]+)\]/g, (all, body) => {
    const f = parseFill(body);
    if (!f) return all;
    fills.push(f);
    return "";
  });
  const fill = fills.length ? fillSpec([].concat(...fills.map((f) => f.items)), fills.some((f) => f.random)) : null;
  return { text, messages, fill };
}
const specChars = (spec) => (spec ? spec.items.join("") + spec.sep : "");
// What the rain draws with: its preset's characters at random, or its custom text (plain characters at random,
// or a [ ] expression).
function rainSpec(s, rainPresetChars) {
  const p = s.rainCharset === "custom" ? parseCustom(s.rainChars) : null;
  if (p && p.fill) return p.fill;
  const chars = Array.from(new Set(Array.from(p ? p.text : rainPresetChars || ""))).filter((ch) => ch.trim());
  return chars.length ? fillSpec(chars, true) : null;
}

const OUTLINE_LINES = "|/-\\"; // edge lines by direction: vertical, rising, horizontal, falling
// The characters the settings draw with: the ramp (custom text without its hidden messages and fill) and the
// extras. rainPresetChars: the characters of the rain's character set (s.rainCharset).
function charsetParts(s, presetChars, rainPresetChars) {
  const custom = s.charset === "custom" ? parseCustom(s.customChars) : null;
  let extra = custom ? custom.messages.map((m) => m.text).join("") + specChars(custom.fill) : "";
  if (s.outlineOn) extra += (s.outlineStyle === "chars" ? s.outlineChars : OUTLINE_LINES) + (s.outlineFill === "chars" || s.outlineFill === "random" ? s.outlineFillChars : "");
  const rain = s.rainOn || (s.cellEdits || []).some((x) => x && x.op === "rain") ? rainSpec(s, rainPresetChars) : null;
  extra += specChars(rain);
  if (s.cellEdits && s.cellEdits.length) extra += s.cellEdits.map((e) => (e.op === "write" && e.text) || "").join("");
  return { ramp: custom ? custom.text : presetChars, extra, spread: s.dither === "none", rain };
}
function charsetOf(atlas, s, presetChars, rainPresetChars) {
  const p = charsetParts(s, presetChars, rainPresetChars);
  return buildCharset(atlas, p.ramp, s.sortByDensity, p);
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
  const custom = s.charset === "custom" ? parseCustom(s.customChars) : null;
  if (custom && custom.fill) applyFill(grid, s, cs, custom.fill, custom.text.trim() !== "");
  if (s.outlineOn) applyOutline(grid, s, cs);
  if (custom) hideMessages(grid, s, cs, custom.messages);
  if (s.rainOn) applyRain(grid, s, cs);
  if (s.cellEdits && s.cellEdits.length) applyEdits(grid, s, cs);
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

// Custom text used as words or as a phrase instead of a per-character brightness ramp.
//   words:  space-separated words (or letter pairs); each covers as many cells as it has letters. Ordered by
//           ink, they split the tones evenly; left to right, each spot gets the word that matches its cells.
//   phrase: the text written out over and over in reading order; light cells stay empty and (phraseShade)
//           letters fade with the image.
const charAt = (cs, ch) => (cs.charIndex.has(ch) ? cs.charIndex.get(ch) : -1);
// Text as glyph indices (line breaks become spaces; characters the charset lacks are dropped).
const glyphSeq = (cs, text) => Array.from(String(text || "").replace(/[\r\t]/g, "").replace(/\n+/g, " ")).map((ch) => charAt(cs, ch)).filter((i) => i >= 0);
// Writes `seq` into the cells `pick` accepts, in reading order, over and over. wrap off: every row starts it again.
function writeSeq(glyph, cols, rows, seq, pick, wrap) {
  let k = 0;
  for (let r = 0; r < rows; r++) {
    if (!wrap) k = 0;
    for (let c = 0; c < cols && seq.length; c++) { const ci = r * cols + c; if (pick(ci)) glyph[ci] = seq[k++ % seq.length]; }
  }
}

// The glyphs of a fill or rain spec, one per call: the items in order, or picked at random from `seed`, each
// followed by spec.sep. Spaces are -1 (empty cells); characters the charset lacks are dropped. null: nothing to draw.
function itemStream(cs, spec, seed) {
  const items = spec.items.map((t) => Array.from(t).filter((ch) => ch === " " || cs.charIndex.has(ch)).map((ch) => (ch === " " ? -1 : cs.charIndex.get(ch)))).filter((it) => it.length);
  if (!items.length) return null;
  const sep = spec.sep ? [-1] : [];
  let n = 0, queue = [], q = 0;
  return () => {
    if (q >= queue.length) {
      queue = (spec.random ? items[Math.floor(hash3(seed, n, 3) * items.length)] : items[n % items.length]).concat(sep);
      n++; q = 0;
    }
    return queue[q++];
  };
}

// [ ] fill (see parseCustom): writes the items in reading order into every inked cell or, when ramp characters
// stand outside the brackets, only into cells darker than fillLevel, leaving the rest to the ramp. Solid letters.
function applyFill(grid, s, cs, fill, withRamp) {
  const { cols, rows, glyph, ink } = grid, cells = cols * rows;
  const next = itemStream(cs, fill, (s.fillSeed | 0) + 211);
  if (!next) return;
  const lvl = withRamp ? s.fillLevel : Math.max(s.threshold, 0.04);
  for (let i = 0; i < cells; i++) {
    if (ink[i] > lvl) { glyph[i] = next(); if (grid.shade) grid.shade[i] = 1; }
    else if (!withRamp) glyph[i] = -1;
  }
}

function selectText(g, s, cs) {
  const { cols, rows, ink } = g, cells = cols * rows, glyph = new Int16Array(cells).fill(-1);
  const text = parseCustom(s.customChars).text;
  let shade = null;
  if (s.textMode === "phrase") {
    const thr = Math.max(s.threshold, 0.04);
    if (s.phraseShade) shade = new Float32Array(cells);
    writeSeq(glyph, cols, rows, glyphSeq(cs, text), (ci) => {
      if (ink[ci] <= thr) return false;
      if (shade) shade[ci] = Math.pow(clamp01(ink[ci] * 1.1), 0.8);
      return true;
    }, s.phraseWrap);
  } else {
    const at = (ch) => charAt(cs, ch);
    const words = Array.from(new Set(text.split(/\s+/).filter(Boolean)))
      .map((w) => Array.from(w).map(at).filter((i) => i >= 0)).filter((w) => w.length)
      .map((w) => ({ w, d: w.reduce((a, i) => a + cs.cov[i], 0) / w.length }))
      .sort((a, b) => a.d - b.d);
    // every word gets an equal share of the tones, lightest ink first, so all of them show up
    words.forEach((x, i) => { x.level = (i + 1) / words.length; });
    const lightest = words.length ? words[0].level : 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols;) {
        const v0 = ink[r * cols + c];
        if (v0 <= s.threshold || v0 < lightest / 2) { c++; continue; } // lighter than any word: leave empty
        let best = null, be = Infinity;
        for (const x of words) {
          if (c + x.w.length > cols) continue;
          let m = 0;
          for (let j = 0; j < x.w.length; j++) m += ink[r * cols + c + j];
          const e = Math.abs(x.level - m / x.w.length);
          if (e < be) { be = e; best = x; }
        }
        if (!best) { c++; continue; }
        for (let j = 0; j < best.w.length; j++) glyph[r * cols + c + j] = best.w[j];
        c += best.w.length;
      }
    }
  }
  return { cols, rows, geo: g.geo, glyph, color: cellColors(g, s), rgb: g.rgb, alpha: g.alpha, ink, shade };
}

function selectGlyphs(g, s, cs) {
  if (s.charset === "custom" && (s.textMode === "words" || s.textMode === "phrase")) return selectText(g, s, cs);
  const { cols, rows, ink, sub, rgb, alpha } = g;
  const cells = cols * rows;
  const glyph = new Int16Array(cells);
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

  return { cols, rows, geo: g.geo, glyph, color: cellColors(g, s), rgb, alpha, ink };
}

// ---------- outline ----------
// For text, logos and other hard-edged shapes: cells with more ink than outlineLevel are the shape. A band
// outlineWidth cells wide along its edge (outside, centred or inside) becomes the stroke, drawn with lines
// that follow the edge or with your characters, in its own colour. The inside keeps the image, is emptied,
// or is filled with your characters, in order or picked at random per cell (hashed from its position).
function applyOutline(grid, s, cs) {
  const { cols, rows, glyph, ink, color } = grid, cells = cols * rows, lvl = s.outlineLevel;
  const inside = new Uint8Array(cells);
  let nIn = 0;
  for (let i = 0; i < cells; i++) if (ink[i] > lvl) { inside[i] = 1; nIn++; }
  if (!nIn || nIn === cells) return;
  // distance in cells (8 neighbours) to the nearest cell on the other side of the edge
  const distTo = (want) => {
    const D = new Float32Array(cells);
    for (let i = 0; i < cells; i++) D[i] = inside[i] === want ? 0 : 1e9;
    const relax = (r, c, dr, dc) => { const y = r + dr, x = c + dc; if (y >= 0 && y < rows && x >= 0 && x < cols) { const i = r * cols + c, v = D[y * cols + x] + 1; if (v < D[i]) D[i] = v; } };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { relax(r, c, -1, -1); relax(r, c, -1, 0); relax(r, c, -1, 1); relax(r, c, 0, -1); }
    for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) { relax(r, c, 1, 1); relax(r, c, 1, 0); relax(r, c, 1, -1); relax(r, c, 0, 1); }
    return D;
  };
  const dIn = distTo(1), dOut = distTo(0), w = Math.max(1, Math.round(s.outlineWidth));
  const [wo, wi] = s.outlinePos === "inside" ? [0, w] : s.outlinePos === "center" ? [Math.ceil(w / 2), Math.floor(w / 2)] : [w, 0];
  const stroke = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) stroke[i] = inside[i] ? dOut[i] <= wi : dIn[i] <= wo;
  if (s.outlineStyle === "chars") writeSeq(glyph, cols, rows, glyphSeq(cs, s.outlineChars), (i) => stroke[i], true);
  else {
    // the line runs across the gradient of the signed distance (positive outside the shape)
    const lines = Array.from(OUTLINE_LINES, (ch) => charAt(cs, ch));
    const sd = (r, c) => { const i = Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c)); return dIn[i] - dOut[i]; };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!stroke[r * cols + c]) continue;
      const gx = sd(r - 1, c + 1) + 2 * sd(r, c + 1) + sd(r + 1, c + 1) - sd(r - 1, c - 1) - 2 * sd(r, c - 1) - sd(r + 1, c - 1);
      const gy = sd(r + 1, c - 1) + 2 * sd(r + 1, c) + sd(r + 1, c + 1) - sd(r - 1, c - 1) - 2 * sd(r - 1, c) - sd(r - 1, c + 1);
      const a = gx || gy ? Math.atan2(gy, gx) : Math.PI / 2;
      glyph[r * cols + c] = lines[Math.round((((a % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 4)) % 4];
    }
  }
  const fill = (i) => inside[i] && !stroke[i], typed = s.outlineFill === "chars" || s.outlineFill === "random";
  if (s.outlineFill === "none") for (let i = 0; i < cells; i++) { if (fill(i)) glyph[i] = -1; }
  else if (s.outlineFill === "chars") writeSeq(glyph, cols, rows, glyphSeq(cs, s.outlineFillChars), fill, true);
  else if (s.outlineFill === "random") {
    const seq = glyphSeq(cs, s.outlineFillChars);
    if (seq.length) for (let i = 0; i < cells; i++) if (fill(i)) glyph[i] = seq[Math.floor(hash3(57, i % cols, Math.floor(i / cols)) * seq.length)];
  }
  const sc = hexToRgb(s.outlineColor);
  for (let i = 0; i < cells; i++) {
    if (stroke[i]) color.set(sc, i * 3);
    if (grid.shade && (stroke[i] || (fill(i) && typed))) grid.shade[i] = 1;
  }
}

// ---------- hidden messages ----------
// Each message is written left to right into one row, replacing the characters there, at a spot picked from
// the seed (hideSeed). A spot is taken when all its cells are clearly inked, so the message blends in, and
// keeps a cell clear of other messages. grid.hidden marks the cells (the preview can highlight them).
function hideMessages(grid, s, cs, messages) {
  if (!messages.length) return;
  const { cols, rows, glyph, ink } = grid, hidden = new Uint8Array(cols * rows), seed = (s.hideSeed | 0) + 101;
  const minInk = Math.max(0.2, s.threshold + 0.1);
  let placed = 0, n = 0;
  for (const m of messages) {
    const seq = Array.from(m.text, (ch) => (ch === " " ? -1 : charAt(cs, ch))), len = Math.min(seq.length, cols);
    for (let k = 0; k < m.count; k++, n++) {
      let best = null, bestInk = -1;
      for (let t = 0; t < 400; t++) {
        const r = Math.floor(hash3(seed, n, t * 2) * rows), c = Math.floor(hash3(seed, n, t * 2 + 1) * (cols - len + 1));
        let free = true, sum = 0, low = 0;
        for (let j = -1; j <= len && free; j++) { const x = c + j; if (x >= 0 && x < cols && hidden[r * cols + x]) free = false; }
        if (!free) continue;
        for (let j = 0; j < len; j++) { const v = ink[r * cols + c + j]; sum += v; if (v < minInk) low++; }
        if (!low) { best = [r, c]; break; }
        if (sum > bestInk) { bestInk = sum; best = [r, c]; }
      }
      if (!best) continue;
      const [r, c] = best;
      for (let j = 0; j < len; j++) {
        const ci = r * cols + c + j;
        glyph[ci] = seq[j];
        hidden[ci] = 1;
        if (grid.shade) grid.shade[ci] = Math.max(grid.shade[ci], 0.6);
      }
      placed++;
    }
  }
  grid.hidden = hidden;
  grid.hiddenPlaced = placed;
}

// ---------- symbol edits ----------
// Changes made by hand (Edit symbols), applied in order after everything the image decides, so later edits
// win. An edit is {op, text, color} with either pts (a stroke: the cells under its points, in order) or rect
// (the cells whose centres lie inside). Positions are fractions of the area's width and height, so edits stay
// on the same part of the picture when the font size or spacing changes.
//   write   the edit's characters, one per cell, in stroke or reading order and repeating; a space empties
//           a cell; with color the cells take that colour too
//   color   recolours the cells that have a character
//   erase   empties the cells
//   restore puts back what the image gave the cells (undoes earlier edits there)
//   rain    a Matrix rain stream falls from each cell, e.len cells long (0: the rain settings' length ± spread),
//           drawn with the rain's characters, colours, fade, head and angle
function editCells(e, geo) {
  const { cols, rows, cellW, cellH, docW, docH } = geo, out = [];
  if (Array.isArray(e.rect) && e.rect.length === 4) {
    const x0 = Math.min(e.rect[0], e.rect[2]) * docW, x1 = Math.max(e.rect[0], e.rect[2]) * docW;
    const y0 = Math.min(e.rect[1], e.rect[3]) * docH, y1 = Math.max(e.rect[1], e.rect[3]) * docH;
    // a selection that reaches an edge also takes the part-cells there (their centres lie outside the area)
    const c0 = Math.max(0, Math.ceil(x0 / cellW - 0.5)), c1 = x1 >= docW - 1e-6 ? cols - 1 : Math.min(cols - 1, Math.floor(x1 / cellW - 0.5));
    const r0 = Math.max(0, Math.ceil(y0 / cellH - 0.5)), r1 = y1 >= docH - 1e-6 ? rows - 1 : Math.min(rows - 1, Math.floor(y1 / cellH - 0.5));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * cols + c);
    if (out.length) return out;
    const c = Math.floor((x0 + x1) / 2 / cellW), r = Math.floor((y0 + y1) / 2 / cellH); // smaller than a cell
    return c >= 0 && r >= 0 && c < cols && r < rows ? [r * cols + c] : [];
  }
  const seen = new Set();
  for (const p of e.pts || []) {
    const c = Math.floor((p[0] * docW) / cellW), r = Math.floor((p[1] * docH) / cellH), i = r * cols + c;
    if (c >= 0 && r >= 0 && c < cols && r < rows && !seen.has(i)) { seen.add(i); out.push(i); }
  }
  return out;
}
// Where the rain's "art" colours come from: the cells' current colours, or the colour settings captured in
// s.rainArtLook (so the rain keeps an earlier gradient while the characters change colour).
function rainArtSource(grid, s) {
  if (!s.rainArtLook || s.rainColorMode !== "art") return grid.color;
  if (!grid._rainArt) grid._rainArt = cellColors(grid, Object.assign({}, s, s.rainArtLook));
  return grid._rainArt;
}
// One rain stream starting at cell i and falling (see applyRain): the head, the bright end, is lowest.
function rainStream(grid, s, cs, i, len) {
  const { cols, rows, glyph, color } = grid, c0 = i % cols, r0 = Math.floor(i / cols), seed = (s.rainSeed | 0) + 307;
  const next = cs.rain && itemStream(cs, cs.rain, seed + 5000 + i);
  if (!next) return;
  if (!grid.shade) grid.shade = new Float32Array(cols * rows).fill(1);
  const L = Math.max(1, Math.round(s.rainLength));
  if (len <= 0) len = Math.max(1, Math.round(L * (1 + clamp01(s.rainLengthVar) * (hash3(seed + 1, c0, r0) * 2 - 1))));
  const slope = Math.tan((Math.max(-60, Math.min(60, s.rainAngle)) * Math.PI) / 180), fade = clamp01(s.rainFade);
  const own = hexToRgb(s.rainColor), head = hexToRgb(s.rainHeadColor), art = rainArtSource(grid, s).slice(i * 3, i * 3 + 3);
  const stops = (s.rainGradientMid ? s.rainGradient : [s.rainGradient[0], s.rainGradient[2]]).map(hexToRgb);
  for (let k = 0; k < len; k++) {
    const g = next(), r = r0 + k, c = c0 + Math.round(k * slope);
    if (r >= rows || c < 0 || c >= cols) break;
    if (g < 0) continue;
    const j = r * cols + c, t = (k + 1) / len, isHead = k === len - 1 && s.rainHead;
    const cl = isHead ? head : s.rainColorMode === "gradient" ? gradientAt(stops, t) : s.rainColorMode === "art" ? art : own;
    glyph[j] = g;
    color[j * 3] = clamp255(cl[0]); color[j * 3 + 1] = clamp255(cl[1]); color[j * 3 + 2] = clamp255(cl[2]);
    grid.shade[j] = isHead ? 1 : 1 - fade * (1 - t);
    if (grid.hidden) grid.hidden[j] = 0;
  }
}
function applyEdits(grid, s, cs) {
  const { glyph, color, geo } = grid;
  const orig = { glyph: glyph.slice(), color: color.slice(), shade: grid.shade ? grid.shade.slice() : null, hidden: grid.hidden ? grid.hidden.slice() : null };
  for (const e of s.cellEdits) {
    if (!e) continue;
    const cells = editCells(e, geo), col = e.color ? hexToRgb(e.color) : null;
    if (e.op === "rain") { cells.forEach((i) => rainStream(grid, s, cs, i, e.len | 0)); continue; }
    const seq = e.op === "write" ? Array.from(String(e.text || ""), (ch) => (ch === " " ? -1 : charAt(cs, ch))) : [];
    cells.forEach((i, k) => {
      if (e.op === "restore") {
        glyph[i] = orig.glyph[i];
        color[i * 3] = orig.color[i * 3]; color[i * 3 + 1] = orig.color[i * 3 + 1]; color[i * 3 + 2] = orig.color[i * 3 + 2];
        if (grid.shade) grid.shade[i] = orig.shade ? orig.shade[i] : 1;
        if (grid.hidden) grid.hidden[i] = orig.hidden ? orig.hidden[i] : 0;
        return;
      }
      if (e.op === "erase") glyph[i] = -1;
      else if (e.op === "write" && seq.length) glyph[i] = seq[k % seq.length];
      else if (e.op !== "write" && e.op !== "color") return;
      if (col && (e.op === "write" || glyph[i] >= 0)) { color[i * 3] = col[0]; color[i * 3 + 1] = col[1]; color[i * 3 + 2] = col[2]; }
      if (e.op !== "color" && grid.shade) grid.shade[i] = 1;
      if (grid.hidden) grid.hidden[i] = 0; // no longer part of a hidden message
    });
  }
}

// ---------- Matrix rain ----------
// Streams of characters falling from the shape (rainFrom "object": from its lower edges into the empty space
// below, heads 1..rainDistance cells from the edge, stopping at the next shape) or over the whole image
// ("everywhere": full strength where they cross the shape, rainOutside elsewhere, picking up the shape's colours
// in "art" mode). A stream is rainLength cells (± rainLengthVar) with its head, the bright end, lowest; the tail
// fades by rainFade through the per-cell opacity grid.shade. rainAngle slants the fall. Characters come from
// cs.rain (see rainSpec). The shape is every cell with a visible character before the rain, so light areas
// that got a blank count as empty. Randomness is hashed from rainSeed and cell positions, so the preview,
// apply and batch match. Hidden messages are left alone.
function applyRain(grid, s, cs) {
  const { cols, rows, glyph, color } = grid, cells = cols * rows, seed = (s.rainSeed | 0) + 307, artSrc = rainArtSource(grid, s);
  if (!cs.rain || !itemStream(cs, cs.rain, seed)) return;
  const shape = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) shape[i] = glyph[i] >= 0 && cs.cov[glyph[i]] > 0 ? 1 : 0;
  if (!grid.shade) grid.shade = new Float32Array(cells).fill(1);
  const shade = grid.shade, hidden = grid.hidden, everywhere = s.rainFrom === "everywhere";
  const slope = Math.tan((Math.max(-60, Math.min(60, s.rainAngle)) * Math.PI) / 180), L = Math.max(1, Math.round(s.rainLength));
  const fade = clamp01(s.rainFade), outside = clamp01(s.rainOutside), amount = clamp01(s.rainAmount), gaps = clamp01(s.rainGaps) * 0.7;
  const own = hexToRgb(s.rainColor), head = hexToRgb(s.rainHeadColor);
  const stops = (s.rainGradientMid ? s.rainGradient : [s.rainGradient[0], s.rainGradient[2]]).map(hexToRgb);
  const lenOf = (a, b) => Math.max(1, Math.round(L * (1 + clamp01(s.rainLengthVar) * (hash3(seed + 1, a, b) * 2 - 1))));
  let id = 0;
  // one stream along the fall from cell (c0, r0): steps k0..k1 (k1 = the head), step k at row r0 + k
  const stream = (c0, r0, k0, k1, artRgb) => {
    const next = itemStream(cs, cs.rain, seed + 1000 + id++), len = k1 - k0 + 1;
    let art = artRgb;
    for (let k = k0; k <= k1; k++) {
      const g = next(); // taken even for skipped cells, so words stay in order along the stream
      const r = r0 + k, c = c0 + Math.round(k * slope);
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const i = r * cols + c;
      if (shape[i]) { if (!everywhere) break; art = artSrc.slice(i * 3, i * 3 + 3); }
      if (g < 0 || (hidden && hidden[i]) || (gaps && hash3(seed + 2, c, r) < gaps)) continue;
      const t = (k - k0 + 1) / len, isHead = k === k1 && s.rainHead;
      const col = isHead ? head : s.rainColorMode === "gradient" ? gradientAt(stops, t) : s.rainColorMode === "art" && art ? art : own;
      glyph[i] = g;
      color[i * 3] = clamp255(col[0]); color[i * 3 + 1] = clamp255(col[1]); color[i * 3 + 2] = clamp255(col[2]);
      shade[i] = isHead ? 1 : (1 - fade * (1 - t)) * (everywhere && !shape[i] ? outside : 1);
    }
  };
  if (!everywhere) {
    const D = Math.max(1, Math.round(s.rainDistance)), dc = Math.round(slope);
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, below = c + dc;
      if (!shape[i] || below < 0 || below >= cols || shape[(r + 1) * cols + below]) continue; // not a lower edge
      if (hash3(seed, c, r) >= amount) continue;
      const len = lenOf(c, r), far = 1 + Math.floor(hash3(seed + 3, c, r) * D);
      stream(c, r, Math.max(1, far - len + 1), far, artSrc.slice(i * 3, i * 3 + 3));
    }
  } else {
    // a line of streams per column, starting above the top row (slanted lines also from beyond the sides)
    const span = Math.ceil(rows * Math.abs(slope)) + 1, slot = L * (1.3 + (1 - amount) * 3);
    for (let c = -span; c < cols + span; c++) {
      for (let j = 0, y = -L - hash3(seed + 4, c, 0) * slot; y < rows; j++, y += slot) {
        if (hash3(seed + 5, c, j) >= amount) continue;
        const len = lenOf(c, j + 7919), hy = Math.round(y + hash3(seed + 6, c, j) * slot);
        stream(c, 0, hy - len + 1, hy, null);
      }
    }
  }
}

// Glyph colour per cell: one colour, the image's own colours, or a gradient map of the ink.
function cellColors(g, s) {
  const { rgb, ink } = g, cells = g.cols * g.rows, color = new Uint8Array(cells * 3);
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
  return color;
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
  const alpha = grid.alpha, shade = grid.shade || new Float32Array(cols * rows); // move with the glyphs
  if (s.gStutter > 0) for (let r = 1; r < rows; r++) if (hash3(seed + 31, r, 0) < s.gStutter * 0.3) {
    glyph.copyWithin(r * cols, (r - 1) * cols, r * cols); color.copyWithin(r * cols * 3, (r - 1) * cols * 3, r * cols * 3);
    alpha.copyWithin(r * cols, (r - 1) * cols, r * cols); shade.copyWithin(r * cols, (r - 1) * cols, r * cols);
  }
  if (s.gRowShift > 0) for (let r = 0; r < rows; r++) if (hash3(seed + 32, r, 0) < s.gRowShift * 0.4) {
    const k = ((Math.round((hash3(seed + 33, r, 0) * 2 - 1) * s.gRowShift * cols * 0.3) % cols) + cols) % cols;
    if (!k) continue;
    const g = glyph.slice(r * cols, (r + 1) * cols), c = color.slice(r * cols * 3, (r + 1) * cols * 3), al = alpha.slice(r * cols, (r + 1) * cols), sh = shade.slice(r * cols, (r + 1) * cols);
    for (let x = 0; x < cols; x++) { const sx = (x - k + cols) % cols; glyph[r * cols + x] = g[sx]; alpha[r * cols + x] = al[sx]; shade[r * cols + x] = sh[sx]; color.set(c.subarray(sx * 3, sx * 3 + 3), (r * cols + x) * 3); }
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

// ---------- shadows ----------
const hasShadow = (s) => s.dropOn || s.longOn || s.offOn || s.glowOn;
function blurField(a, w, h, sigma) { // three box passes ≈ Gaussian, edges clamped
  if (sigma < 0.4) return a;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4)), tmp = new Float32Array(w * h), acc = new Float64Array(w);
  for (let pass = 0; pass < 3; pass++) {
    const r = ((pass < m ? wl : wl + 2) - 1) >> 1, inv = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w; let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[row + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) { tmp[row + x] = acc * inv; acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; }
    }
    // columns run side by side (one running sum each), so memory is read row by row
    acc.fill(0);
    for (let k = -r; k <= r; k++) { const row = Math.min(h - 1, Math.max(0, k)) * w; for (let x = 0; x < w; x++) acc[x] += tmp[row + x]; }
    for (let y = 0; y < h; y++) {
      const row = y * w, add = Math.min(h - 1, y + r + 1) * w, sub = Math.max(0, y - r) * w;
      for (let x = 0; x < w; x++) { a[row + x] = acc[x] * inv; acc[x] += tmp[add + x] - tmp[sub + x]; }
    }
  }
  return a;
}
function shiftField(a, w, h, dx, dy) { // bilinear translate, empty outside
  const out = new Float32Array(w * h), ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy;
  const g = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? a[y * w + x] : 0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x - ix, sy = y - iy;
    out[y * w + x] = (g(sx, sy) * (1 - fx) + g(sx - 1, sy) * fx) * (1 - fy) + (g(sx, sy - 1) * (1 - fx) + g(sx - 1, sy - 1) * fx) * fy;
  }
  return out;
}
// Long shadow: every glyph pixel casts a trail `len` px long along (dx, dy). One sweep along the dominant
// axis carries the trail forward, losing 1/len per px travelled: the result is 1 at the glyph, 0 at the end.
function extrude(a, w, h, dx, dy, len) {
  const S = Float32Array.from(a);
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = Math.sign(dx) || 1, slope = dy / Math.abs(dx), dec = Math.hypot(1, slope) / len;
    for (let k = 1; k < w; k++) {
      const x = sx > 0 ? k : w - 1 - k, px = x - sx;
      for (let y = 0; y < h; y++) {
        const fy = y - slope, iy = Math.floor(fy), f = fy - iy;
        const prev = (iy >= 0 && iy < h ? S[iy * w + px] : 0) * (1 - f) + (iy + 1 >= 0 && iy + 1 < h ? S[(iy + 1) * w + px] : 0) * f;
        const v = prev - dec, i = y * w + x;
        if (v > S[i]) S[i] = v;
      }
    }
  } else {
    const sy = Math.sign(dy) || 1, slope = dx / Math.abs(dy), dec = Math.hypot(1, slope) / len;
    for (let k = 1; k < h; k++) {
      const y = sy > 0 ? k : h - 1 - k, py = y - sy;
      for (let x = 0; x < w; x++) {
        const fx = x - slope, ix = Math.floor(fx), f = fx - ix;
        const prev = (ix >= 0 && ix < w ? S[py * w + ix] : 0) * (1 - f) + (ix + 1 >= 0 && ix + 1 < w ? S[py * w + ix + 1] : 0) * f;
        const v = prev - dec, i = y * w + x;
        if (v > S[i]) S[i] = v;
      }
    }
  }
  return S;
}
// Renders the characters alone over an area grown by the shadows' reach, builds the shadows from their
// coverage, and stacks background, shadows and characters. Strip-safe: every strip sees the same neighbourhood.
function renderWithShadows(grid, cs, atlas, s, view) {
  const sc = view.scale, F = grid.geo.size * sc, W = view.w, H = view.h;
  const reach = Math.max(s.longOn ? s.longLength : 0, s.dropOn ? s.dropDistance + 1.6 * s.dropSize : 0, s.offOn ? s.offDistance : 0, s.glowOn ? 1.6 * s.glowSize : 0);
  const M = Math.ceil(reach * F) + 2, EW = W + 2 * M, EH = H + 2 * M;
  const off = { dropOn: false, longOn: false, offOn: false, glowOn: false, glitchOn: false };
  const G = render(grid, cs, atlas, Object.assign({}, s, off, { bgMode: "transparent", keepAlpha: false }), { x: view.x - M / sc, y: view.y - M / sc, w: EW, h: EH, scale: sc });
  const out = new Uint8ClampedArray(render(grid, cs, atlas, Object.assign({}, s, off, { _noGlyphs: true }), view).buffer);
  const A = new Float32Array(EW * EH);
  for (let i = 0; i < A.length; i++) A[i] = G[i * 4 + 3] / 255;
  const ang = (s.shadowAngle * Math.PI) / 180, dx = -Math.cos(ang), dy = Math.sin(ang); // where shadows fall
  const layers = []; // [alpha field, rgb or per-pixel rgb fn, opacity], bottom first
  if (s.longOn) {
    const L = Math.max(1, s.longLength * F), S = extrude(A, EW, EH, dx, dy, L), fade = clamp01(s.longFade);
    for (let i = 0; i < S.length; i++) S[i] = S[i] > 0 ? fade * S[i] + (1 - fade) * Math.min(1, S[i] * L) : 0;
    layers.push([S, hexToRgb(s.longColor), s.longOpacity]);
  }
  if (s.dropOn) layers.push([blurField(shiftField(A, EW, EH, dx * s.dropDistance * F, dy * s.dropDistance * F), EW, EH, (s.dropSize * F) / 2), hexToRgb(s.dropColor), s.dropOpacity]);
  if (s.offOn) layers.push([shiftField(A, EW, EH, dx * s.offDistance * F, dy * s.offDistance * F), hexToRgb(s.offColor), s.offOpacity]);
  if (s.glowOn) {
    const sig = (s.glowSize * F) / 2, B = blurField(Float32Array.from(A), EW, EH, sig);
    let col = hexToRgb(s.glowColor);
    if (s.glowTextColor) { // the characters' own colours, spread with the glow
      const R = new Float32Array(EW * EH), Gc = new Float32Array(EW * EH), Bc = new Float32Array(EW * EH);
      for (let i = 0; i < A.length; i++) { R[i] = G[i * 4] * A[i]; Gc[i] = G[i * 4 + 1] * A[i]; Bc[i] = G[i * 4 + 2] * A[i]; }
      blurField(R, EW, EH, sig); blurField(Gc, EW, EH, sig); blurField(Bc, EW, EH, sig);
      col = (i) => (B[i] > 1e-4 ? [R[i] / B[i], Gc[i] / B[i], Bc[i] / B[i]] : [0, 0, 0]);
    }
    for (let i = 0; i < B.length; i++) B[i] = Math.min(1, B[i] * 2);
    layers.push([B, col, s.glowOpacity]);
  }
  const nL = layers.length, LF = layers.map((l) => l[0]), LC = layers.map((l) => l[1]), LO = layers.map((l) => l[2]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, e = (y + M) * EW + x + M;
      for (let j = 0; j < nL; j++) {
        const a = LF[j][e] * LO[j];
        if (a <= 0.002) continue;
        const col = LC[j], c = typeof col === "function" ? col(e) : col;
        blendPx(out, o, c[0], c[1], c[2], Math.min(1, a));
      }
      const ga = G[e * 4 + 3];
      if (ga) blendPx(out, o, G[e * 4], G[e * 4 + 1], G[e * 4 + 2], ga / 255);
    }
  }
  if (s.glitchOn) glitchOutput(out, view, grid.geo, s);
  return new Uint8Array(out.buffer);
}

const MARK_RGB = [0, 230, 255];
// view: {x, y} top-left in document px, {w, h} output px, scale = output px per document px.
// Returns straight-alpha RGBA Uint8Array.
function render(grid, cs, atlas, s, view) {
  if (hasShadow(s)) return renderWithShadows(grid, cs, atlas, s, view);
  const noGlyphs = !!s._noGlyphs; // background only (shadows are stacked between it and the characters)
  const { cols, rows, geo, glyph, rgb, alpha, shade } = grid;
  let color = grid.color;
  if (s._markHidden && grid.hidden) { // preview only: hidden messages in a signal colour
    color = Uint8Array.from(color);
    grid.hidden.forEach((h, ci) => { if (h) color.set(MARK_RGB, ci * 3); });
  }
  const sc = view.scale, W = view.w, H = view.h;
  const out = new Uint8ClampedArray(W * H * 4);
  const bg = hexToRgb(s.bg), op = clamp01(s.glyphOpacity);
  const mosaic = s.bgMode === "mosaic", mAmt = clamp01(s.mosaicAmount);
  // keep the source's transparency: the background fades out where the source is transparent
  let masked = false;
  if (s.keepAlpha && alpha) for (let i = 0; i < alpha.length && !masked; i++) masked = alpha[i] < 255;
  const bgA = clamp01(s.bgOpacity === undefined ? 1 : s.bgOpacity);
  if (s.bgMode !== "transparent" && !masked) {
    const a = Math.round(255 * bgA);
    for (let o = 0; o < out.length; o += 4) { out[o] = bg[0]; out[o + 1] = bg[1]; out[o + 2] = bg[2]; out[o + 3] = a; }
  } else if (s.bgMode === "solid") {
    // cell coverage, interpolated between cell centres in document space (strip-safe, follows the silhouette)
    const xi = new Int32Array(W * 2), xf = new Float32Array(W), yi = new Int32Array(H * 2), yf = new Float32Array(H);
    for (let x = 0; x < W; x++) { const u = (view.x + (x + 0.5) / sc) / geo.cellW - 0.5, i = Math.floor(u); xi[x * 2] = Math.max(0, Math.min(cols - 1, i)); xi[x * 2 + 1] = Math.max(0, Math.min(cols - 1, i + 1)); xf[x] = u - i; }
    for (let y = 0; y < H; y++) { const u = (view.y + (y + 0.5) / sc) / geo.cellH - 0.5, i = Math.floor(u); yi[y * 2] = Math.max(0, Math.min(rows - 1, i)); yi[y * 2 + 1] = Math.max(0, Math.min(rows - 1, i + 1)); yf[y] = u - i; }
    for (let y = 0; y < H; y++) {
      const r0 = yi[y * 2] * cols, r1 = yi[y * 2 + 1] * cols, fy = yf[y];
      for (let x = 0, o = y * W * 4; x < W; x++, o += 4) {
        const c0 = xi[x * 2], c1 = xi[x * 2 + 1], fx = xf[x];
        const a = (alpha[r0 + c0] * (1 - fx) + alpha[r0 + c1] * fx) * (1 - fy) + (alpha[r1 + c0] * (1 - fx) + alpha[r1 + c1] * fx) * fy;
        out[o] = bg[0]; out[o + 1] = bg[1]; out[o + 2] = bg[2]; out[o + 3] = a * bgA;
      }
    }
  }
  const mosaicColor = (ci) => [bg[0] + (rgb[ci * 3] - bg[0]) * mAmt, bg[1] + (rgb[ci * 3 + 1] - bg[1]) * mAmt, bg[2] + (rgb[ci * 3 + 2] - bg[2]) * mAmt];
  const cw = geo.cellW * sc, ch = geo.cellH * sc, gw = geo.glyphW * sc, gh = geo.glyphH * sc;
  const c0 = Math.max(0, Math.floor(view.x / geo.cellW)), c1 = Math.min(cols, Math.ceil((view.x + W / sc) / geo.cellW));
  const r0 = Math.max(0, Math.floor(view.y / geo.cellH)), r1 = Math.min(rows, Math.ceil((view.y + H / sc) / geo.cellH));
  // Pixel positions are rounded in document space and then moved by the view's whole-pixel offset, so strips of
  // one render agree where they meet (rounding after the move can flip a .5 tie and tear a glyph by 1 px).
  const vx = view.x * sc, vy = view.y * sc, vxi = Math.floor(vx + 1e-9), vyi = Math.floor(vy + 1e-9), vxf = vx - vxi, vyf = vy - vyi;

  if (gw >= 3 && gh >= 3) {
    const igw = Math.round(gw), igh = Math.round(gh), cache = new Map();
    for (let r = r0; r < r1; r++) {
      const ay = r * geo.cellH * sc; // the row's top in output px, before the view's offset
      for (let c = c0; c < c1; c++) {
        const ci = r * cols + c, ax = c * geo.cellW * sc;
        if (mosaic) {
          const [mr, mg, mb] = mosaicColor(ci);
          // edges from the cell grid itself, so neighbouring blocks share them exactly (no gap rows)
          const xa = Math.max(0, Math.round(ax - vxf) - vxi), xe = Math.min(W, Math.round((c + 1) * geo.cellW * sc - vxf) - vxi);
          const ya = Math.max(0, Math.round(ay - vyf) - vyi), ye = Math.min(H, Math.round((r + 1) * geo.cellH * sc - vyf) - vyi);
          const ma = (masked ? alpha[ci] : 255) * bgA;
          for (let y = ya; y < ye; y++) for (let x = xa, o = (y * W + xa) * 4; x < xe; x++, o += 4) { out[o] = mr; out[o + 1] = mg; out[o + 2] = mb; out[o + 3] = ma; }
        }
        const gi = glyph[ci];
        if (noGlyphs || gi < 0 || cs.cov[gi] <= 0) continue;
        let bm = cache.get(gi);
        if (!bm) { bm = resampleGlyph(atlas, cs.glyphs[gi], igw, igh); cache.set(gi, bm); }
        const gx = Math.round(ax + (cw - igw) / 2 - vxf) - vxi, gy = Math.round(ay + (ch - igh) / 2 - vyf) - vyi;
        const cr = color[ci * 3], cg = color[ci * 3 + 1], cb = color[ci * 3 + 2], opc = shade ? op * shade[ci] : op;
        const ya = Math.max(0, gy), ye = Math.min(H, gy + igh), xa = Math.max(0, gx), xe = Math.min(W, gx + igw);
        for (let y = ya; y < ye; y++) {
          const brow = (y - gy) * igw - gx;
          for (let x = xa, o = (y * W + xa) * 4; x < xe; x++, o += 4) {
            const a = bm[brow + x];
            if (a) blendPx(out, o, cr, cg, cb, (a / 255) * opc);
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
        if (mosaic) { const m = mosaicColor(ci); out[o] = m[0]; out[o + 1] = m[1]; out[o + 2] = m[2]; out[o + 3] = (masked ? alpha[ci] : 255) * bgA; }
        const gi = glyph[ci];
        if (gi >= 0 && !noGlyphs) blendPx(out, o, color[ci * 3], color[ci * 3 + 1], color[ci * 3 + 2], cs.cov[gi] * areaK * (shade ? shade[ci] : 1));
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

// Per-cell colours in text exports: colour modes other than mono, the rain (its own colours, with the fade
// mixed into the background where there is one) and recoloured symbol edits.
const perCellColor = (s) => s.colorMode !== "mono" || s.rainOn || (s.cellEdits || []).some((e) => e && e.color);
function colorRuns(grid, cs, r, s) {
  const runs = [], fadeTo = s.rainOn && grid.shade && s.bgMode !== "transparent" ? hexToRgb(s.bg) : null;
  let cur = null;
  for (let c = 0; c < grid.cols; c++) {
    const ci = r * grid.cols + c, gi = grid.glyph[ci];
    const ch = gi < 0 ? " " : cs.chars[gi];
    let hex = s.fg;
    if (perCellColor(s)) {
      const a = fadeTo ? grid.shade[ci] : 1, mix = (k) => clamp255(fadeTo ? fadeTo[k] + (grid.color[ci * 3 + k] - fadeTo[k]) * a : grid.color[ci * 3 + k]);
      hex = rgbToHex(mix(0), mix(1), mix(2));
    }
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
    for (const run of colorRuns(grid, cs, r, s)) body += !perCellColor(s) ? esc(run.text) : `<span style="color:${run.hex}">${esc(run.text)}</span>`;
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
    const inner = !perCellColor(s) ? esc(runs.map((x) => x.text).join("")) : runs.map((x) => `<tspan fill="${x.hex}">${esc(x.text)}</tspan>`).join("");
    parts.push(`<text x="${((g.cellW - g.glyphW) / 2).toFixed(2)}" y="${y}" textLength="${((grid.cols - 1) * g.cellW + g.glyphW).toFixed(2)}" lengthAdjust="spacing">${inner}</text>`);
  }
  parts.push("</g></svg>");
  return parts.join("\n");
}

const Engine = { DIFFUSION, ORDERED, resampleGlyph, DEFAULTS, prepareAtlas, buildCharset, parseCustom, charsetParts, charsetOf, computeGeometry, computeGrid, editCells, render, flattenForPreview, gridLines, toText, toHTML, toSVG, hexToRgb, rgbToHex, luma };
if (typeof module !== "undefined") module.exports = Engine;
