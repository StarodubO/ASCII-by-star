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
  extraChars: "", // with a built-in character set: its {messages} and [fill] (see customOf); other characters are ignored
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
  // cell backgrounds: an effect behind each character, made from its colour (see drawCellFx)
  cfOn: false, cfFill: "gradient", cfFrom: "glyph", cfShade: -0.45, cfTo: "transparent", cfToColor: "#000000", // solid | gradient | glow | bleed
  cfAngle: 90, cfOpacity: 0.85, cfOnlyGlyphs: true, cfGap: 0.06, cfRound: 0.2, cfSpread: 1.5, cfBlend: "normal", // normal | screen | multiply | add
  cfGlitch: 0, cfLines: 0, cfLineCount: 4, cfGrain: 0, cfGrainSize: 0.06, cfSeed: 1,
  cfGradShape: "linear", cfGradSpan: "cell", cfGradReverse: false, cfGradMidOn: false, cfGradMid: "#ffffff", // linear | reflected | radial | diamond | angle; cell | image
  cfGradMidpoint: 0.5, cfGradSteps: 0, cfGradRepeat: 1, // where the halfway colour sits; 0 = smooth; ping-pong repeats
  cfDepthCount: 5, cfDepthPull: 0.3, cfDepthWidth: 0.08, cfDepthAim: 0, cfDepthFade: 0.6, // the "depth" fill: nested outlines
  // depth echo: copies of parts scaled around a vanishing point (see drawEcho)
  echoOn: false, echoOutline: true, echoRain: false, echoText: false, echoDir: "out", echoCount: 6, echoStep: 0.18, echoFade: 0.6, // out | in
  echoCentre: "shape", echoX: 0.5, echoY: 0.5, echoColorMode: "same", echoColor: "#000000", // shape | point; same | tint
  // outline for hard-edged shapes (text, logos); see applyOutline
  outlineOn: false, outlineLevel: 0.5, outlineWidth: 1, outlinePos: "outside", // outside | center | inside
  outlineStyle: "lines", outlineChars: "#", outlineColor: "#ff2a6d", // lines (follow the edge) | chars (your text)
  outlineFill: "image", outlineFillChars: ".", outlineFillMode: "ramp", // image | none | text (your text: ramp | words | phrase)
  outlineOpacity: 1, outlineFillOpacity: 1, // of the stroke's and the inside's characters
  outlineColorFrom: "own", // own (outlineColor) | under (the layer below) | image (the source's colours)
  // outer ring: the shape scaled around its centre, and what fills the band between (see outlineRing)
  outlineRingOn: false, outlineRingScale: 1.8, outlineRingStroke: true, outlineRingFill: "rain", outlineRingChars: "[?01]", // none | text | rays | rain
  outlineRingDensity: 0.6, outlineRingDir: "out", outlineRingTwist: 0, // out | in
  outlineRingOpacity: 1, outlineRingFillOpacity: 1, outlineRingFade: 0, // the outer ring's, the band's; band fade: + towards the ring, − towards the shape
  outlineRingColorFrom: "stroke", outlineRingColor: "#ffffff", outlineRingTextColorFrom: "stroke", outlineRingTextColor: "#ffffff", // stroke | own | under | image
  // the ring's own rain (see RING_RAIN): characters, streams, head, colours and seed, like the Matrix rain's
  rrCharset: "katakana_half", rrChars: "01", rrLength: 8, rrLengthVar: 0.5, rrGaps: 0, rrFade: 0.8, rrHead: true, rrHeadColor: "#ffffff",
  rrColorMode: "own", rrColor: "#00ff41", rrGradient: ["#003b00", "#00c832", "#b8ffb8"], rrGradientMid: true, rrSeed: 1,
  hideSeed: 1, // where hidden {messages} go
  cellEdits: [], // symbols changed by hand (Edit symbols; see applyEdits)
  // text art (the Text art tab): with textArtOn the grid is this text instead of the image (see textArtAnalysis)
  textArtOn: false, textArt: "", textArtFont: "", textArtFit: true, textArtMargin: 2, // fit: the font size makes the art fill the area, margin cells around it
  // line art (the Lines tab): with linesArtOn the grid comes from the contour or ridge lines (see linesArtSource)
  linesArtOn: false, linesArtLabel: "",
  // [ ] fill in custom text (see parseCustom)
  fillLevel: 0.5, // with ramp characters outside the brackets: cells darker than this get the fill
  fillSeed: 1, // order of [?random] items
  // {messages} and [ ] fills in their own colour wherever they are written (see colorSpecial)
  msgColorFrom: "keep", msgColor: "#ff2a6d", msgOpacity: 1, // keep (as the text around them) | own | image | under
  fillColorFrom: "keep", fillColor: "#00e5ff", fillOpacity: 1,
  // Matrix rain (inert unless rainOn; see applyRain). Lengths and distances are in character cells.
  rainOn: false, rainFrom: "object", // object (falls from the shape's lower edges) | everywhere (the whole image)
  rainCharset: "katakana_half", rainChars: "01", // a character set id, or "custom" for rainChars ([ ] syntax works)
  rainLength: 8, rainLengthVar: 0.5, rainAmount: 0.5, rainDistance: 24, rainGaps: 0, rainAngle: 0,
  rainDir: "down", rainCentre: "shape", rainCX: 0.5, rainCY: 0.5, rainTwist: 0, rainHole: 0.05, // down | out | in (along rays); shape | point
  rainFade: 0.8, rainHead: true, rainHeadColor: "#ffffff", rainOutside: 0.4, rainSeed: 1,
  rainColorMode: "own", rainColor: "#00ff41", // own | art (the shape's colours) | gradient (tail → head) | under (the layer below)
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

// Settings saved by older versions, brought up to date (in place; returns s). The panel runs every loaded
// setting through it (freshSettings), so the rest of the engine only knows current values.
function migrateSettings(s) {
  if (s.dither === "bayer") s.dither = "bayer4"; // renamed in 1.2
  // 2.0.1: the outline's inside is "Your text": "in order" became its phrase, "random" a [? ] fill
  if (s.outlineFill === "chars") Object.assign(s, { outlineFill: "text", outlineFillMode: "phrase" });
  else if (s.outlineFill === "random") {
    const t = Array.from(String(s.outlineFillChars || "")).filter((ch) => ch.trim() && !"[]|?".includes(ch)).join("");
    Object.assign(s, { outlineFill: "text", outlineFillMode: "ramp", outlineFillChars: t ? "[?" + t + "]" : "" });
  }
  // 2.1.1: the cell "glow" fill is the radial gradient shape
  if (s.cfFill === "glow") Object.assign(s, { cfFill: "gradient", cfGradShape: "radial", cfGradSpan: "cell", cfGradMidOn: false, cfGradReverse: false });
  return s;
}

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
  return { n, glyphs, cov, level, vec, lut, chars, charIndex, rain: (opts && opts.rain) || null, ringRain: (opts && opts.ringRain) || null, atlas };
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
// The custom text the grid uses: Custom text, or with a built-in character set the {messages} and [fill] added
// to it (extraChars, without its plain characters: the set stays the ramp).
function customOf(s) {
  if (s.charset === "custom") return parseCustom(s.customChars);
  if (!s.extraChars) return null;
  const p = parseCustom(s.extraChars);
  return p.messages.length || p.fill ? { text: "", messages: p.messages, fill: p.fill } : null;
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

// The outer ring's rain has its own copy of the rain settings: rain setting → ring setting. ringRainSettings(s)
// is s with those in the rain's places, so the rain code draws the ring's rain as it is.
const RING_RAIN = { rainCharset: "rrCharset", rainChars: "rrChars", rainLength: "rrLength", rainLengthVar: "rrLengthVar", rainGaps: "rrGaps", rainFade: "rrFade",
  rainHead: "rrHead", rainHeadColor: "rrHeadColor", rainColorMode: "rrColorMode", rainColor: "rrColor", rainGradient: "rrGradient", rainGradientMid: "rrGradientMid", rainSeed: "rrSeed" };
function ringRainSettings(s) {
  const v = Object.assign({}, s, { rainArtLook: null }); // "the shape's colours": the cells' colours as they are
  for (const [k, rk] of Object.entries(RING_RAIN)) v[k] = s[rk];
  return v;
}
const ringRainOn = (s) => s.outlineOn && s.outlineRingOn && s.outlineRingFill === "rain";

// {messages} hidden in the rain (its custom text).
const rainMessages = (s) => (s.rainCharset === "custom" ? parseCustom(s.rainChars).messages : []);

const OUTLINE_LINES = "|/-\\"; // edge lines by direction: vertical, rising, horizontal, falling
// The characters the settings draw with: the ramp (custom text without its hidden messages and fill) and the
// extras. rainPresetChars / ringPresetChars: the characters of the rain's and the ring rain's character sets.
function charsetParts(s, presetChars, rainPresetChars, ringPresetChars) {
  const custom = customOf(s);
  const own = (p) => p.text + p.messages.map((m) => m.text).join("") + specChars(p.fill); // every character a custom text draws
  let extra = custom ? custom.messages.map((m) => m.text).join("") + specChars(custom.fill) : "";
  if (s.outlineOn) {
    const stroke = s.outlineStyle === "chars" ? parseCustom(s.outlineChars) : null, inner = outlineFillText(s);
    extra += stroke ? own(stroke) : OUTLINE_LINES;
    if (inner) extra += own(parseCustom(inner.text));
    if (s.outlineRingOn && (s.outlineRingFill === "text" || s.outlineRingFill === "rays")) extra += own(parseCustom(s.outlineRingChars));
  }
  const rain = s.rainOn || (s.cellEdits || []).some((x) => x && x.op === "rain") ? rainSpec(s, rainPresetChars) : null;
  extra += specChars(rain);
  if (rain) extra += rainMessages(s).map((m) => m.text).join("");
  const rs = ringRainOn(s) ? ringRainSettings(s) : null, ringRain = rs ? rainSpec(rs, ringPresetChars) : null;
  if (ringRain) extra += specChars(ringRain) + rainMessages(rs).map((m) => m.text).join("");
  if (s.textArtOn) extra += textArtLines(s).join("");
  if (s.cellEdits && s.cellEdits.length) extra += s.cellEdits.map((e) => (e.op === "write" && e.text ? own(parseCustom(e.text)) : "")).join("");
  return { ramp: s.charset === "custom" ? custom.text : presetChars, extra, spread: s.dither === "none", rain, ringRain };
}
function charsetOf(atlas, s, presetChars, rainPresetChars, ringPresetChars) {
  const p = charsetParts(s, presetChars, rainPresetChars, ringPresetChars);
  return buildCharset(atlas, p.ramp, s.sortByDensity, p);
}

// ---------- geometry ----------
function computeGeometry(docW, docH, s, atlas) {
  const adv = atlas.cellW / atlas.fontSize, line = atlas.cellH / atlas.fontSize;
  let size = s.size;
  if (s.sizeMode === "cols") size = docW / (Math.max(1, s.columns) * adv * s.spacingX);
  if (s.textArtOn && s.textArtFit) { // the text art and its margin fill the area, as wide or as tall as it allows
    const lines = textArtLines(s), m = 2 * Math.max(0, Math.round(s.textArtMargin));
    const w = Math.max(1, ...lines.map((l) => Array.from(l).length)) + m, h = lines.length + m;
    size = Math.min(docW / (w * adv * s.spacingX), docH / (h * line * s.lineHeight));
  }
  size = Math.max(1, size);
  const glyphW = size * adv, glyphH = size * line;
  const cellW = glyphW * s.spacingX, cellH = glyphH * s.lineHeight;
  return { docW, docH, size, glyphW, glyphH, cellW, cellH, cols: Math.ceil(docW / cellW - 1e-6), rows: Math.ceil(docH / cellH - 1e-6) };
}

function inkFromBright(s) {
  let fromBright;
  // a source coloured from the layer below is usually dark text or a shape on its own layer: dark is ink
  if (s.bgMode === "transparent") fromBright = s.colorMode === "under" ? false : s.colorMode !== "mono" || luma(hexToRgb(s.fg)) > 0.5;
  else if (s.colorMode === "mono") fromBright = luma(hexToRgb(s.fg)) >= luma(hexToRgb(s.bg));
  else fromBright = luma(hexToRgb(s.bg)) < 0.5;
  return s.invert ? !fromBright : fromBright;
}

// ---------- analysis: source -> grid of glyphs ----------
// src: {w, h, data: Uint8Array RGBA} covering the whole document at any resolution.
function computeGrid(src, geo, s, cs) {
  if (s.textArtOn) { const an = textArtAnalysis(src, geo, s); return finishGrid(an, textArtGlyphs(an, s, cs), s, cs); }
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
  // line art (the Lines tab, drawn on transparent): every line pixel is ink, whatever its colour
  if (s.linesArtOn) toneLut.fill(1);
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
  const under = src.under ? cellUnder(src, geo, rgb) : null, an = { cols, rows, ink, sub, rgb, alpha, geo, under };
  return finishGrid(an, selectGlyphs(an, s, cs), s, cs);
}
// Everything after the characters are chosen: fills, outline, hidden messages, rain, edits, glitch.
function finishGrid(an, grid, s, cs) {
  if (an.under) grid.under = an.under;
  const custom = customOf(s);
  if (custom && custom.fill) applyFill(grid, s, cs, custom.fill, s.charset !== "custom" || custom.text.trim() !== "");
  const track = s._parts || s.echoOn ? partTracker(grid) : null; // which stage drew each cell (grid.part): separate layers, depth echo
  if (s.outlineOn) { applyOutline(grid, s, cs, an); if (track) track(PART.outline); }
  if (custom) hideMessages(grid, s, cs, custom.messages);
  if (s.rainOn) { applyRain(grid, s, cs); if (track) track(PART.rain); }
  if (s.cellEdits && s.cellEdits.length) { applyEdits(grid, s, cs); if (track) track(PART.edits); }
  colorSpecial(grid, s);
  if (track && grid.hidden) grid.hidden.forEach((h, i) => { if (h) grid.part[i] = PART.hidden; });
  return s.glitchOn ? glitchGrid(grid, cs, s) : grid;
}

// Hidden {messages} (grid.hidden) and [ ] fills (grid.filled) in their own colour and opacity, wherever they were
// written: Custom text, the text added to a character set, the outline, the outer ring and symbol edits. From:
// keep (as the text around them), own (msgColor / fillColor), image (the source's colours) or under (the layer
// below). Opacity goes through grid.shade. A message wins over a fill; the rain's own [ ] keeps the rain's colours.
const specialColors = (s) => (s.msgColorFrom && s.msgColorFrom !== "keep") || (s.fillColorFrom && s.fillColorFrom !== "keep");
function colorSpecial(grid, s) {
  const { glyph, hidden, filled } = grid, cells = grid.cols * grid.rows;
  for (const [mask, from, hex, opacity, isFill] of [[hidden, s.msgColorFrom, s.msgColor, s.msgOpacity, false], [filled, s.fillColorFrom, s.fillColor, s.fillOpacity, true]]) {
    if (!mask) continue;
    const set = from && from !== "keep" ? colorSetter(grid, from, hex) : null, op = opacity === undefined ? 1 : clamp01(opacity);
    if (!set && op >= 1) continue;
    if (op < 1 && !grid.shade) grid.shade = new Float32Array(cells).fill(1);
    for (let i = 0; i < cells; i++) {
      if (!mask[i] || glyph[i] < 0 || (isFill && hidden && hidden[i])) continue;
      if (set) set(i);
      if (op < 1) grid.shade[i] *= op;
    }
  }
}

// ---------- text art ----------
// The Text art tab's FIGlet text, used as the picture: its characters sit in the middle of the grid, as they are
// (no tone matching). Cells with a character count as fully inked, so outline, rain, hidden messages and fills
// treat the letters as the shape; the gradient colour mode runs top to bottom over the art.
const textArtLines = (s) => String(s.textArt || "").replace(/\r/g, "").replace(/\n+$/, "").split("\n");
function textArtAnalysis(src, geo, s) {
  const { cols, rows } = geo, cells = cols * rows, lines = textArtLines(s).map((l) => Array.from(l));
  const w = Math.max(0, ...lines.map((l) => l.length)), h = lines.length, c0 = Math.floor((cols - w) / 2), r0 = Math.floor((rows - h) / 2);
  const ink = new Float32Array(cells), sub = new Float32Array(cells * 9), rgb = new Uint8Array(cells * 3), alpha = new Uint8Array(cells).fill(255);
  const tone = new Float32Array(cells), chars = new Array(cells).fill(null), fg = hexToRgb(s.fg);
  for (let i = 0; i < cells; i++) rgb.set(fg, i * 3);
  lines.forEach((line, r) => line.forEach((ch, c) => {
    const y = r0 + r, x = c0 + c;
    if (ch === " " || y < 0 || x < 0 || y >= rows || x >= cols) return;
    const i = y * cols + x;
    chars[i] = ch; ink[i] = 1; sub.fill(1, i * 9, i * 9 + 9); tone[i] = h > 1 ? r / (h - 1) : 1;
  }));
  const under = src && src.under ? cellUnder(src, geo, rgb) : null;
  return { cols, rows, ink, sub, rgb, alpha, geo, under, chars, tone };
}
function textArtGlyphs(an, s, cs) {
  const glyph = Int16Array.from(an.chars, (ch) => (ch === null ? -1 : charAt(cs, ch)));
  return { cols: an.cols, rows: an.rows, geo: an.geo, glyph, color: cellColors(Object.assign({}, an, { ink: an.tone }), s), rgb: an.rgb, alpha: an.alpha, ink: an.ink };
}

// "The layer below": src.under is the visible image under the source layer (RGBA, the same size as src.data).
// Each cell gets its average colour there, or its own image colour where nothing lies below.
function cellUnder(src, geo, rgb) {
  const { cols, rows, cellW, cellH, docW, docH } = geo, u = src.under, sw = src.w, sh = src.h, sx = sw / docW, sy = sh / docH;
  const out = Uint8Array.from(rgb);
  for (let r = 0; r < rows; r++) {
    const y0 = Math.min(sh - 1, Math.floor(r * cellH * sy)), y1 = Math.min(sh, Math.max(y0 + 1, Math.floor((r + 1) * cellH * sy)));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.min(sw - 1, Math.floor(c * cellW * sx)), x1 = Math.min(sw, Math.max(x0 + 1, Math.floor((c + 1) * cellW * sx)));
      let tr = 0, tg = 0, tb = 0, ta = 0;
      for (let y = y0; y < y1; y++) for (let x = x0, o = (y * sw + x0) * 4; x < x1; x++, o += 4) { const a = u[o + 3]; tr += u[o] * a; tg += u[o + 1] * a; tb += u[o + 2] * a; ta += a; }
      if (ta > 0) { const ci = (r * cols + c) * 3; out[ci] = tr / ta; out[ci + 1] = tg / ta; out[ci + 2] = tb / ta; }
    }
  }
  return out;
}
const underOf = (grid) => grid.under || grid.rgb; // without a layer below: the source's own colours

// ---------- separate layers ----------
// "Apply as separate layers" renders each part of the picture on its own layer, bottom to top: background,
// cell backgrounds, shadows, then the characters split by the stage that drew them (grid.part: the image's
// characters, outline, hidden messages, rain, hand edits), and on top the glitch: only the pixels the glitch
// changes, so hiding that layer shows the clean picture. Stacked, they make the one-layer render.
const PART = { text: 0, outline: 1, hidden: 2, rain: 3, edits: 4 };
const PART_NAMES = { bg: "Background", cells: "Cell backgrounds", shadows: "Shadows", echo: "Depth echo", text: "Characters", outline: "Outline", hidden: "Hidden messages", rain: "Rain", edits: "Edits", glitch: "Glitch" };
const NO_FX = { dropOn: false, longOn: false, offOn: false, glowOn: false, glitchOn: false, cfOn: false, echoOn: false, _markHidden: false };
function partTracker(grid) {
  const { glyph, color } = grid;
  grid.part = new Uint8Array(glyph.length); // PART.text
  let g0 = glyph.slice(), c0 = color.slice();
  return (p) => { // cells whose character or colour changed since the last call belong to part p
    for (let i = 0; i < glyph.length; i++) if (glyph[i] !== g0[i] || color[i * 3] !== c0[i * 3] || color[i * 3 + 1] !== c0[i * 3 + 1] || color[i * 3 + 2] !== c0[i * 3 + 2]) grid.part[i] = p;
    g0 = glyph.slice(); c0 = color.slice();
  };
}
// The parts this picture has, bottom first. grid: computed with s._parts (and glitchOn off when glitched).
function layerParts(grid, cs, s) {
  const out = [];
  if (s.bgMode !== "transparent" && (s.bgOpacity === undefined || s.bgOpacity > 0)) out.push("bg");
  if (s.cfOn) out.push("cells");
  if (hasShadow(s)) out.push("shadows");
  if (s.echoOn && echoMask(grid, cs, s)) out.push("echo");
  const has = new Set();
  grid.glyph.forEach((g, i) => { if (g >= 0 && cs.cov[g] > 0) has.add(grid.part ? grid.part[i] : PART.text); });
  for (const k of ["text", "outline", "hidden", "rain", "edits"]) if (has.has(PART[k])) out.push(k);
  if (s.glitchOn) out.push("glitch");
  return out;
}
// One part as straight-alpha RGBA, like render. glitched: the grid computed with the glitch (for "glitch").
function renderPart(id, grid, cs, atlas, s, view, glitched) {
  const chars = Object.assign({}, s, NO_FX, { bgMode: "transparent", keepAlpha: false });
  if (id === "bg") return render(grid, cs, atlas, Object.assign({}, s, NO_FX, { _noGlyphs: true }), view);
  if (id === "cells") { const out = new Uint8ClampedArray(view.w * view.h * 4); drawCellFx(out, grid, cs, Object.assign({}, s, { cfBlend: "normal" }), view); return new Uint8Array(out.buffer); }
  if (id === "shadows") return render(grid, cs, atlas, Object.assign({}, s, { glitchOn: false, cfOn: false, echoOn: false, bgMode: "transparent", keepAlpha: false, _shadowsOnly: true }), view);
  if (id === "echo") { const out = new Uint8ClampedArray(view.w * view.h * 4); drawEcho(out, grid, cs, atlas, s, view); return new Uint8Array(out.buffer); }
  if (id === "glitch") {
    const fin = render(glitched || grid, cs, atlas, s, view), clean = render(grid, cs, atlas, Object.assign({}, s, { glitchOn: false }), view);
    for (let o = 0; o < fin.length; o += 4) {
      if (Math.abs(fin[o] - clean[o]) <= 1 && Math.abs(fin[o + 1] - clean[o + 1]) <= 1 && Math.abs(fin[o + 2] - clean[o + 2]) <= 1 && Math.abs(fin[o + 3] - clean[o + 3]) <= 1) fin[o + 3] = 0;
    }
    return fin;
  }
  const p = PART[id], glyph = grid.glyph.map((g, i) => ((grid.part ? grid.part[i] : PART.text) === p ? g : -1));
  return render(Object.assign({}, grid, { glyph }), cs, atlas, chars, view);
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

// Marks cell i as written by a [ ] fill (on) or by something else (off), for the fills' own colour (grid.filled,
// see colorSpecial). Without any fill there is no grid.filled.
function markFill(grid, i, on) {
  if (!grid.filled) { if (!on) return; grid.filled = new Uint8Array(grid.cols * grid.rows); }
  grid.filled[i] = on ? 1 : 0;
}
// [ ] fill (see parseCustom): writes the items in reading order into every inked cell or, when ramp characters
// stand outside the brackets, only into cells darker than fillLevel, leaving the rest to the ramp. Solid letters.
function applyFill(grid, s, cs, fill, withRamp) {
  const { cols, rows, glyph, ink } = grid, cells = cols * rows;
  const next = itemStream(cs, fill, (s.fillSeed | 0) + 211);
  if (!next) return;
  const lvl = withRamp ? s.fillLevel : Math.max(s.threshold, 0.04);
  for (let i = 0; i < cells; i++) {
    if (ink[i] > lvl) { glyph[i] = next(); markFill(grid, i, true); if (grid.shade) grid.shade[i] = 1; }
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
// that follow the edge or with your text, in its own colour. The inside keeps the image, is emptied, or is
// drawn with your text. Your text works as Character set ▸ Custom text: [A|B] / [?A|B] fills and {messages}
// (kept to the stroke or the inside) in both, and for the inside a ramp, words or a phrase (outlineFillMode) on
// the shape's own tones. outlineOpacity and outlineFillOpacity fade the stroke's and the inside's characters
// (through grid.shade).

// The inside's text and mode, or null.
const outlineFillText = (s) => (s.outlineFill === "text" ? { text: s.outlineFillChars, mode: s.outlineFillMode } : null);
// Writes custom `text` (see parseCustom) into the cells `pick` accepts, as the Custom text character set would:
// mode ramp | words | phrase, then [ ] fills and {hidden messages}, kept to these cells. an: the analysis (ink,
// sub, rgb, alpha) of the whole grid; `lvl`: the shape's threshold. Tones are stretched from lvl..1 to 0..1 so
// the shape gets the whole ramp. The ramp and words are picked on the whole grid with their own charset, then
// mapped into cs.
function writeCustom(grid, s, cs, an, text, mode, pick, lvl) {
  const { cols, rows, glyph } = grid, cells = cols * rows, p = parseCustom(text), hasText = p.text.trim() !== "";
  const k = 1 / Math.max(1e-6, 1 - lvl), ink = new Float32Array(cells);
  for (let i = 0; i < cells; i++) ink[i] = clamp01((an.ink[i] - lvl) * k);
  if (grid.filled) for (let i = 0; i < cells; i++) if (pick(i)) grid.filled[i] = 0;
  if (hasText && mode === "phrase") writeSeq(glyph, cols, rows, glyphSeq(cs, p.text), pick, true);
  else if (hasText && cs.atlas) {
    const sub = new Float32Array(an.sub.length);
    for (let i = 0; i < sub.length; i++) sub[i] = clamp01((an.sub[i] - lvl) * k);
    const sIn = Object.assign({}, s, { charset: "custom", customChars: p.text, textMode: mode === "words" ? "words" : "ramp", threshold: 0 });
    const own = buildCharset(cs.atlas, p.text, s.sortByDensity, { spread: s.dither === "none" });
    const g = selectGlyphs(Object.assign({}, an, { ink, sub }), sIn, own);
    const map = Array.from(own.chars, (ch) => charAt(cs, ch));
    for (let i = 0; i < cells; i++) if (pick(i)) glyph[i] = g.glyph[i] >= 0 ? map[g.glyph[i]] : -1;
  }
  if (p.fill) { // with text, only the darker tones (fillLevel); on its own, every cell
    const next = itemStream(cs, p.fill, (s.fillSeed | 0) + 307);
    if (next) for (let i = 0; i < cells; i++) if (pick(i) && (!hasText || ink[i] > s.fillLevel)) { glyph[i] = next(); markFill(grid, i, true); }
  }
  hideMessages(grid, s, cs, p.messages, pick, 37);
}
// Distance in cells (8 neighbours) from each cell to the nearest cell where mask === want.
function maskDistance(mask, want, cols, rows) {
  const cells = cols * rows, D = new Float32Array(cells);
  for (let i = 0; i < cells; i++) D[i] = mask[i] === want ? 0 : 1e9;
  const relax = (r, c, dr, dc) => { const y = r + dr, x = c + dc; if (y >= 0 && y < rows && x >= 0 && x < cols) { const i = r * cols + c, v = D[y * cols + x] + 1; if (v < D[i]) D[i] = v; } };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { relax(r, c, -1, -1); relax(r, c, -1, 0); relax(r, c, -1, 1); relax(r, c, 0, -1); }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) { relax(r, c, 1, 1); relax(r, c, 1, 0); relax(r, c, 1, -1); relax(r, c, 0, 1); }
  return D;
}
// Draws a stroke (the cells of `stroke` along the edge of a shape with distances dIn/dOut) in the outline's style:
// lines that follow the edge, or your text (in reading order, or a [ ] fill, with {messages}). off: keeps the
// outer ring's random picks apart from the outline's.
function drawStroke(grid, s, cs, stroke, dIn, dOut, off) {
  const { cols, rows, glyph } = grid, cells = cols * rows;
  if (grid.filled) for (let i = 0; i < cells; i++) if (stroke[i]) grid.filled[i] = 0;
  if (s.outlineStyle === "chars") {
    const p = parseCustom(s.outlineChars), next = p.fill && itemStream(cs, p.fill, (s.fillSeed | 0) + 401 + off);
    if (next) { for (let i = 0; i < cells; i++) if (stroke[i]) { glyph[i] = next(); markFill(grid, i, true); } }
    else writeSeq(glyph, cols, rows, glyphSeq(cs, p.text), (i) => stroke[i], true);
    hideMessages(grid, s, cs, p.messages, (i) => stroke[i], 53 + off);
  } else {
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
}
function applyOutline(grid, s, cs, an) {
  const { cols, rows, glyph, ink, color } = grid, cells = cols * rows, lvl = s.outlineLevel;
  const inside = new Uint8Array(cells);
  let nIn = 0;
  for (let i = 0; i < cells; i++) if (ink[i] > lvl) { inside[i] = 1; nIn++; }
  if (!nIn || nIn === cells) return;
  const dIn = maskDistance(inside, 1, cols, rows), dOut = maskDistance(inside, 0, cols, rows), w = Math.max(1, Math.round(s.outlineWidth));
  const [wo, wi] = s.outlinePos === "inside" ? [0, w] : s.outlinePos === "center" ? [Math.ceil(w / 2), Math.floor(w / 2)] : [w, 0];
  const stroke = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) stroke[i] = inside[i] ? dOut[i] <= wi : dIn[i] <= wo;
  grid.outlineStroke = stroke; // the depth echo repeats the stroke alone
  drawStroke(grid, s, cs, stroke, dIn, dOut, 0);
  const fill = (i) => inside[i] && !stroke[i], inner = outlineFillText(s);
  if (s.outlineFill === "none") for (let i = 0; i < cells; i++) { if (fill(i)) glyph[i] = -1; }
  else if (inner && an) writeCustom(grid, s, cs, an, inner.text, inner.mode, fill, lvl);
  const strokeColor = outlineColorOf(grid, s);
  const so = s.outlineOpacity === undefined ? 1 : clamp01(s.outlineOpacity), fo = s.outlineFillOpacity === undefined ? 1 : clamp01(s.outlineFillOpacity);
  if (!grid.shade && (so < 1 || fo < 1)) grid.shade = new Float32Array(cells).fill(1);
  for (let i = 0; i < cells; i++) {
    if (stroke[i]) strokeColor(i);
    if (!grid.shade) continue;
    if (stroke[i]) grid.shade[i] = so;
    else if (fill(i)) grid.shade[i] = inner ? fo : grid.shade[i] * fo;
  }
  if (s.outlineRingOn) outlineRing(grid, s, cs, inside, dIn, stroke);
}
// A function colouring cell i from `from`: "under" (the layer below), "image" (the source's colours), else `hex`.
function colorSetter(grid, from, hex) {
  const c = hexToRgb(hex), src = from === "under" ? underOf(grid) : from === "image" ? grid.rgb : null;
  return (i) => grid.color.set(src ? src.subarray(i * 3, i * 3 + 3) : c, i * 3);
}
// The outline's colour (outlineColorFrom), or a ring part's: "stroke" follows the outline, else its own source.
const outlineColorOf = (grid, s) => colorSetter(grid, s.outlineColorFrom, s.outlineColor);
const ringColorOf = (grid, s, from, hex) => (from === "stroke" ? outlineColorOf(grid, s) : colorSetter(grid, from, hex));
// The middle of a mask's bounding box in document units, or null when it is empty.
function maskCentre(mask, cols, geo) {
  let c0 = Infinity, c1 = -1, r0 = Infinity, r1 = -1;
  mask.forEach((m, i) => { if (m) { const c = i % cols, r = (i - c) / cols; c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); } });
  return c1 < 0 ? null : { x: ((c0 + c1 + 1) / 2) * geo.cellW, y: ((r0 + r1 + 1) / 2) * geo.cellH };
}
// The outer ring: the shape scaled by outlineRingScale around its centre. Its edge gets a stroke in the outline's
// style (outlineRingStroke), and the band between the shape and the ring is filled (outlineRingFill): your text
// in every cell (thinned by outlineRingDensity), your text along rays from the centre, or Matrix rain along those
// rays (with its own rain settings, the rr… ones). Rays and rain run outward or inward (outlineRingDir) and curve
// with outlineRingTwist; outlineRingDensity sets how many carry something. The ring and the band have their own
// opacity and colour (outlineRingColorFrom, outlineRingTextColorFrom for text; the rain keeps its colours), and
// the band can fade across its width (outlineRingFade). dIn: each cell's distance to the shape.
function outlineRing(grid, s, cs, inside, dIn, stroke) {
  const { cols, rows, glyph, geo } = grid, cells = cols * rows, F = Math.max(1.05, s.outlineRingScale), ctr = maskCentre(inside, cols, geo);
  if (!ctr) return;
  const outer = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) { // a cell is inside the ring when its centre, scaled back by F, is inside the shape
    const c = i % cols, r = (i - c) / cols, qc = Math.floor((ctr.x + ((c + 0.5) * geo.cellW - ctr.x) / F) / geo.cellW), qr = Math.floor((ctr.y + ((r + 0.5) * geo.cellH - ctr.y) / F) / geo.cellH);
    outer[i] = qc >= 0 && qr >= 0 && qc < cols && qr < rows ? inside[qr * cols + qc] : 0;
  }
  const oIn = maskDistance(outer, 1, cols, rows), oOut = maskDistance(outer, 0, cols, rows), w = Math.max(1, Math.round(s.outlineWidth));
  const ring = new Uint8Array(cells), band = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    if (!outer[i] || inside[i] || stroke[i]) continue;
    if (s.outlineRingStroke && oOut[i] <= w) ring[i] = 1; else band[i] = 1;
  }
  const mode = s.outlineRingFill, density = clamp01(s.outlineRingDensity), seed = (s.fillSeed | 0) + 613;
  const ro = clamp01(s.outlineRingOpacity === undefined ? 1 : s.outlineRingOpacity), bo = clamp01(s.outlineRingFillOpacity === undefined ? 1 : s.outlineRingFillOpacity), fade = Math.max(-1, Math.min(1, s.outlineRingFade || 0));
  if (!grid.shade && (ro < 1 || bo < 1 || fade)) grid.shade = new Float32Array(cells).fill(1);
  if (s.outlineRingStroke) {
    const colorOf = ringColorOf(grid, s, s.outlineRingColorFrom, s.outlineRingColor);
    drawStroke(grid, s, cs, ring, oIn, oOut, 7);
    for (let i = 0; i < cells; i++) if (ring[i]) { colorOf(i); if (grid.shade) grid.shade[i] = ro; }
  }
  if (mode === "none") return;
  for (let i = 0; i < cells; i++) if (band[i]) { glyph[i] = -1; markFill(grid, i, false); if (grid.shade) grid.shade[i] = 1; }
  const colorOf = ringColorOf(grid, s, s.outlineRingTextColorFrom, s.outlineRingTextColor);
  if (mode === "text") {
    const p = parseCustom(s.outlineRingChars), next = p.fill && itemStream(cs, p.fill, seed), seq = glyphSeq(cs, p.text);
    let k = 0;
    for (let i = 0; i < cells; i++) {
      if (!band[i] || hash3(seed, i % cols, Math.floor(i / cols)) >= density) continue;
      glyph[i] = next ? next() : seq.length ? seq[k++ % seq.length] : -1;
      if (next) markFill(grid, i, true);
      colorOf(i);
    }
    hideMessages(grid, s, cs, p.messages, (i) => band[i] === 1, 89);
  } else bandRays(grid, s, cs, band, ctr, mode, density, seed, colorOf);
  if (bo < 1 || fade) for (let i = 0; i < cells; i++) {
    if (!band[i]) continue;
    const t = dIn[i] / (dIn[i] + oOut[i]); // 0 at the shape … 1 at the ring
    grid.shade[i] *= bo * (fade > 0 ? 1 - fade * t : 1 + fade * (1 - t));
  }
}
// Fills the band along rays from the centre: your text (mode "rays") or the ring's rain ("rain").
function bandRays(grid, s, cs, band, ctr, mode, density, seed, colorOf) {
  const { cols, rows, glyph, geo } = grid, cells = cols * rows;
  // rays from the centre through the band: each ray's run of band cells, in the direction of motion
  let R = 0; // the ring's own reach, so rays are counted for its size (about one per two cells out there)
  for (let i = 0; i < cells; i++) if (band[i]) { const c = i % cols, r = (i - c) / cols; R = Math.max(R, Math.hypot((c + 0.5) * geo.cellW - ctr.x, (r + 0.5) * geo.cellH - ctr.y)); }
  R += Math.max(geo.cellW, geo.cellH);
  const runs = [];
  for (const cellsOnRay of raysFrom(geo, cols, rows, ctr, R, s.outlineRingTwist, 0, seed)) {
    let run = [];
    for (const i of cellsOnRay.concat([-1])) {
      if (i >= 0 && band[i]) run.push(i);
      else if (run.length) { runs.push(s.outlineRingDir === "in" ? run.reverse() : run); run = []; }
    }
  }
  if (mode === "rays") {
    const p = parseCustom(s.outlineRingChars), seq = glyphSeq(cs, p.text);
    runs.forEach((run, j) => {
      if (hash3(seed + 1, j, 0) >= density) return;
      const next = p.fill && itemStream(cs, p.fill, seed + 50 + j);
      run.forEach((i, k) => { glyph[i] = next ? next() : seq.length ? seq[k % seq.length] : -1; if (next) markFill(grid, i, true); colorOf(i); });
    });
    hideInRuns(grid, s, cs, runs, p.messages, 97);
  } else if (mode === "rain" && cs.ringRain) {
    const rs = ringRainSettings(s), rseed = (rs.rainSeed | 0) + 911, msgs = rainMessages(rs), drawn = [];
    const write = rainWriter(grid, rs, cs, { seed: rseed, spec: cs.ringRain, runs: msgs.length ? drawn : null });
    runs.forEach((run, j) => slotStreams(write, run, rs, rseed, j, density));
    hideInRuns(grid, rs, cs, drawn, msgs, 101);
  }
}

// ---------- hidden messages ----------
// Each message is written left to right into one row, replacing the characters there, at a spot picked from
// the seed (hideSeed). A spot is taken when all its cells are clearly inked, so the message blends in, and
// keeps a cell clear of other messages. grid.hidden marks the cells (the preview can highlight them).
// allow (optional): only cells it accepts may hold the message (the outline's stroke or inside); seedOff keeps
// those spots apart from the main text's. Messages placed earlier stay (grid.hidden, grid.hiddenPlaced).
function hideMessages(grid, s, cs, messages, allow, seedOff) {
  if (!messages.length) return;
  const { cols, rows, glyph, ink } = grid, hidden = grid.hidden || new Uint8Array(cols * rows), seed = (s.hideSeed | 0) + 101 + (seedOff | 0);
  const minInk = Math.max(0.2, s.threshold + 0.1);
  let placed = grid.hiddenPlaced || 0, n = 0;
  for (const m of messages) {
    const seq = Array.from(m.text, (ch) => (ch === " " ? -1 : charAt(cs, ch))), len = Math.min(seq.length, cols);
    for (let k = 0; k < m.count; k++, n++) {
      let best = null, bestInk = -1;
      for (let t = 0; t < 400; t++) {
        const r = Math.floor(hash3(seed, n, t * 2) * rows), c = Math.floor(hash3(seed, n, t * 2 + 1) * (cols - len + 1));
        let free = true, sum = 0, low = 0;
        for (let j = -1; j <= len && free; j++) { const x = c + j; if (x >= 0 && x < cols && hidden[r * cols + x]) free = false; }
        for (let j = 0; j < len && free && allow; j++) if (!allow(r * cols + c + j)) free = false;
        if (!free) continue;
        for (let j = 0; j < len; j++) { const v = ink[r * cols + c + j]; sum += v; if (v < minInk) low++; }
        if (!low) { best = [r, c]; break; }
        if (sum > bestInk) { bestInk = sum; best = [r, c]; }
      }
      if (!best) continue;
      const [r, c] = best;
      writeHidden(grid, hidden, seq.slice(0, len), (j) => r * cols + c + j);
      placed++;
    }
  }
  grid.hidden = hidden;
  grid.hiddenPlaced = placed;
}

// Writes a message's glyphs `seq` into cells cellAt(0…), marks them hidden and keeps them readable (shade ≥ 0.6).
function writeHidden(grid, hidden, seq, cellAt) {
  for (let j = 0; j < seq.length; j++) {
    const ci = cellAt(j);
    grid.glyph[ci] = seq[j];
    hidden[ci] = 1;
    if (grid.shade) grid.shade[ci] = Math.max(grid.shade[ci], 0.6);
  }
}
// Messages hidden along runs of cells (rain streams, or the cells of an edit in its drawing order) rather than
// along rows: each copy goes into one run at a spot picked from the seed, on cells no other message holds.
function hideInRuns(grid, s, cs, runs, messages, seedOff) {
  if (!messages.length || !runs.length) return;
  const cells = grid.cols * grid.rows, hidden = grid.hidden || new Uint8Array(cells), seed = (s.hideSeed | 0) + 101 + seedOff;
  let placed = grid.hiddenPlaced || 0, n = 0;
  for (const m of messages) {
    const seq = Array.from(m.text, (ch) => (ch === " " ? -1 : charAt(cs, ch)));
    for (let k = 0; k < m.count; k++, n++) {
      for (let t = 0; t < 200; t++) {
        const run = runs[Math.floor(hash3(seed, n, t * 2) * runs.length)];
        if (run.length < seq.length) continue;
        const at = Math.floor(hash3(seed, n, t * 2 + 1) * (run.length - seq.length + 1));
        let free = true;
        for (let j = 0; j < seq.length && free; j++) if (hidden[run[at + j]]) free = false;
        if (!free) continue;
        writeHidden(grid, hidden, seq, (j) => run[at + j]);
        placed++;
        break;
      }
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
// What the rain colours with, and a cell's colour: the head's, a gradient along the stream (t: tail 0 … head 1),
// the shape's colours (art), the layer below, or the rain colour. Shared by the rain and Edit symbols ▸ rain.
function rainPalette(grid, s) {
  return { own: hexToRgb(s.rainColor), head: hexToRgb(s.rainHeadColor), below: underOf(grid), stops: (s.rainGradientMid ? s.rainGradient : [s.rainGradient[0], s.rainGradient[2]]).map(hexToRgb) };
}
function rainColorAt(s, p, t, isHead, art, i) {
  if (isHead) return p.head;
  if (s.rainColorMode === "gradient") return gradientAt(p.stops, t);
  if (s.rainColorMode === "art" && art) return art;
  if (s.rainColorMode === "under") return p.below.subarray(i * 3, i * 3 + 3);
  return p.own;
}
// A stream's length in cells: rainLength, varied by rainLengthVar from a hash of (a, b).
const rainLen = (s, seed, a, b) => Math.max(1, Math.round(Math.max(1, Math.round(s.rainLength)) * (1 + clamp01(s.rainLengthVar) * (hash3(seed + 1, a, b) * 2 - 1))));
function rainStream(grid, s, cs, i, len) {
  const { cols, rows, glyph, color } = grid, c0 = i % cols, r0 = Math.floor(i / cols), seed = (s.rainSeed | 0) + 307;
  const next = cs.rain && itemStream(cs, cs.rain, seed + 5000 + i);
  if (!next) return;
  if (!grid.shade) grid.shade = new Float32Array(cols * rows).fill(1);
  if (len <= 0) len = rainLen(s, seed, c0, r0);
  const slope = Math.tan((Math.max(-60, Math.min(60, s.rainAngle)) * Math.PI) / 180), fade = clamp01(s.rainFade);
  const pal = rainPalette(grid, s), art = rainArtSource(grid, s).slice(i * 3, i * 3 + 3);
  for (let k = 0; k < len; k++) {
    const g = next(), r = r0 + k, c = c0 + Math.round(k * slope);
    if (r >= rows || c < 0 || c >= cols) break;
    if (g < 0) continue;
    const j = r * cols + c, t = (k + 1) / len, isHead = k === len - 1 && s.rainHead;
    const cl = rainColorAt(s, pal, t, isHead, art, j);
    glyph[j] = g;
    color[j * 3] = clamp255(cl[0]); color[j * 3 + 1] = clamp255(cl[1]); color[j * 3 + 2] = clamp255(cl[2]);
    grid.shade[j] = isHead ? 1 : 1 - fade * (1 - t);
    if (grid.hidden) grid.hidden[j] = 0;
    markFill(grid, j, false);
  }
}
function applyEdits(grid, s, cs) {
  const { glyph, color, geo } = grid;
  const orig = { glyph: glyph.slice(), color: color.slice(), shade: grid.shade ? grid.shade.slice() : null, hidden: grid.hidden ? grid.hidden.slice() : null, filled: grid.filled ? grid.filled.slice() : null };
  s.cellEdits.forEach((e, ei) => {
    if (!e) return;
    const cells = editCells(e, geo), below = e.color === "under" ? underOf(grid) : null, col = e.color && !below ? hexToRgb(e.color) : null;
    if (e.op === "rain") { cells.forEach((i) => rainStream(grid, s, cs, i, e.len | 0)); return; }
    // written text is custom text: plain characters in order, a [ ] fill instead when there is one, {messages}
    const p = e.op === "write" ? parseCustom(e.text) : null, fillNext = p && p.fill ? itemStream(cs, p.fill, (s.fillSeed | 0) + 503 + ei) : null;
    const seq = p ? Array.from(p.text, (ch) => (ch === " " ? -1 : charAt(cs, ch))) : [];
    cells.forEach((i, k) => {
      if (e.op === "restore") {
        glyph[i] = orig.glyph[i];
        color[i * 3] = orig.color[i * 3]; color[i * 3 + 1] = orig.color[i * 3 + 1]; color[i * 3 + 2] = orig.color[i * 3 + 2];
        if (grid.shade) grid.shade[i] = orig.shade ? orig.shade[i] : 1;
        if (grid.hidden) grid.hidden[i] = orig.hidden ? orig.hidden[i] : 0;
        markFill(grid, i, !!(orig.filled && orig.filled[i]));
        return;
      }
      if (e.op === "erase") glyph[i] = -1;
      else if (e.op === "write" && fillNext) glyph[i] = fillNext();
      else if (e.op === "write" && seq.length) glyph[i] = seq[k % seq.length];
      else if (e.op !== "write" && e.op !== "color") return;
      const ec = below ? below.subarray(i * 3, i * 3 + 3) : col; // "under": each cell's colour in the layer below
      if (ec && (e.op === "write" || glyph[i] >= 0)) { color[i * 3] = ec[0]; color[i * 3 + 1] = ec[1]; color[i * 3 + 2] = ec[2]; }
      if (e.op !== "color" && grid.shade) grid.shade[i] = 1;
      if (grid.hidden) grid.hidden[i] = 0; // no longer part of a hidden message
      markFill(grid, i, e.op === "write" && !!fillNext && !ec); // an edit's own colour wins over the fills' colour
    });
    if (p) hideInRuns(grid, s, cs, [cells], p.messages, 600 + ei);
  });
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
// Writes rain streams: returns write(cells, art), where cells are a stream's cells in the direction of motion
// (the last is the head; -1 for a step off the grid, which still takes a character so words stay in order) and
// art the colour for "the shape's colours". o.shape: cells that stop a stream, or with o.everywhere recolour it
// (art) and leave it at full strength (rainOutside elsewhere); o.runs collects the cells drawn, for {messages};
// o.spec: the characters (default cs.rain).
function rainWriter(grid, s, cs, o) {
  const { cols, glyph, color } = grid;
  if (!grid.shade) grid.shade = new Float32Array(cols * grid.rows).fill(1);
  const shade = grid.shade, hidden = grid.hidden, pal = rainPalette(grid, s), artSrc = rainArtSource(grid, s), shape = o.shape;
  const fade = clamp01(s.rainFade), outside = clamp01(s.rainOutside), gaps = clamp01(s.rainGaps) * 0.7;
  let id = 0;
  return (cells, artRgb) => {
    const next = itemStream(cs, o.spec || cs.rain, o.seed + 1000 + id++), len = cells.length, run = [];
    if (o.runs) o.runs.push(run);
    let art = artRgb;
    for (let k = 0; k < len; k++) {
      const g = next(), i = cells[k]; // taken even for skipped cells, so words stay in order along the stream
      if (i < 0) continue;
      if (shape && shape[i]) { if (!o.everywhere) break; art = artSrc.slice(i * 3, i * 3 + 3); }
      const c = i % cols, r = (i - c) / cols;
      if (g < 0 || (hidden && hidden[i]) || (gaps && hash3(o.seed + 2, c, r) < gaps)) continue;
      const t = (k + 1) / len, isHead = k === len - 1 && s.rainHead;
      const col = rainColorAt(s, pal, t, isHead, art, i);
      glyph[i] = g;
      color[i * 3] = clamp255(col[0]); color[i * 3 + 1] = clamp255(col[1]); color[i * 3 + 2] = clamp255(col[2]);
      shade[i] = isHead ? 1 : (1 - fade * (1 - t)) * (o.everywhere && !shape[i] ? outside : 1);
      markFill(grid, i, false); // the rain's own [ ] are its characters: it keeps its colours
      run.push(i);
    }
  };
}
// Streams spaced along a line of cells (in the direction of motion; -1 off the grid): one about every slot,
// each kept with probability `amount`. key tells lines apart in the hashes.
function slotStreams(write, cells, s, seed, key, amount) {
  const L = Math.max(1, Math.round(s.rainLength)), slot = L * (1.3 + (1 - amount) * 3), n = cells.length;
  for (let q = 0, y = -L - hash3(seed + 4, key, 0) * slot; y < n; q++, y += slot) {
    if (hash3(seed + 5, key, q) >= amount) continue;
    const len = rainLen(s, seed, key, q + 7919), hy = Math.round(y + hash3(seed + 6, key, q) * slot), part = [];
    for (let k = hy - len + 1; k <= hy; k++) part.push(k >= 0 && k < n ? cells[k] : -1);
    write(part, null);
  }
}
// A stream leaving a shape's edge along the motion (probability `amount`): its head 1…rainDistance cells from the
// edge, rainLength long. at(k): the cell k steps from the edge (or -1). a, b tell edges apart in the hashes.
function edgeStream(write, s, seed, a, b, at, art, amount) {
  if (hash3(seed, a, b) >= amount) return;
  const len = rainLen(s, seed, a, b), far = 1 + Math.floor(hash3(seed + 3, a, b) * Math.max(1, Math.round(s.rainDistance))), cells = [];
  for (let k = Math.max(1, far - len + 1); k <= far; k++) cells.push(at(k));
  write(cells, art);
}
// Rays from ctr (document units) out to R, about one per two cells at the far end, curving by twist (1: a quarter
// turn by R) and starting at hole·R: each ray's cells, outward, without repeats in a row.
function raysFrom(geo, cols, rows, ctr, R, twist, hole, seed) {
  const n = Math.max(16, Math.round((2 * Math.PI * R) / (Math.min(geo.cellW, geo.cellH) * 2))), step = Math.min(geo.cellW, geo.cellH) * 0.5, out = [];
  for (let j = 0; j < n; j++) {
    const a0 = (2 * Math.PI * (j + (hash3(seed + 7, j, 0) - 0.5) * 0.6)) / n, cells = [];
    let last = -1;
    for (let d = hole * R; d <= R; d += step) {
      const a = a0 + twist * (d / R) * (Math.PI / 2), c = Math.floor((ctr.x + d * Math.cos(a)) / geo.cellW), r = Math.floor((ctr.y + d * Math.sin(a)) / geo.cellH);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c;
      if (i !== last) { cells.push(i); last = i; }
    }
    out.push(cells);
  }
  return out;
}
function applyRain(grid, s, cs) {
  const { cols, rows, glyph, geo } = grid, cells = cols * rows, seed = (s.rainSeed | 0) + 307, artSrc = rainArtSource(grid, s);
  if (!cs.rain || !itemStream(cs, cs.rain, seed)) return;
  const shape = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) shape[i] = glyph[i] >= 0 && cs.cov[glyph[i]] > 0 ? 1 : 0;
  const everywhere = s.rainFrom === "everywhere", amount = clamp01(s.rainAmount);
  const runs = [], messages = rainMessages(s); // the cells each stream drew, in order, for {messages}
  const write = rainWriter(grid, s, cs, { shape, everywhere, seed, runs: messages.length ? runs : null });
  if (s.rainDir === "out" || s.rainDir === "in") {
    // along rays from a centre: the middle of the shape or a point; inward streams run towards it
    const ctr = (s.rainCentre !== "point" && maskCentre(shape, cols, geo)) || { x: s.rainCX * geo.docW, y: s.rainCY * geo.docH };
    const R = Math.max(...[[0, 0], [geo.docW, 0], [0, geo.docH], [geo.docW, geo.docH]].map(([x, y]) => Math.hypot(x - ctr.x, y - ctr.y)));
    raysFrom(geo, cols, rows, ctr, R, s.rainTwist, clamp01(s.rainHole), seed).forEach((ray, j) => {
      const line = s.rainDir === "in" ? ray.reverse() : ray;
      if (everywhere) return slotStreams(write, line, s, seed, j, amount);
      for (let k = 0; k < line.length - 1; k++) { // streams leave the shape's edges along the motion
        if (shape[line[k]] && !shape[line[k + 1]]) edgeStream(write, s, seed, 9000 + j, k, (q) => (k + q < line.length ? line[k + q] : -1), artSrc.slice(line[k] * 3, line[k] * 3 + 3), amount);
      }
    });
  } else {
    const slope = Math.tan((Math.max(-60, Math.min(60, s.rainAngle)) * Math.PI) / 180);
    const at = (c0, r0, k) => { const r = r0 + k, c = c0 + Math.round(k * slope); return r < 0 || r >= rows || c < 0 || c >= cols ? -1 : r * cols + c; };
    if (!everywhere) {
      const dc = Math.round(slope);
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, below = c + dc;
        if (!shape[i] || below < 0 || below >= cols || shape[(r + 1) * cols + below]) continue; // not a lower edge
        edgeStream(write, s, seed, c, r, (k) => at(c, r, k), artSrc.slice(i * 3, i * 3 + 3), amount);
      }
    } else {
      // a line of streams per column, starting above the top row (slanted lines also from beyond the sides)
      const span = Math.ceil(rows * Math.abs(slope)) + 1;
      for (let c = -span; c < cols + span; c++) slotStreams(write, Array.from({ length: rows }, (_, k) => at(c, 0, k)), s, seed, c, amount);
    }
  }
  hideInRuns(grid, s, cs, runs, messages, 71);
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
    } else if (s.colorMode === "under") {
      const u = g.under || rgb; cr = u[ci * 3]; cg = u[ci * 3 + 1]; cb = u[ci * 3 + 2];
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
  const G = render(grid, cs, atlas, Object.assign({}, s, off, { bgMode: "transparent", keepAlpha: false, cfOn: false }), { x: view.x - M / sc, y: view.y - M / sc, w: EW, h: EH, scale: sc });
  const out = s._shadowsOnly ? new Uint8ClampedArray(W * H * 4) : new Uint8ClampedArray(render(grid, cs, atlas, Object.assign({}, s, off, { _noGlyphs: true }), view).buffer);
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
      const ga = s._shadowsOnly ? 0 : G[e * 4 + 3];
      if (ga) blendPx(out, o, G[e * 4], G[e * 4 + 1], G[e * 4 + 2], ga / 255);
    }
  }
  if (s.glitchOn) glitchOutput(out, view, grid.geo, s);
  return new Uint8Array(out.buffer);
}

// ---------- depth echo ----------
// Copies of chosen parts (the outline's stroke, the rain, the image's characters), scaled around a vanishing
// point: echoCount copies, each echoStep bigger (echoDir "out": towards the viewer) or smaller ("in": into the
// distance) than the last, so the gaps grow or shrink like perspective. Copy k of n fades by echoFade·k/n (as
// the rain's tail does) and, with echoColorMode "tint", turns towards echoColor. Each copy is a render of those
// cells at its own scale, so characters stay sharp; the copies sit under the characters, over the background.
// The vanishing point: the centre of the parts' cells ("shape") or echoX, echoY of the area ("point").
function echoMask(grid, cs, s) { // the cells to repeat, or null when there are none
  const { glyph, part } = grid, stroke = grid.outlineStroke, m = new Uint8Array(glyph.length);
  let any = false;
  for (let i = 0; i < glyph.length; i++) {
    if (glyph[i] < 0 || cs.cov[glyph[i]] <= 0) continue;
    const p = part ? part[i] : PART.text;
    if ((s.echoOutline && p === PART.outline && (!stroke || stroke[i])) || (s.echoRain && p === PART.rain) || (s.echoText && p === PART.text)) { m[i] = 1; any = true; }
  }
  return any ? m : null;
}
function drawEcho(out, grid, cs, atlas, s, view) {
  const mask = echoMask(grid, cs, s);
  if (!mask) return;
  const { cols, geo } = grid, glyph = grid.glyph.map((g, i) => (mask[i] ? g : -1)), only = Object.assign({}, grid, { glyph });
  let vx = s.echoX * geo.docW, vy = s.echoY * geo.docH;
  if (s.echoCentre !== "point") { // the middle of the repeated cells' bounding box
    let c0 = Infinity, c1 = -1, r0 = Infinity, r1 = -1;
    mask.forEach((m, i) => { if (m) { const c = i % cols, r = (i - c) / cols; c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); } });
    vx = ((c0 + c1 + 1) / 2) * geo.cellW; vy = ((r0 + r1 + 1) / 2) * geo.cellH;
  }
  const n = Math.max(1, Math.round(s.echoCount)), step = Math.max(0.01, s.echoStep), outward = s.echoDir !== "in";
  const fade = clamp01(s.echoFade), tint = s.echoColorMode === "tint" ? hexToRgb(s.echoColor) : null;
  const chars = Object.assign({}, s, NO_FX, { _echoDone: true, bgMode: "transparent", keepAlpha: false });
  for (let j = 0; j < n; j++) { // the farthest copy first: outward that's the smallest, inward the last one
    const k = outward ? j + 1 : n - j, sk = Math.pow(1 + step, outward ? k : -k), t = k / n, a = 1 - fade * t;
    if (a <= 0.002) continue;
    // copy k is these cells scaled by sk around (vx, vy): the same render with the view moved and scaled
    const px = render(only, cs, atlas, chars, { x: vx + (view.x - vx) / sk, y: vy + (view.y - vy) / sk, w: view.w, h: view.h, scale: view.scale * sk });
    for (let o = 0; o < out.length; o += 4) {
      if (!px[o + 3]) continue;
      if (tint) blendPx(out, o, px[o] + (tint[0] - px[o]) * t, px[o + 1] + (tint[1] - px[o + 1]) * t, px[o + 2] + (tint[2] - px[o + 2]) * t, (px[o + 3] / 255) * a);
      else blendPx(out, o, px[o], px[o + 1], px[o + 2], (px[o + 3] / 255) * a);
    }
  }
}

// ---------- cell backgrounds ----------
// An effect behind every cell's character, made from its colour (cfFrom "glyph": the character's own colour,
// after rain and edits; "image": the source's colour under the cell), lightened or darkened by cfShade:
//   solid     a tile; cfGap insets it (a share of the smaller cell side), cfRound rounds its corners
//   gradient  a tile running from that colour (optionally through cfGradMid) to cfTo: cfGradShape linear or
//             reflected at cfAngle (90: top to bottom), radial, diamond or angle (around the centre), across
//             each cell or the whole picture (cfGradSpan), with a midpoint, steps, ping-pong repeats and reverse
//   depth     nested outlines: cfDepthCount rectangles shrinking in perspective towards the cell's centre (and,
//             by cfDepthAim, towards the picture's centre), from that colour towards cfTo, fading by cfDepthFade
//   bleed     no tiles: the colours spread softly over cfSpread cells around their characters
// On top, per cell: cfGlitch (that share of the cells, picked from cfSeed) turns a cell inverted, into RGB bars,
// colour bands, blocks or a neighbour's colour; cfLines darkens cfLineCount scanlines per cell; cfGrain adds
// noise, cfGrainSize of the font size. cfOnlyGlyphs: only cells with a visible character. Everything follows
// from the document position and the cell, so strips of a render match.
// Per cell: the effect's colour A, the gradient's far colour B and its opacity Ba (see cfTarget), and the
// cell's weight w (0 where it gets no effect).
function cellFxBase(grid, cs, s) {
  const { cols, rows, glyph, rgb, alpha, shade } = grid, cells = cols * rows, src = s.cfFrom === "image" ? rgb : s.cfFrom === "under" ? underOf(grid) : grid.color;
  const A = new Float32Array(cells * 3), B = new Float32Array(cells * 3), Ba = new Float32Array(cells), w = new Float32Array(cells), k = clamp01(Math.abs(s.cfShade)), to = s.cfShade < 0 ? 0 : 255;
  let masked = false;
  if (s.keepAlpha && alpha) for (let i = 0; i < cells && !masked; i++) masked = alpha[i] < 255;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < 3; j++) A[i * 3 + j] = src[i * 3 + j] + (to - src[i * 3 + j]) * k;
    Ba[i] = cfTarget(s, A.subarray(i * 3, i * 3 + 3), B.subarray(i * 3, i * 3 + 3));
    const g = glyph[i], vis = g >= 0 && cs.cov[g] > 0;
    w[i] = (vis || !s.cfOnlyGlyphs ? 1 : 0) * (masked ? alpha[i] / 255 : 1) * (shade && vis ? shade[i] : 1);
  }
  return { A, B, Ba, w };
}
function cfTarget(s, a, out) { // the far colour of a gradient or glow, and its opacity
  const t = s.cfTo;
  if (t === "dark") { out[0] = a[0] * 0.25; out[1] = a[1] * 0.25; out[2] = a[2] * 0.25; return 1; }
  if (t === "light") { out[0] = a[0] + (255 - a[0]) * 0.75; out[1] = a[1] + (255 - a[1]) * 0.75; out[2] = a[2] + (255 - a[2]) * 0.75; return 1; }
  if (t === "complement") { out[0] = 255 - a[0]; out[1] = 255 - a[1]; out[2] = 255 - a[2]; return 1; }
  if (t === "bg" || t === "custom") { const c = hexToRgb(t === "bg" ? s.bg : s.cfToColor); out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return 1; }
  out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return 0; // transparent
}
// Position 0..1 along the gradient for a point (px, py) from the centre of an area with half sizes hx, hy.
function cfGradT(shape, px, py, hx, hy, ca, sa, ang) {
  if (shape === "radial") return clamp01(Math.hypot(px / hx, py / hy));
  if (shape === "diamond") return clamp01(Math.abs(px / hx) + Math.abs(py / hy));
  if (shape === "angle") { const t = (Math.atan2(py / hy, px / hx) - ang) / (2 * Math.PI); return t - Math.floor(t); }
  const along = (px * ca + py * sa) / (Math.abs(hx * ca) + Math.abs(hy * sa) || 1);
  return shape === "reflected" ? clamp01(Math.abs(along)) : clamp01(0.5 + along / 2);
}
function drawCellFx(out, grid, cs, s, view) {
  const { cols, rows, geo } = grid, sc = view.scale, W = view.w, H = view.h, cW = geo.cellW, cH = geo.cellH;
  const { A, B, Ba, w } = cellFxBase(grid, cs, s), fill = s.cfFill, op = clamp01(s.cfOpacity), seed = (s.cfSeed | 0) * 7 + 9001;
  // output pixel centres in document units, from whole output pixels so strips agree exactly
  const ox = Math.round(view.x * sc * 1024) / 1024, oy = Math.round(view.y * sc * 1024) / 1024;
  const X = new Float64Array(W), Y = new Float64Array(H);
  for (let x = 0; x < W; x++) X[x] = (ox + x + 0.5) / sc;
  for (let y = 0; y < H; y++) Y[y] = (oy + y + 0.5) / sc;
  // tile shape: a rounded rectangle inset by the gap; with no gap its sides reach past the cell (no seams)
  const inset = clamp01(s.cfGap) * Math.min(cW, cH), hw = cW / 2 - inset + (inset > 0 ? 0 : 1 / sc), hh = cH / 2 - inset + (inset > 0 ? 0 : 1 / sc);
  const rr = Math.max(0, Math.min(0.5, s.cfRound)) * 2 * Math.max(0, Math.min(hw, hh));
  const ang = (s.cfAngle * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  const shape = s.cfGradShape || "linear", whole = s.cfGradSpan === "image";
  const reps = Math.max(1, Math.round(s.cfGradRepeat || 1)), steps = Math.round(s.cfGradSteps || 0), mp = Math.min(0.95, Math.max(0.05, s.cfGradMidpoint || 0.5));
  const bias = Math.abs(mp - 0.5) > 1e-3 ? Math.log(0.5) / Math.log(mp) : 1, mid = s.cfGradMidOn ? hexToRgb(s.cfGradMid) : null;
  const shapeT = (dx, dy, Xd, Yd) => { // the gradient's 0..1 at a pixel, after repeats, midpoint, steps and reverse
    let t = whole ? cfGradT(shape, Xd - geo.docW / 2, Yd - geo.docH / 2, geo.docW / 2, geo.docH / 2, ca, sa, ang) : cfGradT(shape, dx, dy, cW / 2, cH / 2, ca, sa, ang);
    if (reps > 1) { t = (t * reps) % 2; if (t > 1) t = 2 - t; }
    if (bias !== 1) t = Math.pow(t, bias);
    if (steps >= 2) t = Math.min(steps - 1, Math.floor(t * steps)) / (steps - 1);
    return s.cfGradReverse ? 1 - t : t;
  };
  let bl = null;
  if (fill === "bleed") { // colour × weight and weight, blurred over the grid, sampled between cell centres
    const R = new Float32Array(cols * rows), G = new Float32Array(cols * rows), B = new Float32Array(cols * rows), Wt = Float32Array.from(w);
    for (let i = 0; i < w.length; i++) { R[i] = A[i * 3] * w[i]; G[i] = A[i * 3 + 1] * w[i]; B[i] = A[i * 3 + 2] * w[i]; }
    const sig = Math.max(0.4, s.cfSpread);
    blurField(R, cols, rows, sig); blurField(G, cols, rows, sig); blurField(B, cols, rows, sig); blurField(Wt, cols, rows, sig);
    bl = { R, G, B, Wt };
  }
  // depth: dN rectangles, each (1 - cfDepthPull) the size of the one around it, lines cfDepthWidth of the tile's
  // half size (shrinking with them), drifting towards the picture's centre by cfDepthAim, fading by cfDepthFade
  const dN = Math.max(1, Math.round(s.cfDepthCount)), dR = Array.from({ length: dN }, (_, k) => Math.pow(1 - Math.min(0.9, Math.max(0.02, s.cfDepthPull)), k));
  const dW = Math.max(0.005, s.cfDepthWidth), dAim = clamp01(s.cfDepthAim), dFade = clamp01(s.cfDepthFade);
  const glitch = clamp01(s.cfGlitch), lines = clamp01(s.cfLines), nLines = Math.max(1, Math.round(s.cfLineCount));
  const grain = clamp01(s.cfGrain) * 160, gs = Math.max(1 / sc, s.cfGrainSize * geo.size);
  const blend = s.cfBlend, col = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    const Yd = Y[y], r = Math.floor(Yd / cH);
    if (r < 0 || r >= rows) continue;
    const v = Yd / cH - r, dy = (v - 0.5) * cH, stripe = lines > 0 && ((v * nLines) % 1) >= 0.5;
    for (let x = 0, o = y * W * 4; x < W; x++, o += 4) {
      const Xd = X[x], c = Math.floor(Xd / cW);
      if (c < 0 || c >= cols) continue;
      const ci = r * cols + c, u = Xd / cW - c, dx = (u - 0.5) * cW;
      let a, sh; // opacity, and the tile's own coverage (a glitched cell shows solid within it)
      if (bl) {
        const fx = Xd / cW - 0.5, fy = Yd / cH - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const xa = Math.max(0, Math.min(cols - 1, x0)), xb = Math.max(0, Math.min(cols - 1, x0 + 1)), ya = Math.max(0, Math.min(rows - 1, y0)) * cols, yb = Math.max(0, Math.min(rows - 1, y0 + 1)) * cols;
        const lerp = (F) => (F[ya + xa] * (1 - tx) + F[ya + xb] * tx) * (1 - ty) + (F[yb + xa] * (1 - tx) + F[yb + xb] * tx) * ty;
        const wt = lerp(bl.Wt);
        if (wt < 1e-4) continue;
        col[0] = lerp(bl.R) / wt; col[1] = lerp(bl.G) / wt; col[2] = lerp(bl.B) / wt;
        a = sh = Math.min(1, wt * 1.6);
      } else {
        if (w[ci] <= 0) continue;
        // coverage of the rounded tile at this pixel (anti-aliased over one output pixel)
        const qx = Math.abs(dx) - hw + rr, qy = Math.abs(dy) - hh + rr;
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
        const cov = clamp01(0.5 - d * sc);
        if (cov <= 0) continue;
        const a0 = A[ci * 3], a1 = A[ci * 3 + 1], a2 = A[ci * 3 + 2];
        if (fill === "solid") { col[0] = a0; col[1] = a1; col[2] = a2; a = 1; }
        else if (fill === "depth") { // nested outlines; the nearest (outer) one wins where lines meet
          const ax = dAim * Math.max(-1, Math.min(1, (geo.docW / 2 - (c + 0.5) * cW) / (geo.docW / 2))), ay = dAim * Math.max(-1, Math.min(1, (geo.docH / 2 - (r + 0.5) * cH) / (geo.docH / 2)));
          let best = 0, bk = 0;
          for (let k = 0; k < dN; k++) {
            const rk = dR[k], px = dx - ax * (1 - rk) * hw, py = dy - ay * (1 - rk) * hh, qx2 = Math.abs(px) - rk * hw, qy2 = Math.abs(py) - rk * hh;
            const sd = Math.hypot(Math.max(qx2, 0), Math.max(qy2, 0)) + Math.min(Math.max(qx2, qy2), 0), lw = Math.max(1 / sc, dW * rk * Math.min(hw, hh));
            const cv = clamp01(0.5 - (Math.abs(sd + lw / 2) - lw / 2) * sc);
            if (cv > best) { best = cv; bk = k; }
          }
          if (best <= 0) continue;
          const t = dN > 1 ? bk / (dN - 1) : 0;
          col[0] = a0 + (B[ci * 3] - a0) * t; col[1] = a1 + (B[ci * 3 + 1] - a1) * t; col[2] = a2 + (B[ci * 3 + 2] - a2) * t;
          a = best * (1 + (Ba[ci] - 1) * t) * (1 - dFade * t);
        } else {
          const t = shapeT(dx, dy, Xd, Yd), b0 = B[ci * 3], b1 = B[ci * 3 + 1], b2 = B[ci * 3 + 2];
          if (mid && t < 0.5) { const k = t * 2; col[0] = a0 + (mid[0] - a0) * k; col[1] = a1 + (mid[1] - a1) * k; col[2] = a2 + (mid[2] - a2) * k; }
          else if (mid) { const k = t * 2 - 1; col[0] = mid[0] + (b0 - mid[0]) * k; col[1] = mid[1] + (b1 - mid[1]) * k; col[2] = mid[2] + (b2 - mid[2]) * k; }
          else { col[0] = a0 + (b0 - a0) * t; col[1] = a1 + (b1 - a1) * t; col[2] = a2 + (b2 - a2) * t; }
          a = 1 + (Ba[ci] - 1) * t;
        }
        sh = cov * w[ci];
        a *= sh;
      }
      if (glitch > 0 && hash3(seed, c, r) < glitch) { // this cell is glitched, one of five ways
        const kind = Math.floor(hash3(seed + 1, c, r) * 5);
        if (kind === 0) { col[0] = 255 - col[0]; col[1] = 255 - col[1]; col[2] = 255 - col[2]; }
        else if (kind === 1) { const m = Math.max(90, col[0], col[1], col[2]), b = Math.min(2, Math.floor(u * 3)); col[0] = b === 0 ? m : 0; col[1] = b === 1 ? m : 0; col[2] = b === 2 ? m : 0; }
        else if (kind === 2) {
          const nb = 2 + Math.floor(hash3(seed + 2, c, r) * 5), pick = Math.floor(hash3(seed + 3, ci, Math.floor(v * nb)) * 4);
          if (pick === 1) { col[0] = 255 - col[0]; col[1] = 255 - col[1]; col[2] = 255 - col[2]; }
          else if (pick === 2) { col[0] = col[1] = col[2] = 255; }
          else if (pick === 3) { col[0] = col[1] = col[2] = 0; }
        } else if (kind === 3) {
          const f = 0.3 + 1.4 * hash3(seed + 4, ci, Math.floor(u * 3) + 7 * Math.floor(v * 4));
          col[0] = Math.min(255, col[0] * f); col[1] = Math.min(255, col[1] * f); col[2] = Math.min(255, col[2] * f);
        } else if (u > 0.2 + 0.6 * hash3(seed + 5, c, r)) { // the right part shows a neighbour's colour, shifted in
          const n = Math.max(0, Math.min(cols - 1, c + (hash3(seed + 6, c, r) < 0.5 ? -1 : 1) * (1 + Math.floor(hash3(seed + 7, c, r) * 3)))), ni = (r * cols + n) * 3;
          col[0] = A[ni]; col[1] = A[ni + 1]; col[2] = A[ni + 2];
        }
        a = Math.max(a, 0.9 * sh);
      }
      if (stripe) { const k = 1 - lines; col[0] *= k; col[1] *= k; col[2] *= k; }
      if (grain > 0) { const n = (hash3(seed + 8, Math.floor(Xd / gs), Math.floor(Yd / gs)) - 0.5) * grain; col[0] += n; col[1] += n; col[2] += n; }
      a *= op;
      if (a <= 0.002) continue;
      if (blend !== "normal" && out[o + 3]) { // mixed with what's under, as far as that is opaque
        const da = out[o + 3] / 255;
        for (let j = 0; j < 3; j++) {
          const sv = clamp255(col[j]), dv = out[o + j];
          const m = blend === "screen" ? 255 - ((255 - sv) * (255 - dv)) / 255 : blend === "multiply" ? (sv * dv) / 255 : Math.min(255, sv + dv);
          col[j] = sv + (m - sv) * da;
        }
      }
      blendPx(out, o, clamp255(col[0]), clamp255(col[1]), clamp255(col[2]), Math.min(1, a));
    }
  }
}

const MARK_RGB = [0, 230, 255];
// view: {x, y} top-left in document px, {w, h} output px, scale = output px per document px.
// Returns straight-alpha RGBA Uint8Array.
function render(grid, cs, atlas, s, view) {
  if (s.echoOn && !s._echoDone && echoMask(grid, cs, s)) { // background and cell backgrounds, shadows, the echo, characters
    const done = { _echoDone: true, glitchOn: false };
    const out = new Uint8ClampedArray(render(grid, cs, atlas, Object.assign({}, s, done, { _noGlyphs: true, dropOn: false, longOn: false, offOn: false, glowOn: false }), view).buffer);
    const over = (px) => { for (let o = 0; o < out.length; o += 4) if (px[o + 3]) blendPx(out, o, px[o], px[o + 1], px[o + 2], px[o + 3] / 255); };
    if (hasShadow(s)) over(renderPart("shadows", grid, cs, atlas, s, view));
    drawEcho(out, grid, cs, atlas, s, view);
    over(render(grid, cs, atlas, Object.assign({}, s, NO_FX, done, { bgMode: "transparent", keepAlpha: false }), view));
    if (s.glitchOn) glitchOutput(out, view, grid.geo, s);
    return new Uint8Array(out.buffer);
  }
  if (hasShadow(s)) return renderWithShadows(grid, cs, atlas, s, view);
  if (s.cfOn && !s._cfDone) { // background, then the cell backgrounds, then the characters over them
    const under = { _cfDone: true, glitchOn: false };
    const out = new Uint8ClampedArray(render(grid, cs, atlas, Object.assign({}, s, under, { _noGlyphs: true }), view).buffer);
    drawCellFx(out, grid, cs, s, view);
    if (!s._noGlyphs) {
      const G = render(grid, cs, atlas, Object.assign({}, s, under, { bgMode: "transparent", keepAlpha: false }), view);
      for (let o = 0; o < out.length; o += 4) if (G[o + 3]) blendPx(out, o, G[o], G[o + 1], G[o + 2], G[o + 3] / 255);
    }
    if (s.glitchOn) glitchOutput(out, view, grid.geo, s);
    return new Uint8Array(out.buffer);
  }
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

// Flatten RGBA onto a checkerboard for previews -> RGB. backdrop (optional, RGBA of the same size): drawn
// between the two (the live view's layers under the characters).
function flattenForPreview(rgba, W, H, backdrop) {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0, i = 0, o = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i += 4, o += 3) {
      const ck = ((x >> 3) + (y >> 3)) & 1 ? 204 : 255, a = rgba[i + 3] / 255;
      let r = ck, g = ck, b = ck;
      if (backdrop && backdrop[i + 3]) { const ua = backdrop[i + 3] / 255; r = backdrop[i] * ua + ck * (1 - ua); g = backdrop[i + 1] * ua + ck * (1 - ua); b = backdrop[i + 2] * ua + ck * (1 - ua); }
      out[o] = rgba[i] * a + r * (1 - a); out[o + 1] = rgba[i + 1] * a + g * (1 - a); out[o + 2] = rgba[i + 2] * a + b * (1 - a);
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
// mixed into the background where there is one), messages and fills in their own colour and recoloured symbol edits.
const perCellColor = (s) => s.colorMode !== "mono" || s.rainOn || specialColors(s) || (s.cellEdits || []).some((e) => e && e.color);
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

const Engine = { RING_RAIN, migrateSettings, layerParts, renderPart, PART_NAMES, DIFFUSION, ORDERED, resampleGlyph, DEFAULTS, prepareAtlas, buildCharset, parseCustom, customOf, charsetParts, charsetOf, computeGeometry, computeGrid, editCells, render, flattenForPreview, gridLines, toText, toHTML, toSVG, hexToRgb, rgbToHex, luma };
if (typeof module !== "undefined") module.exports = Engine;
