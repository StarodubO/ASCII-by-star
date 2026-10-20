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
  dither: "none", // none | fs | atkinson | bayer
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
  return selectGlyphs({ cols, rows, ink, sub, rgb, alpha, geo }, s, cs);
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

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
  const { n, level, vec, lut } = cs;
  const step = n > 1 ? 1 / (n - 1) : 1;
  const cache = detail > 0 ? new Map() : null;
  const tw = (1 - detail) * 9, swt = detail;
  const diffuse = (c, r, e, w) => { if (c >= 0 && c < cols && r < rows) work[r * cols + c] += e * w; };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ci = r * cols + c, orig = ink[ci];
      let v = work[ci];
      if (dither === "bayer") v += ((BAYER4[(r & 3) * 4 + (c & 3)] + 0.5) / 16 - 0.5) * step;
      if (thr > 0 && orig <= thr) { glyph[ci] = -1; continue; }
      let gi;
      if (!cache) gi = lut[clamp255(v * 255)];
      else {
        const delta = v - orig, b = ci * 9;
        let key = 0;
        for (let k = 0; k < 9; k++) key = key * 8 + Math.min(7, Math.max(0, Math.round((sub[b + k] + delta) * 7)));
        gi = cache.get(key);
        if (gi === undefined) {
          let bd = Infinity; gi = 0;
          for (let i = 0; i < n; i++) {
            const dt = v - level[i];
            let dist = tw * dt * dt;
            for (let k = 0; k < 9; k++) { const dk = sub[b + k] + delta - vec[i * 9 + k]; dist += swt * dk * dk; }
            if (dist < bd) { bd = dist; gi = i; }
          }
          cache.set(key, gi);
        }
      }
      glyph[ci] = gi;
      if (dither === "fs" || dither === "atkinson") {
        const e = v - level[gi];
        if (dither === "fs") {
          diffuse(c + 1, r, e, 7 / 16); diffuse(c - 1, r + 1, e, 3 / 16); diffuse(c, r + 1, e, 5 / 16); diffuse(c + 1, r + 1, e, 1 / 16);
        } else {
          diffuse(c + 1, r, e, 1 / 8); diffuse(c + 2, r, e, 1 / 8); diffuse(c - 1, r + 1, e, 1 / 8);
          diffuse(c, r + 1, e, 1 / 8); diffuse(c + 1, r + 1, e, 1 / 8); diffuse(c, r + 2, e, 1 / 8);
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

const Engine = { resampleGlyph, DEFAULTS, prepareAtlas, buildCharset, computeGeometry, computeGrid, render, flattenForPreview, gridLines, toText, toHTML, toSVG, hexToRgb, rgbToHex, luma };
if (typeof module !== "undefined") module.exports = Engine;
