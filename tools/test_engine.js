// Node harness: renders a PNG through the engine for several presets.
const fs = require("fs"), zlib = require("zlib"), path = require("path");
const E = require("../plugin/engine.js"), { CHARSETS } = require("../plugin/charsets.js"), { PRESETS } = require("../plugin/presets.js");

function readPNG(file) {
  const b = fs.readFileSync(file); let p = 8, w, h, ct, idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString("ascii", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12]) throw "unsupported png"; }
    if (type === "IDAT") idat.push(d);
    p += 12 + len;
  }
  const bpp = { 2: 3, 6: 4, 0: 1, 4: 2 }[ct], raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const px = Buffer.alloc(h * stride), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, up = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + x] = v & 255;
    }
  }
  for (let i = 0; i < w * h; i++) {
    const s = i * bpp;
    if (bpp >= 3) { out[i * 4] = px[s]; out[i * 4 + 1] = px[s + 1]; out[i * 4 + 2] = px[s + 2]; out[i * 4 + 3] = bpp === 4 ? px[s + 3] : 255; }
    else { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = px[s]; out[i * 4 + 3] = bpp === 2 ? px[s + 1] : 255; }
  }
  return { w, h, data: out };
}
function writePNG(file, w, h, rgba) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

module.exports = { readPNG, writePNG };
if (require.main === module) {
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "../plugin/atlas.json")));
const atlas = E.prepareAtlas(meta, fs.readFileSync(path.join(__dirname, "../plugin/atlas.bin")));
const src = readPNG(process.argv[2]);
const outDir = process.argv[3];
const only = process.argv[4];
for (const p of PRESETS) {
  if (only && p.id !== only) continue;
  const s = Object.assign({}, E.DEFAULTS, p.settings);
  const t0 = Date.now();
  const chars = (id) => (CHARSETS.find((c) => c.id === id) || {}).chars;
  const cs = E.charsetOf(atlas, s, chars(s.charset), chars(s.rainCharset));
  const geo = E.computeGeometry(src.w, src.h, s, atlas);
  const grid = E.computeGrid(src, geo, s, cs);
  const out = E.render(grid, cs, atlas, s, { x: 0, y: 0, w: src.w, h: src.h, scale: 1 });
  const ms = Date.now() - t0;
  writePNG(path.join(outDir, p.id + ".png"), src.w, src.h, out);
  if (p.id === PRESETS[0].id) {
    fs.writeFileSync(path.join(outDir, "out.txt"), E.toText(grid, cs));
    fs.writeFileSync(path.join(outDir, "out.svg"), E.toSVG(grid, cs, s));
    fs.writeFileSync(path.join(outDir, "out.html"), E.toHTML(grid, cs, s));
    const pw = 300, sc = pw / src.w, ph = Math.round(src.h * sc);
    const prev = E.render(grid, cs, atlas, s, { x: 0, y: 0, w: pw, h: ph, scale: sc });
    writePNG(path.join(outDir, "preview_fit.png"), pw, ph, prev);
  }
  console.log(p.id.padEnd(16), `${geo.cols}x${geo.rows}`, ms + "ms");
}
}
