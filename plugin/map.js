// Height from a map region, for the Lines tab. Pure JS: the caller passes fetch (the plugin's, or Node's).
// Elevation comes from the free AWS Terrain Tiles ("terrarium" PNGs, Mapzen/Tilezen, about 30 m and better):
// height in metres = R·256 + G + B/256 − 32768, in Web Mercator tiles of 256 px. A place is a Google Maps link
// (its @lat,lon,zoom), "lat, lon", or a name looked up in OpenStreetMap (Photon by Komoot).
"use strict";

const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const GEOCODE_URL = (q) => `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(q)}`; // OpenStreetMap search, no key
const MAX_Z = 15, MAX_TILES = 100;
const EARTH = 40075016.686; // equator length in metres

// ---------- places ----------
// {lat, lon, widthKm?} from a Google Maps link or "lat, lon"; {query} for anything else; null when empty.
function parseLocation(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const num = "(-?\\d+(?:\\.\\d+)?)";
  let m = t.match(new RegExp("!3d" + num + "!4d" + num)); // a place's own pin
  const at = t.match(new RegExp("@" + num + "," + num + "(?:,(\\d+(?:\\.\\d+)?)([zm]))?"));
  let lat, lon, widthKm = null;
  if (m) { lat = +m[1]; lon = +m[2]; }
  else if (at) { lat = +at[1]; lon = +at[2]; }
  else if ((m = t.match(new RegExp("[?&](?:q|ll|query|center)=" + num + "(?:,|%2C)\\s*" + num)))) { lat = +m[1]; lon = +m[2]; }
  else if ((m = t.match(new RegExp("^" + num + "\\s*[,; ]\\s*" + num + "$")))) { lat = +m[1]; lon = +m[2]; }
  else return { query: t };
  if (at && at[3]) { // the view's zoom (z) or camera height in metres (m): the width Google Maps showed, about 1200 px
    const v = +at[3];
    widthKm = at[4] === "z" ? (1200 * metresPerPx(lat, v)) / 1000 : v / 1000;
  }
  if (!(Math.abs(lat) <= 85 && Math.abs(lon) <= 180)) throw new Error("Those coordinates are off the map.");
  return { lat, lon, widthKm };
}
async function geocode(query, fetchFn) {
  const r = await fetchFn(GEOCODE_URL(query), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Couldn't look up “${query}” (${r.status}).`);
  const j = await r.json(), f = j && j.features && j.features[0];
  if (!f) throw new Error(`No place called “${query}” found. Paste a Google Maps link or coordinates instead.`);
  const p = f.properties || {}, [lon, lat] = f.geometry.coordinates, e = p.extent; // extent: [west, north, east, south]
  const widthKm = e ? Math.min(200, Math.max(2, ((e[2] - e[0]) * EARTH * Math.cos((lat * Math.PI) / 180)) / 360 / 1000 * 1.2)) : null;
  return { lat, lon, widthKm, name: [p.name, p.state, p.country].filter(Boolean).join(", ") };
}

// ---------- Web Mercator ----------
const metresPerPx = (lat, z) => (EARTH * Math.cos((lat * Math.PI) / 180)) / (256 * Math.pow(2, z));
const worldX = (lon, z) => ((lon + 180) / 360) * 256 * Math.pow(2, z);
const worldY = (lat, z) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); };

// The tiles for a region: centre, width in km, aspect (height / width), and the grid it'll be sampled to.
// Picks the most detailed zoom that still has about one tile pixel per output pixel, within MAX_TILES.
function planRegion(lat, lon, widthKm, aspect, outW) {
  let z = MAX_Z;
  for (; z > 0; z--) {
    const wpx = (widthKm * 1000) / metresPerPx(lat, z), hpx = wpx * aspect;
    const nx = Math.ceil(wpx / 256) + 1, ny = Math.ceil(hpx / 256) + 1;
    if (wpx <= outW * 1.5 && nx * ny <= MAX_TILES) break;
  }
  const wpx = (widthKm * 1000) / metresPerPx(lat, z), hpx = wpx * aspect;
  const cx = worldX(lon, z), cy = worldY(lat, z), x0 = cx - wpx / 2, y0 = cy - hpx / 2;
  const n = Math.pow(2, z), tiles = [];
  for (let ty = Math.max(0, Math.floor(y0 / 256)); ty <= Math.min(n - 1, Math.floor((y0 + hpx) / 256)); ty++)
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + wpx) / 256); tx++) tiles.push({ x: tx, y: ty });
  return { z, x0, y0, wpx, hpx, tiles, metresPerPx: metresPerPx(lat, z) };
}

// ---------- PNG ----------
// Inflate (RFC 1951) of a zlib stream (RFC 1950): enough for PNG.
function inflate(src) {
  let pos = 2, bit = 0, out = new Uint8Array(Math.max(1024, src.length * 4)), n = 0; // skip the 2-byte zlib header
  const need = (k) => { if (n + k > out.length) { let L = out.length * 2; while (L < n + k) L *= 2; const o = new Uint8Array(L); o.set(out.subarray(0, n)); out = o; } };
  const bits = (k) => { let v = 0; for (let i = 0; i < k; i++) { if (pos >= src.length) throw new Error("PNG data ends early"); v |= ((src[pos] >> bit) & 1) << i; if (++bit === 8) { bit = 0; pos++; } } return v; };
  // Huffman table: counts per length, symbols sorted by code
  const build = (lengths) => {
    const counts = new Uint16Array(16), offs = new Uint16Array(16), syms = new Uint16Array(lengths.length);
    for (const l of lengths) counts[l]++;
    counts[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) syms[offs[lengths[s]]++] = s;
    return { counts, syms };
  };
  const decode = (t) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = t.counts[len];
      if (code - first < c) return t.syms[index + code - first];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error("Bad PNG data");
  };
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  let fixedL = null, fixedD = null;
  for (let last = 0; !last;) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) { // stored
      if (bit) { bit = 0; pos++; }
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      need(len); out.set(src.subarray(pos, pos + len), n); n += len; pos += len;
      continue;
    }
    let lt, dt;
    if (type === 1) {
      if (!fixedL) {
        const l = new Uint8Array(288);
        l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
        fixedL = build(l); fixedD = build(new Uint8Array(30).fill(5));
      }
      lt = fixedL; dt = fixedD;
    } else if (type === 2) {
      const hl = bits(5) + 257, hd = bits(5) + 1, hc = bits(4) + 4, ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const cl = new Uint8Array(19);
      for (let i = 0; i < hc; i++) cl[ORDER[i]] = bits(3);
      const ct = build(cl), lens = new Uint8Array(hl + hd);
      for (let i = 0; i < hl + hd;) {
        const sym = decode(ct);
        if (sym < 16) lens[i++] = sym;
        else if (sym === 16) { const p = lens[i - 1], r = 3 + bits(2); for (let k = 0; k < r; k++) lens[i++] = p; }
        else if (sym === 17) i += 3 + bits(3);
        else i += 11 + bits(7);
      }
      lt = build(lens.subarray(0, hl)); dt = build(lens.subarray(hl));
    } else throw new Error("Bad PNG data");
    for (;;) {
      const sym = decode(lt);
      if (sym < 256) { need(1); out[n++] = sym; continue; }
      if (sym === 256) break;
      const li = sym - 257, len = LBASE[li] + bits(LEXT[li]), di = decode(dt), dist = DBASE[di] + bits(DEXT[di]);
      need(len);
      for (let k = 0; k < len; k++, n++) out[n] = out[n - dist];
    }
  }
  return out.subarray(0, n);
}
// 8-bit grey, RGB or RGBA PNG → {w, h, data RGBA}.
function decodePNG(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const u32 = (p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  if (b[0] !== 137 || b[1] !== 80) throw new Error("Not a PNG (the map server sent something else).");
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, idat = [], total = 0;
  while (p < b.length) {
    const len = u32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (type === "IHDR") { w = u32(p + 8); h = u32(p + 12); depth = b[p + 16]; ctype = b[p + 17]; if (b[p + 20]) throw new Error("Interlaced PNGs aren't supported."); }
    else if (type === "IDAT") { idat.push(b.subarray(p + 8, p + 8 + len)); total += len; }
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (depth !== 8 || !ch) throw new Error("Unsupported PNG format.");
  const z = new Uint8Array(total);
  for (let i = 0, o = 0; i < idat.length; o += idat[i].length, i++) z.set(idat[i], o);
  const raw = inflate(z), stride = w * ch, cur = new Uint8Array(stride), prev = new Uint8Array(stride), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, up = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[i] = v;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      if (ch < 3) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = ch === 2 ? cur[s + 1] : 255; }
      else { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = ch === 4 ? cur[s + 3] : 255; }
    }
    prev.set(cur);
  }
  return { w, h, data: out };
}

// ---------- elevation ----------
const tileCache = new Map(); // "z/x/y" → Float32Array(256·256) metres
async function tileHeights(z, x, y, fetchFn) {
  const n = Math.pow(2, z), wx = ((x % n) + n) % n, key = `${z}/${wx}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const r = await fetchFn(TILE_URL(z, wx, y));
  if (!r.ok) throw new Error(`The map server answered ${r.status} for tile ${key}.`);
  const png = decodePNG(new Uint8Array(await r.arrayBuffer())), d = png.data, out = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  if (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value);
  tileCache.set(key, out);
  return out;
}
// Elevation over a region sampled to w × h: {w, h, elev Float32Array (metres), min, max, metresPerPx (of the
// output grid), z}. onProgress(done, total) while tiles load.
async function loadRegion({ lat, lon, widthKm, w, h, fetchFn, onProgress }) {
  const plan = planRegion(lat, lon, widthKm, h / w, w), tiles = new Map();
  let done = 0;
  // a few at a time: quick, and polite to the server
  const queue = plan.tiles.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const t = queue.shift();
      tiles.set(`${t.x}/${t.y}`, await tileHeights(plan.z, t.x, t.y, fetchFn));
      if (onProgress) onProgress(++done, plan.tiles.length);
    }
  }));
  const at = (px, py) => { // world px at zoom plan.z
    const tx = Math.floor(px / 256), ty = Math.min(Math.pow(2, plan.z) - 1, Math.max(0, Math.floor(py / 256)));
    const t = tiles.get(`${tx}/${ty}`);
    if (!t) return 0;
    const ix = Math.min(255, Math.max(0, Math.floor(px - tx * 256))), iy = Math.min(255, Math.max(0, Math.floor(py - ty * 256)));
    return t[iy * 256 + ix];
  };
  const elev = new Float32Array(w * h);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = plan.x0 + ((x + 0.5) / w) * plan.wpx - 0.5, py = plan.y0 + ((y + 0.5) / h) * plan.hpx - 0.5;
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    const v = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
    elev[y * w + x] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { w, h, elev, min, max, metresPerPx: (widthKm * 1000) / w, z: plan.z, tiles: plan.tiles.length };
}

// ---------- map features (vector tiles) ----------
// Streets, railways, rivers, water, buildings and green areas from OpenFreeMap (free, no key): Mapbox Vector
// Tiles in the OpenMapTiles schema, data © OpenStreetMap contributors. Tiles go up to zoom 14.
const FEATURE_INFO = "https://tiles.openfreemap.org/planet"; // TileJSON: names the current tile set
const FEATURE_LAYERS = ["transportation", "waterway", "water", "building", "park", "landcover", "landuse"];
const MAX_FEATURE_Z = 14, MAX_FEATURE_TILES = 90;
let tileTemplate = null; // a promise of the tile URL template (asked once, even by parallel loads)

// A protobuf reader, enough for vector tiles.
function pbf(buf, start, end) {
  let p = start;
  const varint = () => { let v = 0, m = 1, b; do { b = buf[p++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };
  return {
    more: () => p < end,
    tag: () => { const t = varint(); return [Math.floor(t / 8), t & 7]; },
    varint,
    bytes() { const len = varint(), s = p; p += len; return [s, p]; },
    skip(wire) { if (wire === 0) varint(); else if (wire === 1) p += 8; else if (wire === 2) { const len = varint(); p += len; } else if (wire === 5) p += 4; else throw new Error("Bad vector tile"); },
    f32() { const v = new DataView(buf.buffer, buf.byteOffset + p, 4).getFloat32(0, true); p += 4; return v; },
    f64() { const v = new DataView(buf.buffer, buf.byteOffset + p, 8).getFloat64(0, true); p += 8; return v; },
  };
}
const utf8 = (buf, s, e) => { let out = ""; for (let i = s; i < e;) { let c = buf[i++]; if (c >= 0xf0) { c = ((c & 7) << 18) | ((buf[i++] & 63) << 12) | ((buf[i++] & 63) << 6) | (buf[i++] & 63); } else if (c >= 0xe0) { c = ((c & 15) << 12) | ((buf[i++] & 63) << 6) | (buf[i++] & 63); } else if (c >= 0xc0) { c = ((c & 31) << 6) | (buf[i++] & 63); } out += String.fromCodePoint(c); } return out; };
// Decodes the wanted layers of a vector tile: {name: {extent, features: [{type, props, parts}]}}, where parts are
// [x0, y0, x1, y1, …] in tile units (type 1 point, 2 line, 3 polygon rings).
function decodeTile(bytes, wanted) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), out = {}, r = pbf(buf, 0, buf.length);
  while (r.more()) {
    const [f, w] = r.tag();
    if (f !== 3 || w !== 2) { r.skip(w); continue; }
    const [ls, le] = r.bytes(), L = pbf(buf, ls, le);
    let name = "", extent = 4096;
    const keys = [], values = [], feats = [];
    while (L.more()) {
      const [lf, lw] = L.tag();
      if (lf === 1) { const [a, b] = L.bytes(); name = utf8(buf, a, b); if (wanted && !wanted.includes(name)) break; }
      else if (lf === 2) feats.push(L.bytes());
      else if (lf === 3) { const [a, b] = L.bytes(); keys.push(utf8(buf, a, b)); }
      else if (lf === 4) {
        const [a, b] = L.bytes(), V = pbf(buf, a, b);
        let v = null;
        while (V.more()) {
          const [vf, vw] = V.tag();
          if (vf === 1) { const [x, y] = V.bytes(); v = utf8(buf, x, y); }
          else if (vf === 2) v = V.f32();
          else if (vf === 3) v = V.f64();
          else if (vf === 4 || vf === 5) v = V.varint();
          else if (vf === 6) { const n = V.varint(); v = n % 2 ? -(n + 1) / 2 : n / 2; }
          else if (vf === 7) v = !!V.varint();
          else V.skip(vw);
        }
        values.push(v);
      } else if (lf === 5) extent = L.varint();
      else L.skip(lw);
    }
    if (!name || (wanted && !wanted.includes(name))) continue;
    const features = [];
    for (const [fs, fe] of feats) {
      const F = pbf(buf, fs, fe);
      let type = 0, tags = null, geom = null;
      while (F.more()) {
        const [ff, fw] = F.tag();
        if (ff === 2) { const [a, b] = F.bytes(), T = pbf(buf, a, b); tags = []; while (T.more()) tags.push(T.varint()); }
        else if (ff === 3) type = F.varint();
        else if (ff === 4) { const [a, b] = F.bytes(), G = pbf(buf, a, b); geom = []; while (G.more()) geom.push(G.varint()); }
        else F.skip(fw);
      }
      if (!geom) continue;
      const props = {};
      if (tags) for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
      const parts = [];
      let x = 0, y = 0, cur = null;
      for (let i = 0; i < geom.length;) {
        const c = geom[i++], id = c & 7, n = c >> 3;
        if (id === 7) { if (cur && cur.length >= 2) cur.push(cur[0], cur[1]); continue; } // close the ring
        for (let k = 0; k < n; k++) {
          const dx = geom[i++], dy = geom[i++];
          x += dx % 2 ? -(dx + 1) / 2 : dx / 2; y += dy % 2 ? -(dy + 1) / 2 : dy / 2;
          if (id === 1) { cur = [x, y]; parts.push(cur); } else cur.push(x, y);
        }
      }
      features.push({ type, props, parts });
    }
    out[name] = { extent, features };
  }
  return out;
}

// The vector tiles for a region (same framing as planRegion, at the most detailed zoom within MAX_FEATURE_TILES).
function planFeatures(lat, lon, widthKm, aspect) {
  let z = MAX_FEATURE_Z;
  for (; z > 2; z--) {
    const wpx = (widthKm * 1000) / metresPerPx(lat, z), hpx = wpx * aspect;
    if ((Math.ceil(wpx / 256) + 1) * (Math.ceil(hpx / 256) + 1) <= MAX_FEATURE_TILES) break;
  }
  const wpx = (widthKm * 1000) / metresPerPx(lat, z), hpx = wpx * aspect, cx = worldX(lon, z), cy = worldY(lat, z), x0 = cx - wpx / 2, y0 = cy - hpx / 2;
  const n = Math.pow(2, z), tiles = [];
  for (let ty = Math.max(0, Math.floor(y0 / 256)); ty <= Math.min(n - 1, Math.floor((y0 + hpx) / 256)); ty++)
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + wpx) / 256); tx++) tiles.push({ x: tx, y: ty });
  return { z, x0, y0, wpx, hpx, tiles };
}
const vecCache = new Map(); // "z/x/y" → decoded tile
async function vectorTile(z, x, y, fetchFn) {
  const n = Math.pow(2, z), wx = ((x % n) + n) % n, key = `${z}/${wx}/${y}`;
  if (vecCache.has(key)) return vecCache.get(key);
  if (!tileTemplate) {
    tileTemplate = (async () => {
      const r = await fetchFn(FEATURE_INFO);
      if (!r.ok) throw new Error(`The map server answered ${r.status}.`);
      return (await r.json()).tiles[0];
    })();
    tileTemplate.catch(() => { tileTemplate = null; }); // try again next time
  }
  const r = await fetchFn((await tileTemplate).replace("{z}", z).replace("{x}", wx).replace("{y}", y));
  if (r.status === 404 || r.status === 204) { vecCache.set(key, {}); return {}; } // nothing here (open sea)
  if (!r.ok) throw new Error(`The map server answered ${r.status} for tile ${key}.`);
  const t = decodeTile(new Uint8Array(await r.arrayBuffer()), FEATURE_LAYERS);
  if (vecCache.size > 600) vecCache.delete(vecCache.keys().next().value);
  vecCache.set(key, t);
  return t;
}
// The features of a region: [{layer, cls, sub, brunnel, type, parts: [Float64Array of x, y in 0..1 of the
// region], clip: [u0, v0, u1, v1] (the tile's own square, so overlapping tile edges draw once)}].
async function loadFeatures({ lat, lon, widthKm, aspect, fetchFn, onProgress }) {
  const plan = planFeatures(lat, lon, widthKm, aspect), out = [], queue = plan.tiles.slice();
  let done = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const t = queue.shift(), tile = await vectorTile(plan.z, t.x, t.y, fetchFn);
      const U = (gx) => (t.x * 256 + gx - plan.x0) / plan.wpx, V = (gy) => (t.y * 256 + gy - plan.y0) / plan.hpx;
      const clip = [U(0), V(0), U(256), V(256)];
      for (const layer of FEATURE_LAYERS) {
        const L = tile[layer];
        if (!L) continue;
        const k = 256 / L.extent;
        for (const f of L.features) {
          const parts = f.parts.map((p) => { const a = new Float64Array(p.length); for (let i = 0; i < p.length; i += 2) { a[i] = U(p[i] * k); a[i + 1] = V(p[i + 1] * k); } return a; });
          out.push({ layer, cls: f.props.class || "", sub: f.props.subclass || "", brunnel: f.props.brunnel || "", type: f.type, parts, clip, order: out.length });
        }
      }
      if (onProgress) onProgress(++done, plan.tiles.length);
    }
  }));
  out.sort((a, b) => a.order - b.order); // (the order tiles arrive in varies; keep it stable per tile set)
  return { features: out, z: plan.z, tiles: plan.tiles.length };
}

const MapHeights = { parseLocation, geocode, planRegion, loadRegion, decodePNG, inflate, metresPerPx, TILE_URL, decodeTile, planFeatures, loadFeatures, FEATURE_LAYERS };
if (typeof module !== "undefined") module.exports = MapHeights;
