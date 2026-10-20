// Generates the "ASCII by Star" logo (a star drawn in ASCII by the plugin's own engine) and all plugin icons.
// usage: node tools/make_logo.js
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const E = require("../plugin/engine.js"), { CHARSETS } = require("../plugin/charsets.js");
const root = path.join(__dirname, "..");
const atlas = E.prepareAtlas(JSON.parse(fs.readFileSync(root + "/plugin/atlas.json")), fs.readFileSync(root + "/plugin/atlas.bin"));

function png(file, w, h, rgba) {
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc(h * (w * 4 + 1)); for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch("IHDR", ih), ch("IDAT", zlib.deflateSync(raw)), ch("IEND", Buffer.alloc(0))]));
}

// Five-point star mask, point up, brighter towards the centre so the gradient map has something to shade.
function starSource(S, shade) {
  const cx = S / 2, cy = S * 0.535, R = S * 0.47, r = R * 0.42, pts = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r : R; pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
  const inside = (x, y) => { let c = false; for (let i = 0, j = 9; i < 10; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const data = new Uint8Array(S * S * 4), SS = 4;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let cov = 0; for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) if (inside(x + (i + 0.5) / SS, y + (j + 0.5) / SS)) cov++;
    cov /= SS * SS;
    const d = Math.hypot(x - cx, y - cy) / R, v = shade ? 255 * (0.5 + 0.5 * Math.max(0, 1 - d * 1.1)) : 255, o = (y * S + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = cov * 255;
  }
  return { w: S, h: S, data };
}

function drawStar(S, cols, s, shade) {
  s = Object.assign({}, E.DEFAULTS, { sizeMode: "cols", columns: cols, bgMode: "transparent" }, s);
  const chars = s.charset === "custom" ? s.customChars : CHARSETS.find((c) => c.id === s.charset).chars;
  const cs = E.buildCharset(atlas, chars, s.sortByDensity);
  const src = starSource(S, shade);
  const geo = E.computeGeometry(S, S, s, atlas);
  const grid = E.computeGrid(src, geo, s, cs);
  return { rgba: E.render(grid, cs, atlas, s, { x: 0, y: 0, w: S, h: S, scale: 1 }), grid, cs, s };
}

// composite glyph layer over a rounded-square tile
function tile(S, rgba, bg) {
  const out = new Uint8Array(S * S * 4), rad = S * 0.22;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = Math.max(0, Math.abs(x + 0.5 - S / 2) - (S / 2 - rad)), dy = Math.max(0, Math.abs(y + 0.5 - S / 2) - (S / 2 - rad));
    const edge = Math.max(0, Math.min(1, rad - Math.hypot(dx, dy) + 0.5)), o = (y * S + x) * 4, a = rgba[o + 3] / 255;
    for (let k = 0; k < 3; k++) out[o + k] = rgba[o + k] * a + bg[k] * (1 - a);
    out[o + 3] = 255 * edge;
  }
  return out;
}

const GOLD = { colorMode: "gradient", gradient: ["#8a5200", "#ffb300", "#fff6d0"], gradientMid: true, contrast: 1.15 };
const BG = [14, 13, 20];

// big logo + vector + text versions
{
  const S = 1024, r = drawStar(S, 44, Object.assign({ charset: "bourke", detail: 0.35 }, GOLD), true);
  png(root + "/logo/ascii-by-star-logo.png", S, S, tile(S, r.rgba, BG));
  png(root + "/logo/ascii-by-star-star-transparent.png", S, S, r.rgba);
  fs.writeFileSync(root + "/logo/ascii-by-star.svg", E.toSVG(r.grid, r.cs, Object.assign({}, r.s, { bgMode: "solid", bg: "#0e0d14" })));
  fs.writeFileSync(root + "/logo/ascii-by-star.txt", E.toText(r.grid, r.cs));
}
// plugin-list icon (Creative Cloud / plugin manager): gold ASCII star on dark tile
// small sizes: a star built from asterisks, rows overlapped so the shape stays solid
for (const [S, cols] of [[48, 9], [96, 14]]) {
  const r = drawStar(S, cols, Object.assign({ charset: "custom", customChars: " *", lineHeight: 0.55, spacingX: 1, threshold: 0.25 }, GOLD, { gradient: ["#ffb300", "#ffc933", "#fff6d0"] }), true);
  png(root + `/plugin/icons/plugin${S === 96 ? "@2x" : ""}.png`, S, S, tile(S, r.rgba, BG));
}
// panel icons (Photoshop toolbar): single colour, transparent, built from block characters so they stay crisp when tiny
for (const [theme, fg] of [["dark", "#efefef"], ["light", "#2b2b2b"]]) {
  for (const [S, cols] of [[23, 7], [46, 12]]) {
    const r = drawStar(S, cols, { charset: "quadrant", detail: 1, colorMode: "mono", fg, contrast: 1.6, invert: theme === "light" }, false);
    png(root + `/plugin/icons/panel_${theme}${S === 46 ? "@2x" : ""}.png`, S, S, r.rgba);
  }
}
console.log("logo + icons written");
