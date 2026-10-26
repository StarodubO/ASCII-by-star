// "Map" tab drawing: streets, railways, rivers, water, buildings and land areas (from map.js loadFeatures) as
// anti-aliased strokes and fills. Pure JS (no Photoshop APIs), shared by the plugin (mapui.js) and Node tools.
// Everything is computed per pixel from document coordinates, so tiles, strips and previews match exactly.
// Map data © OpenStreetMap contributors (OpenMapTiles schema, served by OpenFreeMap).
"use strict";

const REF = 3000; // sizes are px on a 3000 px long side
const SETTINGS_VERSION = 1;

// The categories, bottom to top. kind: "fill" (areas) or "line"; pick(f) → width factor (lines), true (fills)
// or 0 when the feature isn't part of it.
const ROAD_W = { motorway: 1.7, trunk: 1.5, primary: 1.35, secondary: 1.2, tertiary: 1, minor: 0.75, service: 0.5, raceway: 0.6, busway: 0.6, bus_guideway: 0.5, track: 0.45, path: 0.35 };
const MINOR_ROADS = new Set(["track", "path"]);
const MAJOR_ROADS = new Set(["motorway", "trunk", "primary"]);
const RIVER_W = { river: 1, canal: 0.8, stream: 0.4, drain: 0.3, ditch: 0.25 };
const CATS = [
  { id: "built", name: "Built-up areas", kind: "fill", pick: (f) => f.layer === "landuse" && ["residential", "commercial", "industrial", "retail", "suburb", "neighbourhood", "quarter"].includes(f.cls) && f.type === 3 },
  { id: "green", name: "Parks and woods", kind: "fill", pick: (f) => f.type === 3 && (f.layer === "park" || (f.layer === "landcover" && ["wood", "grass", "wetland"].includes(f.cls)) || (f.layer === "landuse" && ["cemetery", "pitch", "playground"].includes(f.cls))) },
  { id: "bare", name: "Rock, ice and sand", kind: "fill", pick: (f) => f.type === 3 && f.layer === "landcover" && ["rock", "ice", "sand"].includes(f.cls) },
  { id: "rivers", name: "Rivers and streams", kind: "line", pick: (f, s) => (f.layer === "waterway" && f.type === 2 && (s.riversStreams || !(RIVER_W[f.cls] < 0.5)) ? RIVER_W[f.cls] || 0.4 : 0) },
  { id: "water", name: "Lakes and sea", kind: "fill", pick: (f) => f.layer === "water" && f.type === 3 },
  { id: "buildings", name: "Buildings", kind: "fill", pick: (f) => f.layer === "building" && f.type === 3 },
  { id: "roads", name: "Roads", kind: "line", pick: (f, s) => (f.layer === "transportation" && f.type === 2 && ROAD_W[f.cls] && (s.roadsMinor || !MINOR_ROADS.has(f.cls)) ? ROAD_W[f.cls] : 0) },
  { id: "rail", name: "Railways", kind: "line", pick: (f) => (f.layer === "transportation" && f.type === 2 && (f.cls === "rail" || f.cls === "transit") ? (f.sub === "rail" || !f.sub ? 1 : 0.7) : 0) },
];

const DEFAULTS = {
  version: SETTINGS_VERSION,
  bgMode: "color", bgColor: "#f4f1ea",
  builtOn: true, builtColor: "#e6e0d4", builtOpacity: 1,
  greenOn: true, greenColor: "#cfe3c1", greenOpacity: 1,
  bareOn: true, bareColor: "#e9e7e2", bareOpacity: 1,
  waterOn: true, waterColor: "#a9cbe3", waterOpacity: 1,
  riversOn: true, riversColor: "#7fb0d6", riversOpacity: 1, riversWidth: 3, riversStreams: true,
  buildingsOn: true, buildingsColor: "#d6cfc2", buildingsOpacity: 1,
  roadsOn: true, roadsColor: "#ffffff", roadsOpacity: 1, roadsWidth: 5, roadsMinor: true,
  roadsCasing: true, roadsCasingColor: "#b9ae9c", roadsCasingWidth: 1.2,
  roadsMajorOn: true, roadsMajorColor: "#f5cf7a",
  roadsTunnels: 0.35, // opacity of roads and railways in tunnels
  railOn: true, railColor: "#6b6b6b", railOpacity: 1, railWidth: 2,
  creditOn: true, creditColor: "#7a7a7a", creditSize: 22,
};

const STYLES = [
  { id: "classic", name: "Classic", s: {} },
  { id: "blueprint", name: "Blueprint", s: { bgColor: "#123a6b", builtOn: false, greenOn: false, bareOn: false, waterColor: "#0e2f57", riversColor: "#7fb4ff", buildingsColor: "#2c5a93", roadsColor: "#dbe9ff", roadsCasing: false, roadsMajorOn: false, railColor: "#9cc3ff", creditColor: "#9cc3ff" } },
  { id: "night", name: "Night", s: { bgColor: "#0d0f14", builtColor: "#161a22", greenColor: "#132018", bareColor: "#1a1c20", waterColor: "#0a1a2b", riversColor: "#1f4f7a", buildingsColor: "#222833", roadsColor: "#3a4250", roadsCasing: false, roadsMajorColor: "#e0a64a", railColor: "#596273", creditColor: "#596273" } },
  { id: "ink", name: "Ink lines", s: { bgColor: "#ffffff", builtOn: false, greenOn: false, bareOn: false, waterColor: "#ffffff", waterOn: false, riversColor: "#111111", riversWidth: 2, buildingsOn: false, roadsColor: "#111111", roadsWidth: 2, roadsCasing: false, roadsMajorOn: false, railColor: "#111111", railWidth: 1.5, creditColor: "#888888" } },
  { id: "streets", name: "Streets only", s: { bgMode: "transparent", builtOn: false, greenOn: false, bareOn: false, waterOn: false, riversOn: false, buildingsOn: false, roadsColor: "#000000", roadsCasing: false, roadsMajorOn: false, railOn: false } },
  { id: "water", name: "Water only", s: { bgMode: "transparent", builtOn: false, greenOn: false, bareOn: false, buildingsOn: false, roadsOn: false, railOn: false, waterColor: "#2b6cb0", riversColor: "#2b6cb0" } },
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function hexToRgb(hex) {
  let h = String(hex || "#000").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The features of a frame of fw × fh document px, sorted into categories, with bounding boxes. data: the result
// of map.js loadFeatures.
function prepare(data, fw, fh) {
  const items = data.features.map((f) => {
    const parts = f.parts.map((p) => { const a = new Float64Array(p.length); for (let i = 0; i < p.length; i += 2) { a[i] = p[i] * fw; a[i + 1] = p[i + 1] * fh; } return a; });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) for (let i = 0; i < p.length; i += 2) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1]; }
    const clip = [f.clip[0] * fw, f.clip[1] * fh, f.clip[2] * fw, f.clip[3] * fh];
    return { f, parts, box: [Math.max(x0, clip[0]), Math.max(y0, clip[1]), Math.min(x1, clip[2]), Math.min(y1, clip[3])], clip };
  });
  return { fw, fh, docLong: Math.max(fw, fh), items };
}

// ---------- coverage ----------
// Strokes: max of each segment's coverage (round caps and joins), only at pixel centres inside the feature's
// tile square. Distances are in document px (exact in every tile), scaled to output px by z.
function strokeInto(cov, W, H, rect, z, item, half) {
  const reach = half + 1 / z, cl = item.clip;
  for (const p of item.parts) for (let s = 0; s + 3 < p.length; s += 2) {
    const ax = p[s], ay = p[s + 1], bx = p[s + 2], by = p[s + 3];
    const i0 = Math.max(0, Math.floor((Math.max(Math.min(ax, bx) - reach, cl[0]) - rect.x) * z - 0.5)), i1 = Math.min(W - 1, Math.ceil((Math.min(Math.max(ax, bx) + reach, cl[2]) - rect.x) * z - 0.5));
    const j0 = Math.max(0, Math.floor((Math.max(Math.min(ay, by) - reach, cl[1]) - rect.y) * z - 0.5)), j1 = Math.min(H - 1, Math.ceil((Math.min(Math.max(ay, by) + reach, cl[3]) - rect.y) * z - 0.5));
    if (i0 > i1 || j0 > j1) continue;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, wOut = half * 2 * z;
    for (let j = j0; j <= j1; j++) {
      const y = rect.y + (j + 0.5) / z;
      if (y < cl[1] || y >= cl[3]) continue;
      for (let i = i0; i <= i1; i++) {
        const x = rect.x + (i + 0.5) / z;
        if (x < cl[0] || x >= cl[2]) continue;
        let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - ax - t * dx, ey = y - ay - t * dy, d = Math.sqrt(ex * ex + ey * ey) * z;
        const c = Math.min(Math.min(1, wOut), wOut / 2 + 0.5 - d);
        if (c > cov[j * W + i]) cov[j * W + i] = c;
      }
    }
  }
}
// Fills (non-zero winding, all rings of a feature together): 4 sub-rows per pixel row, exact horizontal coverage.
function fillInto(cov, W, H, rect, z, item) {
  const cl = item.clip, b = item.box;
  const j0 = Math.max(0, Math.floor((b[1] - rect.y) * z)), j1 = Math.min(H - 1, Math.ceil((b[3] - rect.y) * z));
  const i0 = Math.max(0, Math.floor((b[0] - rect.x) * z)), i1 = Math.min(W - 1, Math.ceil((b[2] - rect.x) * z));
  if (i0 > i1 || j0 > j1) return;
  const edges = [];
  for (const p of item.parts) for (let s = 0; s + 3 < p.length; s += 2) {
    const ax = p[s], ay = p[s + 1], bx = p[s + 2], by = p[s + 3];
    if (ay === by) continue;
    edges.push(ay < by ? [ay, by, ax, (bx - ax) / (by - ay), 1] : [by, ay, bx, (ax - bx) / (ay - by), -1]);
  }
  edges.sort((a, b) => a[0] - b[0]);
  const acc = new Float32Array(i1 - i0 + 1), xs = [];
  let next = 0, active = [];
  for (let j = j0; j <= j1; j++) {
    acc.fill(0);
    for (let k = 0; k < 4; k++) {
      const y = rect.y + (j + (k + 0.5) / 4) / z;
      while (next < edges.length && edges[next][0] <= y) active.push(edges[next++]);
      active = active.filter((e) => e[1] > y);
      xs.length = 0;
      for (const e of active) if (e[0] <= y) xs.push([e[2] + (y - e[0]) * e[3], e[4]]);
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let q = 0; q + 1 < xs.length; q++) {
        wind += xs[q][1];
        if (!wind) continue;
        // span xs[q] .. xs[q+1] in output px, within the bounding columns
        const xa = Math.max((xs[q][0] - rect.x) * z, i0), xb = Math.min((xs[q + 1][0] - rect.x) * z, i1 + 1);
        if (xb <= xa) continue;
        const ia = Math.floor(xa), ib = Math.min(i1, Math.floor(xb - 1e-9));
        if (ia === ib) { acc[ia - i0] += (xb - xa) / 4; continue; }
        acc[ia - i0] += (ia + 1 - xa) / 4;
        for (let i = ia + 1; i < ib; i++) acc[i - i0] += 0.25;
        acc[ib - i0] += (xb - ib) / 4;
      }
    }
    const y = rect.y + (j + 0.5) / z;
    if (y < cl[1] || y >= cl[3]) continue;
    for (let i = i0; i <= i1; i++) {
      const x = rect.x + (i + 0.5) / z, c = acc[i - i0];
      if (c > 0 && x >= cl[0] && x < cl[2] && c > cov[j * W + i]) cov[j * W + i] = Math.min(1, c);
    }
  }
}
const inRect = (item, rect, pad) => item.box[2] + pad > rect.x && item.box[0] - pad < rect.x + rect.w && item.box[3] + pad > rect.y && item.box[1] - pad < rect.y + rect.h;

// Coverage of one category over rect at z (0..1 per output pixel). For roads, opts.part: "casing" | "major" |
// "fill" (the casing under every road; major roads; the rest). Tunnels count at s.roadsTunnels.
function coverageOf(P, s, cat, rect, z, part) {
  const W = Math.max(1, Math.round(rect.w * z)), H = Math.max(1, Math.round(rect.h * z)), cov = new Float32Array(W * H);
  const C = CATS.find((c) => c.id === cat), px = P.docLong / REF;
  const tunnel = new Float32Array(cat === "roads" || cat === "rail" ? W * H : 0);
  for (const it of P.items) {
    const k = C.pick(it.f, s);
    if (!k) continue;
    if (C.kind === "fill") { if (inRect(it, rect, 0)) fillInto(cov, W, H, rect, z, it); continue; }
    if (cat === "roads" && part === "major" && !(s.roadsMajorOn && MAJOR_ROADS.has(it.f.cls))) continue;
    if (cat === "roads" && part === "fill" && s.roadsMajorOn && MAJOR_ROADS.has(it.f.cls)) continue;
    let half = (s[cat + "Width"] * px * k) / 2;
    if (part === "casing") half += s.roadsCasingWidth * px;
    if (!inRect(it, rect, half + 2)) continue;
    strokeInto(it.f.brunnel === "tunnel" ? tunnel : cov, W, H, rect, z, it, half);
  }
  if (tunnel.length) for (let i = 0; i < cov.length; i++) if (tunnel[i] * s.roadsTunnels > cov[i]) cov[i] = tunnel[i] * s.roadsTunnels;
  return { cov, W, H };
}

// Mixes colour c (rgb) with coverage a over the pixel at o.
function over(out, o, c, a) {
  if (a <= 0) return;
  const a0 = out[o + 3] / 255, A = a + a0 * (1 - a);
  for (let ch = 0; ch < 3; ch++) out[o + ch] = (c[ch] * a + out[o + ch] * a0 * (1 - a)) / A;
  out[o + 3] = A * 255;
}
function paint(out, cov, colour, opacity) {
  const c = hexToRgb(colour);
  for (let i = 0; i < cov.length; i++) if (cov[i] > 0) over(out, i * 4, c, cov[i] * opacity);
}

// The layers Apply makes, bottom to top: [{id, name}] (only those switched on; the credit last).
function layerParts(s) {
  const out = [];
  if (s.bgMode !== "transparent") out.push({ id: "bg", name: "Background" });
  for (const c of CATS) if (s[c.id + "On"]) out.push({ id: c.id, name: c.name });
  if (s.creditOn) out.push({ id: "credit", name: "Map data credit" });
  return out;
}
// Renders rect (frame document px) at z into RGBA: everything, or one part (a layerParts id). atlas: glyphs
// for the credit line.
function render(P, s, rect, z, only, atlas) {
  const W = Math.max(1, Math.round(rect.w * z)), H = Math.max(1, Math.round(rect.h * z)), out = new Uint8ClampedArray(W * H * 4);
  const want = (id) => (only ? only === id : id === "bg" ? s.bgMode !== "transparent" : id === "credit" ? s.creditOn : s[id + "On"]);
  if (want("bg")) { const c = hexToRgb(s.bgColor); for (let i = 0; i < W * H; i++) { out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255; } }
  for (const c of CATS) {
    if (!want(c.id)) continue;
    if (c.id === "roads") {
      if (s.roadsCasing) paint(out, coverageOf(P, s, "roads", rect, z, "casing").cov, s.roadsCasingColor, s.roadsOpacity);
      paint(out, coverageOf(P, s, "roads", rect, z, "fill").cov, s.roadsColor, s.roadsOpacity);
      if (s.roadsMajorOn) paint(out, coverageOf(P, s, "roads", rect, z, "major").cov, s.roadsMajorColor, s.roadsOpacity);
    } else paint(out, coverageOf(P, s, c.id, rect, z).cov, s[c.id + "Color"], s[c.id + "Opacity"]);
  }
  if (want("credit") && atlas) drawCredit(P, s, rect, z, W, H, out, atlas);
  return out;
}

// "© OpenStreetMap contributors" in the bottom-right corner (the licence asks for it on anything published).
const CREDIT = "(c) OpenStreetMap contributors";
function drawCredit(P, s, rect, z, W, H, out, atlas) {
  const px = P.docLong / REF, size = s.creditSize * px, sc = size / atlas.cellH, cw = atlas.cellW * sc, margin = size * 0.6;
  const x0 = P.fw - margin - CREDIT.length * cw, y0 = P.fh - margin - size, col = hexToRgb(s.creditColor);
  const i0 = Math.max(0, Math.floor((x0 - rect.x) * z)), i1 = Math.min(W - 1, Math.ceil((P.fw - margin - rect.x) * z));
  const j0 = Math.max(0, Math.floor((y0 - rect.y) * z)), j1 = Math.min(H - 1, Math.ceil((y0 + size - rect.y) * z));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const gx = (rect.x + (i + 0.5) / z - x0) / sc, gy = (rect.y + (j + 0.5) / z - y0) / sc;
    if (gx < 0 || gy < 0 || gy >= atlas.cellH) continue;
    const ci = Math.floor(gx / atlas.cellW);
    if (ci >= CREDIT.length) continue;
    const g = atlas.index.get(CREDIT[ci]);
    if (g === undefined) continue;
    const a = sampleGlyph(atlas, g, gx - ci * atlas.cellW, gy) / 255;
    if (a > 0) over(out, (j * W + i) * 4, col, a);
  }
}
function sampleGlyph(atlas, g, x, y) {
  const cw = atlas.cellW, ch = atlas.cellH, d = atlas.data, o = g * cw * ch;
  x -= 0.5; y -= 0.5;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= cw || yy >= ch ? 0 : d[o + yy * cw + xx]);
  return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
}

// A selection mask for a category (8-bit, 255 = selected) over rect at z = 1; roads include their casing.
function maskOf(P, s, cat, rect) {
  const { cov } = coverageOf(P, s, cat, rect, 1, cat === "roads" && s.roadsCasing ? "casing" : undefined);
  const out = new Uint8Array(cov.length);
  for (let i = 0; i < cov.length; i++) out[i] = Math.round(clamp01(cov[i]) * 255);
  return out;
}
// What a region holds: {category id: number of features}, for the panel.
function counts(P, s) {
  const out = {};
  for (const c of CATS) out[c.id] = 0;
  for (const it of P.items) for (const c of CATS) if (c.pick(it.f, Object.assign({}, s, { roadsMinor: true, riversStreams: true }))) out[c.id]++;
  return out;
}

function migrate(s) { s.version = SETTINGS_VERSION; return s; }

const Features = { REF, SETTINGS_VERSION, DEFAULTS, STYLES, CATS, migrate, prepare, render, layerParts, maskOf, counts, hexToRgb, CREDIT };
if (typeof module !== "undefined") module.exports = Features;
