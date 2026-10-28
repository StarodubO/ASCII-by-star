// "Map" tab drawing: streets, railways, rivers, water, buildings and land areas (from map.js loadFeatures) as
// anti-aliased strokes and fills. Pure JS (no Photoshop APIs), shared by the plugin (mapui.js) and Node tools.
// Everything is computed per pixel from document coordinates, so tiles, strips and previews match exactly.
// Map data © OpenStreetMap contributors (OpenMapTiles schema, served by OpenFreeMap).
"use strict";
const Glitch = require("./glitch.js"); // gl… settings (applied in mapui)

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
  // names of places and points of interest (see placeNames)
  namesOn: false,
  namesPlaces: true, // cities, towns, villages, suburbs, neighbourhoods
  namesWater: true, // lakes, bays, seas
  namesPeaks: false, // mountain peaks
  namesPeakText: "both", // what a peak says: both (name and height) | name | height | none (the ▲ alone)
  namesPoi: false, // points of interest: museums, stations, parks, shops…
  namesLang: "local", // local | en (English where the map has it) | latin (Latin letters)
  namesSize: 34, // px: the cell height of a village's name (cities bigger, points of interest smaller)
  namesMax: 80, // at most this many names
  namesGap: 24, // px: the least room around each name
  namesUpper: false, // places in capitals
  namesTracking: 0, // × the character width: extra space between letters
  namesColor: "#2b2b2b", namesWaterColor: "#3f6f96",
  namesHalo: true, namesHaloColor: "#f4f1ea", namesHaloWidth: 0.18, // × size: an outline that keeps names readable
  namesDots: true, // a mark at points of interest (dot) and peaks (▲), the name beside it
  namesFont: "", namesFontName: "", // PostScript name ("" = the built-in Menlo); each letter as wide as it is
};
Object.assign(DEFAULTS, Glitch.DEFAULTS); // gl…: the glitch on the result (mapui)

const STYLES = [
  { id: "classic", name: "Classic", s: {} },
  { id: "blueprint", name: "Blueprint", s: { bgColor: "#123a6b", namesColor: "#dbe9ff", namesWaterColor: "#7fb4ff", namesHaloColor: "#123a6b", builtOn: false, greenOn: false, bareOn: false, waterColor: "#0e2f57", riversColor: "#7fb4ff", buildingsColor: "#2c5a93", roadsColor: "#dbe9ff", roadsCasing: false, roadsMajorOn: false, railColor: "#9cc3ff", creditColor: "#9cc3ff" } },
  { id: "night", name: "Night", s: { bgColor: "#0d0f14", namesColor: "#e6e6e6", namesWaterColor: "#5f93c4", namesHaloColor: "#0d0f14", builtColor: "#161a22", greenColor: "#132018", bareColor: "#1a1c20", waterColor: "#0a1a2b", riversColor: "#1f4f7a", buildingsColor: "#222833", roadsColor: "#3a4250", roadsCasing: false, roadsMajorColor: "#e0a64a", railColor: "#596273", creditColor: "#596273" } },
  { id: "ink", name: "Ink lines", s: { bgColor: "#ffffff", namesColor: "#111111", namesWaterColor: "#111111", namesHaloColor: "#ffffff", builtOn: false, greenOn: false, bareOn: false, waterColor: "#ffffff", waterOn: false, riversColor: "#111111", riversWidth: 2, buildingsOn: false, roadsColor: "#111111", roadsWidth: 2, roadsCasing: false, roadsMajorOn: false, railColor: "#111111", railWidth: 1.5, creditColor: "#888888" } },
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
  if (s.namesOn) out.push({ id: "names", name: "Names" });
  if (s.creditOn) out.push({ id: "credit", name: "Map data credit" });
  return out;
}
// Renders rect (frame document px) at z into RGBA: everything, or one part (a layerParts id). atlas: glyphs
// for the names and the credit line; creditAtlas: the credit's own (the built-in font) when the names have a font.
function render(P, s, rect, z, only, atlas, creditAtlas) {
  const W = Math.max(1, Math.round(rect.w * z)), H = Math.max(1, Math.round(rect.h * z)), out = new Uint8ClampedArray(W * H * 4);
  const want = (id) => (only ? only === id : id === "bg" ? s.bgMode !== "transparent" : id === "credit" ? s.creditOn : id === "names" ? s.namesOn : s[id + "On"]);
  if (want("bg")) { const c = hexToRgb(s.bgColor); for (let i = 0; i < W * H; i++) { out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255; } }
  for (const c of CATS) {
    if (!want(c.id)) continue;
    if (c.id === "roads") {
      if (s.roadsCasing) paint(out, coverageOf(P, s, "roads", rect, z, "casing").cov, s.roadsCasingColor, s.roadsOpacity);
      paint(out, coverageOf(P, s, "roads", rect, z, "fill").cov, s.roadsColor, s.roadsOpacity);
      if (s.roadsMajorOn) paint(out, coverageOf(P, s, "roads", rect, z, "major").cov, s.roadsMajorColor, s.roadsOpacity);
    } else paint(out, coverageOf(P, s, c.id, rect, z).cov, s[c.id + "Color"], s[c.id + "Opacity"]);
  }
  if (want("names") && atlas) drawNames(P, s, rect, z, W, H, out, atlas, creditAtlas || atlas);
  if (want("credit") && (creditAtlas || atlas)) drawCredit(P, s, rect, z, W, H, out, creditAtlas || atlas);
  return out;
}

// ---------- names ----------
// [order, size factor] per place class: the order says which names win the room (smaller first)
const PLACE_CLASS = { continent: [0, 2], country: [1, 1.9], state: [2, 1.7], city: [3, 1.6], town: [4, 1.3], island: [5, 1.05], village: [6, 1.05], suburb: [7, 1], quarter: [8, 0.95], neighbourhood: [9, 0.9], hamlet: [10, 0.85], locality: [11, 0.8], isolated_dwelling: [12, 0.8] };
// (English or Latin letters: a name the map has only in another script is left out, so scripts don't mix)
function nameOf(n, lang) {
  if (lang === "en") return n.en || n.latin;
  if (lang === "latin") return n.latin || n.en;
  return n.local || n.latin || n.en;
}
// The candidates: point features with a name inside the frame, each tile's copy only once, best first.
function nameCandidates(P, s) {
  const out = [];
  for (const it of P.items) {
    const f = it.f, n = f.names;
    if (!n || f.type !== 1 || !it.parts.length || it.parts[0].length < 2) continue;
    const x = it.parts[0][0], y = it.parts[0][1], cl = it.clip;
    if (x < cl[0] || x >= cl[2] || y < cl[1] || y >= cl[3]) continue; // (a tile's buffer repeats its neighbours' points)
    if (x < 0 || y < 0 || x > P.fw || y > P.fh) continue;
    let text = nameOf(n, s.namesLang).trim();
    if (f.layer === "mountain_peak") { // name, height, both or neither (then the ▲ alone)
      const ele = n.ele != null && isFinite(n.ele) ? Math.round(n.ele) + " m" : "", how = s.namesPeakText || "both";
      text = how === "none" ? "" : how === "height" ? ele : how === "name" ? text : [text, ele].filter(Boolean).join(" ");
      if (!text && (how !== "none" || !s.namesDots)) continue;
    } else if (!text) continue;
    let kind, order, k = 1;
    if (f.layer === "place") { const pc = PLACE_CLASS[f.cls]; if (!s.namesPlaces || !pc) continue; kind = "place"; order = pc[0] * 100 + (n.capital ? 0 : 50) + Math.min(49, n.rank); k = pc[1]; if (s.namesUpper) text = text.toUpperCase(); }
    else if (f.layer === "water_name") { if (!s.namesWater) continue; kind = "water"; order = 1500 + Math.min(99, n.rank); k = 0.95; }
    else if (f.layer === "mountain_peak") { if (!s.namesPeaks) continue; kind = "peak"; order = 2000 + Math.min(99, n.rank) * 10000 - (n.ele || 0) / 10000; k = 0.85; }
    else { if (!s.namesPoi) continue; kind = "poi"; order = 3000 + Math.min(999, n.rank || 99) * 10; k = 0.8; }
    out.push({ kind, text, order, k, x, y });
  }
  // the same order however the tiles arrived
  out.sort((a, b) => a.order - b.order || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0) || a.y - b.y || a.x - b.x);
  return out;
}
// The names that get room: [{chars, x0, y0 (top left of the text), sc, adv, w, h, colour, dot: {x, y, r} | null,
// box: [x0, y0, x1, y1]}], document px. Placed once per frame and settings (from document coordinates, so every
// tile draws the same), greedy best first: a name that would touch one already placed (or the credit) is left out.
function placeNames(P, s, atlas, creditAtlas) {
  const ca = creditAtlas || atlas;
  const key = ["namesPlaces", "namesWater", "namesPeaks", "namesPeakText", "namesPoi", "namesLang", "namesSize", "namesMax", "namesGap", "namesUpper", "namesTracking", "namesDots", "creditOn", "creditSize"].map((k) => s[k]).join("|") + "|" + atlas.cellW + "x" + atlas.cellH + "|" + (atlas.id || "") + "|" + ca.cellW + "x" + ca.cellH;
  if (P._names && P._names.key === key && P._names.atlas === atlas && P._names.ca === ca) return P._names.list;
  const px = P.docLong / REF, gap = s.namesGap * px, boxes = [], list = [];
  if (s.creditOn) { const size = s.creditSize * px, margin = size * 0.6; boxes.push([P.fw - margin - CREDIT.length * ca.cellW * (size / ca.cellH) - gap, P.fh - margin - size - gap, P.fw, P.fh]); }
  const hits = (b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  const near = P.docLong * 0.15, twin = (c) => list.some((L) => L.text === c.text && Math.hypot(L.ax - c.x, L.ay - c.y) < near); // the same name again close by (a stop on each side of a street)
  for (const c of nameCandidates(P, s)) {
    if (list.length >= s.namesMax) break;
    const size = s.namesSize * px * c.k, sc = size / atlas.cellH, adv = atlas.cellW * sc * (1 + s.namesTracking), chars = Array.from(c.text);
    const glyphs = chars.map((ch) => atlas.index.get(ch));
    let w = chars.length * adv - atlas.cellW * sc * s.namesTracking, pens = null;
    if (atlas.adv) { // a measured font: each letter as wide as it is; pens = where each letter's advance starts
      const extra = meanAdv(atlas) * sc * s.namesTracking;
      pens = new Float64Array(chars.length + 1);
      for (let i = 0; i < chars.length; i++) pens[i + 1] = pens[i] + (glyphs[i] === undefined ? 0 : atlas.adv[glyphs[i]] * sc) + extra;
      w = Math.max(0, pens[chars.length] - extra);
    }
    const h = size, dotted = s.namesDots && (c.kind === "poi" || c.kind === "peak"), peak = c.kind === "peak";
    const r = dotted ? size * (peak ? 0.3 : 0.16) : 0, x0 = dotted ? c.x + r * (peak ? 2.1 : 2.2) : c.x - w / 2, y0 = c.y - h / 2;
    const box = [Math.min(x0, c.x - r), y0, x0 + w, y0 + h];
    if (box[0] < 0 || box[1] < 0 || box[2] > P.fw || box[3] > P.fh || twin(c)) continue; // whole names only
    const padded = [box[0] - gap / 2, box[1] - gap / 2, box[2] + gap / 2, box[3] + gap / 2];
    if (hits(padded)) continue;
    boxes.push(padded);
    list.push({ text: c.text, ax: c.x, ay: c.y, chars, glyphs, pens, x0, y0, sc, adv, w, h, kind: c.kind, dot: dotted ? { x: c.x, y: c.y, r, peak } : null, box });
  }
  P._names = { key, atlas, ca, list };
  return list;
}
// Every character the names may need (for an atlas that has them all).
function nameChars(P, s) {
  if (!s.namesOn || !P) return "";
  return Array.from(new Set(nameCandidates(P, s).map((c) => c.text).join(""))).join("") + " 0123456789m";
}
function meanAdv(atlas) {
  if (atlas._meanAdv) return atlas._meanAdv;
  let sum = 0, n = 0;
  atlas.chars.forEach((ch, g) => { if (ch.trim()) { sum += atlas.adv[g]; n++; } });
  return (atlas._meanAdv = n ? sum / n : atlas.cellW);
}
// Alpha (0..255) of name label L's text at document point (x, y).
function labelAlpha(L, atlas, x, y) {
  if (L.pens) return labelAlphaProp(L, atlas, x, y);
  const gx = (x - L.x0) / L.sc, gy = (y - L.y0) / L.sc;
  if (gy < 0 || gy >= atlas.cellH || gx < 0) return 0;
  const step = L.adv / L.sc, ci = Math.floor(gx / step);
  if (ci >= L.glyphs.length || L.glyphs[ci] === undefined) return 0;
  const lx = gx - ci * step;
  return lx < atlas.cellW ? sampleGlyph(atlas, L.glyphs[ci], lx, gy) : 0;
}
// The same with letters as wide as they are: the letter whose advance holds x and its neighbours (cells overlap).
function labelAlphaProp(L, atlas, x, y) {
  const gy = (y - L.y0) / L.sc, rel = x - L.x0, P = L.pens, n = L.glyphs.length;
  if (gy < 0 || gy >= atlas.cellH || rel < -atlas.cellW * L.sc || rel > P[n] + atlas.cellW * L.sc) return 0;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (P[m] <= rel) lo = m; else hi = m - 1; }
  let best = 0;
  for (let i = Math.max(0, lo - 1); i <= Math.min(n - 1, lo + 1); i++) {
    const g = L.glyphs[i];
    if (g === undefined) continue;
    const lx = (rel - P[i]) / L.sc + atlas.ox[g]; // cell px: the pen origin sits at ox in the cell
    if (lx < 0 || lx >= atlas.cellW) continue;
    const v = sampleGlyph(atlas, g, lx, gy);
    if (v > best) best = v;
  }
  return best;
}
// Coverage of a name's mark at document point (x, y): a round dot, or for a peak a ▲ standing on the point.
function markAlpha(m, x, y) {
  if (!m.peak) return clamp01(m.r - Math.hypot(x - m.x, y - m.y) + 0.5);
  const r = m.r, top = m.y - r * 1.05, base = m.y + r * 0.75, half = r * 1.05, sl = Math.hypot(half, base - top);
  const dBase = base - y, dL = ((x - (m.x - half)) * (base - top) - (y - base) * -half) / sl, dR = (((m.x + half) - x) * (base - top) - (y - base) * -half) / sl;
  return clamp01(Math.min(dBase, dL, dR) + 0.5); // signed distance inside the three edges, antialiased
}
const HALO_DIRS = Array.from({ length: 16 }, (_, i) => [Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)]);
function drawNames(P, s, rect, z, W, H, out, atlas, creditAtlas) {
  const list = placeNames(P, s, atlas, creditAtlas);
  if (!list.length) return;
  const col = hexToRgb(s.namesColor), water = hexToRgb(s.namesWaterColor), halo = hexToRgb(s.namesHaloColor), sub = Math.min(4, Math.max(1, Math.ceil(1 / z / 1.5)));
  for (const L of list) {
    const hr = s.namesHalo ? s.namesHaloWidth * L.h : 0, pad = hr + 1 / z;
    const bx0 = L.box[0] - pad, by0 = L.box[1] - pad, bx1 = L.box[2] + pad, by1 = L.box[3] + pad;
    if (bx1 < rect.x || by1 < rect.y || bx0 > rect.x + rect.w || by0 > rect.y + rect.h) continue;
    const i0 = Math.max(0, Math.floor((bx0 - rect.x) * z)), i1 = Math.min(W - 1, Math.ceil((bx1 - rect.x) * z));
    const j0 = Math.max(0, Math.floor((by0 - rect.y) * z)), j1 = Math.min(H - 1, Math.ceil((by1 - rect.y) * z));
    const c = L.kind === "water" ? water : col;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      let a = 0, hA = 0;
      for (let sy = 0; sy < sub; sy++) for (let sx = 0; sx < sub; sx++) { // supersampled when the names are small in this view
        const x = rect.x + (i + (sx + 0.5) / sub) / z, y = rect.y + (j + (sy + 0.5) / sub) / z;
        let t = labelAlpha(L, atlas, x, y) / 255;
        if (L.dot) t = Math.max(t, markAlpha(L.dot, x, y));
        a += t;
        if (hr > 0) {
          let m = t;
          for (const [dx, dy] of HALO_DIRS) {
            if (m >= 1) break;
            for (const f of [1, 0.5]) {
              const xx = x + dx * hr * f, yy = y + dy * hr * f;
              let v = labelAlpha(L, atlas, xx, yy) / 255;
              if (L.dot) v = Math.max(v, markAlpha(L.dot, xx, yy));
              if (v > m) m = v;
            }
          }
          hA += m;
        }
      }
      const o = (j * W + i) * 4, n = sub * sub;
      if (hA > 0) over(out, o, halo, Math.min(1, (hA / n) * 1.6));
      if (a > 0) over(out, o, c, Math.min(1, a / n));
    }
  }
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
  out.all = 0;
  for (const it of P.items) {
    if (it.box[2] < 0 || it.box[3] < 0 || it.box[0] > P.fw || it.box[1] > P.fh) continue; // (around the frame: the preview's bleed)
    out.all++;
    for (const c of CATS) if (c.pick(it.f, Object.assign({}, s, { roadsMinor: true, riversStreams: true }))) out[c.id]++;
  }
  return out;
}

function partToPath(p, isFill) {
  if (!p || p.length < 4) return "";
  let d = `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  for (let i = 2; i < p.length; i += 2) d += `L${p[i].toFixed(1)} ${p[i + 1].toFixed(1)}`;
  if (isFill) d += "Z";
  return d;
}

// Exports the map features to an SVG vector string. atlas: places the names as the render does.
function toSVG(P, s, atlas, creditAtlas) {
  const W = P.fw, H = P.fh, px = P.docLong / REF, inFrame = { x: 0, y: 0, w: W, h: H };
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`];
  if (s.bgMode !== "transparent") out.push(`<rect width="100%" height="100%" fill="${s.bgColor}"/>`);

  for (const c of CATS) {
    if (!s[c.id + "On"]) continue;
    if (c.kind === "fill") {
      const paths = [];
      for (const it of P.items) {
        if (!c.pick(it.f, s) || !inRect(it, inFrame, 0)) continue;
        for (const p of it.parts) {
          const d = partToPath(p, true);
          if (d) paths.push(d);
        }
      }
      if (paths.length) {
        const op = s[c.id + "Opacity"] < 1 ? ` fill-opacity="${s[c.id + "Opacity"]}"` : "";
        out.push(`<g id="${c.id}" fill="${s[c.id + "Color"]}"${op} fill-rule="nonzero"><path d="${paths.join(" ")}"/></g>`);
      }
    } else if (c.id === "rivers") {
      const byW = new Map();
      for (const it of P.items) {
        const k = c.pick(it.f, s);
        if (!k || !inRect(it, inFrame, 2)) continue;
        const w = (s.riversWidth * px * k).toFixed(1);
        let list = byW.get(w);
        if (!list) byW.set(w, (list = []));
        for (const p of it.parts) {
          const d = partToPath(p, false);
          if (d) list.push(d);
        }
      }
      if (byW.size) {
        const op = s.riversOpacity < 1 ? ` stroke-opacity="${s.riversOpacity}"` : "";
        out.push(`<g id="rivers" fill="none" stroke="${s.riversColor}" stroke-linecap="round" stroke-linejoin="round"${op}>`);
        for (const [w, list] of byW) out.push(`<path d="${list.join(" ")}" stroke-width="${w}"/>`);
        out.push("</g>");
      }
    } else if (c.id === "roads") {
      if (s.roadsCasing) {
        const byW = new Map();
        for (const it of P.items) {
          const k = c.pick(it.f, s);
          if (!k) continue;
          const isTunnel = it.f.brunnel === "tunnel";
          if (isTunnel && s.roadsTunnels <= 0) continue;
          const w = ((s.roadsWidth * k + s.roadsCasingWidth * 2) * px).toFixed(1);
          if (!inRect(it, inFrame, Number(w) + 2)) continue;
          const key = isTunnel && s.roadsTunnels < 1 ? `${w}|${(s.roadsOpacity * s.roadsTunnels).toFixed(2)}` : w;
          let list = byW.get(key);
          if (!list) byW.set(key, (list = []));
          for (const p of it.parts) {
            const d = partToPath(p, false);
            if (d) list.push(d);
          }
        }
        if (byW.size) {
          const op = s.roadsOpacity < 1 ? ` stroke-opacity="${s.roadsOpacity}"` : "";
          out.push(`<g id="roads-casing" fill="none" stroke="${s.roadsCasingColor}" stroke-linecap="round" stroke-linejoin="round"${op}>`);
          for (const [key, list] of byW) {
            const [w, top] = key.split("|");
            out.push(`<path d="${list.join(" ")}" stroke-width="${w}"${top ? ` stroke-opacity="${top}"` : ""}/>`);
          }
          out.push("</g>");
        }
      }
      const fills = new Map(), majors = new Map();
      for (const it of P.items) {
        const k = c.pick(it.f, s);
        if (!k) continue;
        const isTunnel = it.f.brunnel === "tunnel";
        if (isTunnel && s.roadsTunnels <= 0) continue;
        const isMajor = s.roadsMajorOn && MAJOR_ROADS.has(it.f.cls);
        const map = isMajor ? majors : fills;
        const w = (s.roadsWidth * px * k).toFixed(1);
        if (!inRect(it, inFrame, Number(w) + 2)) continue;
        const key = isTunnel && s.roadsTunnels < 1 ? `${w}|${(s.roadsOpacity * s.roadsTunnels).toFixed(2)}` : w;
        let list = map.get(key);
        if (!list) map.set(key, (list = []));
        for (const p of it.parts) {
          const d = partToPath(p, false);
          if (d) list.push(d);
        }
      }
      if (fills.size) {
        const op = s.roadsOpacity < 1 ? ` stroke-opacity="${s.roadsOpacity}"` : "";
        out.push(`<g id="roads" fill="none" stroke="${s.roadsColor}" stroke-linecap="round" stroke-linejoin="round"${op}>`);
        for (const [key, list] of fills) {
          const [w, top] = key.split("|");
          out.push(`<path d="${list.join(" ")}" stroke-width="${w}"${top ? ` stroke-opacity="${top}"` : ""}/>`);
        }
        out.push("</g>");
      }
      if (majors.size) {
        const op = s.roadsOpacity < 1 ? ` stroke-opacity="${s.roadsOpacity}"` : "";
        out.push(`<g id="roads-major" fill="none" stroke="${s.roadsMajorColor}" stroke-linecap="round" stroke-linejoin="round"${op}>`);
        for (const [key, list] of majors) {
          const [w, top] = key.split("|");
          out.push(`<path d="${list.join(" ")}" stroke-width="${w}"${top ? ` stroke-opacity="${top}"` : ""}/>`);
        }
        out.push("</g>");
      }
    } else if (c.id === "rail") {
      const byW = new Map();
      for (const it of P.items) {
        const k = c.pick(it.f, s);
        if (!k) continue;
        const isTunnel = it.f.brunnel === "tunnel";
        if (isTunnel && s.roadsTunnels <= 0) continue;
        const w = (s.railWidth * px * k).toFixed(1);
        if (!inRect(it, inFrame, Number(w) + 2)) continue;
        const key = isTunnel && s.roadsTunnels < 1 ? `${w}|${(s.railOpacity * s.roadsTunnels).toFixed(2)}` : w;
        let list = byW.get(key);
        if (!list) byW.set(key, (list = []));
        for (const p of it.parts) {
          const d = partToPath(p, false);
          if (d) list.push(d);
        }
      }
      if (byW.size) {
        const op = s.railOpacity < 1 ? ` stroke-opacity="${s.railOpacity}"` : "";
        out.push(`<g id="rail" fill="none" stroke="${s.railColor}" stroke-linecap="round" stroke-linejoin="round"${op}>`);
        for (const [key, list] of byW) {
          const [w, top] = key.split("|");
          out.push(`<path d="${list.join(" ")}" stroke-width="${w}"${top ? ` stroke-opacity="${top}"` : ""}/>`);
        }
        out.push("</g>");
      }
    }
  }

  if (s.namesOn && atlas) {
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const q = (t) => String(t).replace(/['"<>&]/g, ""), family = s.namesFont ? `'${q(s.namesFontName || s.namesFont)}', '${q(s.namesFont)}', ` : "";
    out.push(`<g id="names" font-family="${family}Menlo, Consolas, monospace" dominant-baseline="central">`);
    for (const L of placeNames(P, s, atlas, creditAtlas)) {
      const fill = L.kind === "water" ? s.namesWaterColor : s.namesColor, fs = ((atlas.fontSize || atlas.cellH * 0.85) * L.sc).toFixed(1);
      const halo = s.namesHalo ? ` stroke="${s.namesHaloColor}" stroke-width="${(s.namesHaloWidth * L.h * 2).toFixed(1)}" stroke-linejoin="round" paint-order="stroke fill"` : "";
      const ls = s.namesTracking ? ` letter-spacing="${(s.namesTracking * (atlas.adv ? meanAdv(atlas) : atlas.cellW) * L.sc).toFixed(1)}"` : "";
      if (L.dot) out.push(`<circle cx="${L.dot.x.toFixed(1)}" cy="${L.dot.y.toFixed(1)}" r="${L.dot.r.toFixed(1)}" fill="${fill}"${s.namesHalo ? ` stroke="${s.namesHaloColor}" stroke-width="${(s.namesHaloWidth * L.h).toFixed(1)}" paint-order="stroke fill"` : ""}/>`);
      out.push(`<text x="${L.x0.toFixed(1)}" y="${(L.y0 + L.h / 2).toFixed(1)}" font-size="${fs}" fill="${fill}"${ls}${halo}>${esc(L.chars.join(""))}</text>`);
    }
    out.push("</g>");
  }

  if (s.creditOn) {
    const size = (s.creditSize * px).toFixed(1), margin = (s.creditSize * px * 0.6).toFixed(1);
    out.push(`<text x="${(W - margin)}" y="${(H - margin)}" text-anchor="end" font-family="Menlo, Consolas, sans-serif" font-size="${size}" fill="${s.creditColor}">${CREDIT}</text>`);
  }

  out.push("</svg>");
  return out.join("\n");
}

function migrate(s) { s.version = SETTINGS_VERSION; return s; }

const Features = { REF, SETTINGS_VERSION, DEFAULTS, STYLES, CATS, migrate, prepare, render, layerParts, maskOf, counts, hexToRgb, CREDIT, toSVG, placeNames, nameChars };
if (typeof module !== "undefined") module.exports = Features;
