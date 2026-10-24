// The Text art tab: FIGlet lettering, like patorjk.com's "Text to ASCII Art Generator" (TAAG), from the same
// library (figlet.js, MIT, in figlet.js) and its 332 fonts (figlet-fonts/). Text, a font (search in the picker,
// previous/next, or every font tried at once), the FIGlet layouts for character width and height, a line width
// with breaks at spaces, and more shaping: direction, alignment, line and letter spacing, case, the characters it
// draws with, invert, flip, trim and a frame. Style presets keep the shaping (not the text). "Use with effects"
// hands the art to the ASCII tab (S.textArt), where every effect applies to it.
"use strict";
const uxp = require("uxp");
const lfs = uxp.storage.localFileSystem, formats = uxp.storage.formats;
const { figlet } = require("./figlet.js");
const Engine = require("./engine.js");
const { createViewer, rgbToDataURL } = require("./viewer.js");
const { makeSlider, onDoubleClick, SLIDER_HTML } = require("./slider.js");
const { makePicker } = require("./picker.js");
const { makePresetBox } = require("./presetbox.js");
const { makeHistory } = require("./history.js");

const DEFAULTS = {
  text: "Hello", font: "Standard", hLayout: "default", vLayout: "default", width: 0, wsBreak: false,
  dir: "ltr", align: "left", lineGap: 0, letterGap: 0, // ltr | rtl; left | center | right
  textCase: "as", draw: "font", drawChars: "█", invert: false, flip: "none", trim: true, // as | upper | lower | title; font | char | text; none | h | v | hv
  frame: "none", framePad: 1, // none | single | double | rounded | heavy | ascii | stars | hash | dots | blocks
};
const SLIDERS = {
  width: ["Line width", 0, 300, 1, (v) => (v > 0 ? v + " ch" : "No limit")],
  lineGap: ["Line gap", 0, 12, 1, (v) => v + " rows"],
  letterGap: ["Letter spacing", 0, 8, 1, (v) => (v ? v + " ch" : "The font's")],
  framePad: ["Frame padding", 0, 8, 1, (v) => v + " ch"],
};
const SELECTS = { taH: "hLayout", taV: "vLayout", taDir: "dir", taAlign: "align", taCase: "textCase", taDraw: "draw", taFlip: "flip", taFrame: "frame" };
const CHECKS = { taWsBreak: "wsBreak", taInvert: "invert", taTrim: "trim" };
// frame corners and sides: top-left, top-right, bottom-left, bottom-right, horizontal, vertical
const FRAMES = { single: "┌┐└┘─│", double: "╔╗╚╝═║", rounded: "╭╮╰╯─│", heavy: "┏┓┗┛━┃", ascii: "++++-|", stars: "******", hash: "######", dots: "......", blocks: "██████" };
// characters that change when the art is mirrored left-right or flipped upside down
const MIRROR = { "/": "\\", "\\": "/", "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "╱": "╲", "╲": "╱", "▌": "▐", "▐": "▌", "╔": "╗", "╗": "╔", "╚": "╝", "╝": "╚", "┌": "┐", "┐": "┌", "└": "┘", "┘": "└", "╭": "╮", "╮": "╭", "╰": "╯", "╯": "╰", "╠": "╣", "╣": "╠", "├": "┤", "┤": "├" };
const FLIP = { "/": "\\", "\\": "/", "^": "v", "v": "^", "'": ",", ",": "'", "▀": "▄", "▄": "▀", "╱": "╲", "╲": "╱", "╔": "╚", "╚": "╔", "╗": "╝", "╝": "╗", "┌": "└", "└": "┌", "┐": "┘", "┘": "┐", "╭": "╰", "╰": "╭", "╮": "╯", "╯": "╮", "╦": "╩", "╩": "╦", "┬": "┴", "┴": "┬" };
// built-in style presets (the text stays yours)
const STYLES = [
  { id: "standard", name: "Standard", settings: {} },
  { id: "isometric", name: "Isometric", settings: { font: "Isometric1" } },
  { id: "shadow", name: "ANSI Shadow, framed", settings: { font: "ANSI Shadow", frame: "double", framePad: 1 } },
  { id: "slant", name: "Slant", settings: { font: "Slant" } },
  { id: "doom", name: "Doom, centred", settings: { font: "Doom", align: "center" } },
  { id: "blocks", name: "Solid blocks", settings: { font: "Banner3", draw: "char", drawChars: "█" } },
  { id: "negative", name: "Negative blocks", settings: { font: "Banner3", invert: true, draw: "char", drawChars: "█", framePad: 1 } },
  { id: "wide", name: "Wide and airy", settings: { font: "Standard", hLayout: "full", letterGap: 2, lineGap: 1, textCase: "upper" } },
  { id: "starry", name: "Starry frame", settings: { font: "Big", frame: "stars", framePad: 2, align: "center" } },
];

// Strict UTF-8, or null where the bytes aren't UTF-8.
function utf8(b) {
  const cps = [];
  for (let i = 0; i < b.length;) {
    const c = b[i];
    let cp, n;
    if (c < 0x80) { cp = c; n = 1; }
    else if ((c & 0xe0) === 0xc0) { cp = c & 0x1f; n = 2; }
    else if ((c & 0xf0) === 0xe0) { cp = c & 0x0f; n = 3; }
    else if ((c & 0xf8) === 0xf0) { cp = c & 0x07; n = 4; }
    else return null;
    if (i + n > b.length) return null;
    for (let k = 1; k < n; k++) { if ((b[i + k] & 0xc0) !== 0x80) return null; cp = (cp << 6) | (b[i + k] & 0x3f); }
    if ((n === 2 && cp < 0x80) || (n === 3 && cp < 0x800) || (n === 4 && (cp < 0x10000 || cp > 0x10ffff))) return null;
    cps.push(cp); i += n;
  }
  let s = "";
  for (let i = 0; i < cps.length; i += 8192) s += String.fromCodePoint.apply(null, cps.slice(i, i + 8192));
  return s;
}
// Font files are UTF-8 (block and box characters, one with a byte-order mark) or, for about a sixth, Latin-1.
function decodeFont(bytes) {
  const s = utf8(bytes);
  if (s !== null) return s.replace(/^\uFEFF/, "");
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return out;
}

// ---------- shaping (pure: text in, text out) ----------
const chars = (l) => Array.from(l);
const widthOf = (rows) => Math.max(0, ...rows.map((r) => chars(r).length));
const padTo = (r, w) => r + " ".repeat(Math.max(0, w - chars(r).length));
function changeCase(text, how) {
  if (how === "upper") return text.toUpperCase();
  if (how === "lower") return text.toLowerCase();
  if (how === "title") return text.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
  return text;
}
// One line of text as rows: whole, or letter by letter with `gap` columns between (letter spacing).
function lineRows(render, line, T) {
  if (!T.letterGap) return render(line).replace(/\s+$/, "").split("\n");
  const letters = chars(line).map((ch) => render(ch).split("\n"));
  if (T.dir === "rtl") letters.reverse();
  const hgt = Math.max(1, ...letters.map((b) => b.length)), gap = " ".repeat(T.letterGap);
  return Array.from({ length: hgt }, (_, i) => letters.map((b) => padTo(b[i] || "", widthOf(b))).join(gap));
}
// The art for settings T, with render(text) → FIGlet rows (the font and layouts already chosen).
function compose(T, render) {
  const text = changeCase(String(T.text || ""), T.textCase);
  if (!text.trim()) return "";
  let rows;
  if (T.align === "left" && !T.lineGap && !T.letterGap) rows = render(text).split("\n"); // whole: Character height applies between lines
  else {
    const blocks = text.split("\n").map((l) => (l.trim() ? lineRows(render, l, T) : [""]));
    const W = Math.max(...blocks.map(widthOf));
    rows = [];
    blocks.forEach((b, k) => {
      const bw = widthOf(b), shift = T.align === "center" ? Math.floor((W - bw) / 2) : T.align === "right" ? W - bw : 0;
      if (k && T.lineGap) for (let g = 0; g < T.lineGap; g++) rows.push("");
      for (const r of b) rows.push(" ".repeat(shift) + r);
    });
  }
  rows = rows.map((r) => r.replace(/\s+$/, ""));
  if (T.trim) {
    while (rows.length && !rows[0].trim()) rows.shift();
    while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
    const lead = Math.min(...rows.filter((r) => r.trim()).map((r) => chars(r).length - chars(r.replace(/^ +/, "")).length));
    if (lead > 0 && isFinite(lead)) rows = rows.map((r) => chars(r).slice(lead).join(""));
  }
  let W = widthOf(rows);
  let grid = rows.map((r) => chars(padTo(r, W)));
  if (T.flip === "h" || T.flip === "hv") grid = grid.map((r) => r.reverse().map((c) => MIRROR[c] || c));
  if (T.flip === "v" || T.flip === "hv") grid = grid.reverse().map((r) => r.map((c) => FLIP[c] || c));
  if (T.invert) grid = grid.map((r) => r.map((c) => (c === " " ? "█" : " ")));
  if (T.draw !== "font") { // every drawn cell gets one character, or your text in reading order
    const pat = chars(String(T.drawChars || "")).filter((c) => c !== " " && c !== "\n");
    let k = 0;
    if (pat.length) grid = grid.map((r) => r.map((c) => (c === " " ? c : T.draw === "char" ? pat[0] : pat[k++ % pat.length])));
  }
  if (T.frame !== "none" && FRAMES[T.frame]) {
    const [tl, tr, bl, br, hz, vt] = chars(FRAMES[T.frame]), p = Math.max(0, T.framePad | 0), inner = W + 2 * p;
    const blank = Array(inner).fill(" ");
    grid = [[tl, ...Array(inner).fill(hz), tr]]
      .concat(Array.from({ length: p }, () => [vt, ...blank, vt]))
      .concat(grid.map((r) => [vt, ...Array(p).fill(" "), ...r, ...Array(p).fill(" "), vt]))
      .concat(Array.from({ length: p }, () => [vt, ...blank, vt]))
      .concat([[bl, ...Array(inner).fill(hz), br]]);
  }
  return grid.map((r) => r.join("").replace(/\s+$/, "")).join("\n");
}

// h: helpers from main.js ($, loadJSON, saveJSON, errMsg, setSelect, fitLayout, onCheck, refreshFields, atlasFor, baseAtlas, useArt)
function setupTextArt(h) {
  const { $ } = h;
  const T = Object.assign({}, DEFAULTS, h.loadJSON("gf:textArt", {}));
  let fonts = [], folder = null, art = "", pv = null, timer = null, allGen = 0, ready = null;
  const loaded = new Set(), sliders = {};
  // every change is saved and noted for ↶ Undo (typing and slider drags make one step per pause)
  const hist = makeHistory({
    state: () => JSON.stringify(T),
    restore: (st) => { Object.assign(T, JSON.parse(st)); h.saveJSON("gf:textArt", T); sync(); update(0); },
    onAvail: (can) => { $("taUndo").disabled = !can; },
  });
  const save = () => { h.saveJSON("gf:textArt", T); hist.note(); };
  const status = (msg, isErr) => { const el = $("taStatus"); el.textContent = msg || ""; el.style.color = isErr ? "#ff7070" : ""; };

  // ---------- fonts ----------
  async function fontFolder() { if (!folder) folder = await (await lfs.getPluginFolder()).getEntry("figlet-fonts"); return folder; }
  async function listFonts() {
    const entries = await (await fontFolder()).getEntries();
    fonts = entries.filter((e) => e.isFile && /\.flf$/i.test(e.name)).map((e) => e.name.slice(0, -4)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    if (!fonts.includes(T.font)) T.font = fonts.includes("Standard") ? "Standard" : fonts[0];
    picker.fill(); showCount();
  }
  async function loadFont(name) {
    if (loaded.has(name)) return;
    const entry = await (await fontFolder()).getEntry(name + ".flf");
    figlet.parseFont(name, decodeFont(new Uint8Array(await entry.read({ format: formats.binary }))));
    loaded.add(name);
  }
  const layoutOf = (font) => ({ font, horizontalLayout: T.hLayout, verticalLayout: T.vLayout, width: T.width > 0 ? T.width : undefined, whitespaceBreak: T.wsBreak, printDirection: T.dir === "rtl" ? 1 : 0 });
  const shownFonts = () => { const q = picker.query(); return q ? fonts.filter((f) => f.toLowerCase().includes(q)) : fonts; };
  function showCount() { $("taFontCount").textContent = `${fonts.length} fonts`; }
  function pickFont(name) { T.font = name; save(); picker.fill(); update(0); }
  function stepFont(d) { const list = fonts; if (!list.length) return; const i = list.indexOf(T.font); pickFont(list[((i < 0 ? 0 : i + d) + list.length) % list.length]); }

  // ---------- the art ----------
  function update(delay) { clearTimeout(timer); timer = setTimeout(regenerate, delay === undefined ? 120 : delay); }
  async function regenerate() {
    try {
      await (ready || (ready = listFonts()));
      await loadFont(T.font);
      art = compose(T, (t) => figlet.textSync(t, layoutOf(T.font)));
      await preparePreview();
      const rows = art ? art.split("\n") : [];
      status(art ? `${T.font} · ${widthOf(rows)} × ${rows.length} characters` : "Type some text.");
      viewer.refresh();
    } catch (e) { console.error(e); status(`${T.font}: ${h.errMsg(e)}`, true); }
  }
  // A plain look for the panel's preview: light characters on dark, a cell of margin.
  function plainLook(text, size) {
    return Object.assign(JSON.parse(JSON.stringify(Engine.DEFAULTS)), { textArtOn: true, textArt: text, textArtFit: false, size, fg: "#e6e6e6", bg: "#1d1d1d", colorMode: "mono", keepAlpha: false });
  }
  function gridOf(text, s, atlas) {
    const rows = text.split("\n"), cell = Engine.computeGeometry(1, 1, s, atlas);
    const geo = Engine.computeGeometry((Math.max(1, widthOf(rows)) + 2) * cell.cellW, (rows.length + 2) * cell.cellH, s, atlas), cs = Engine.charsetOf(atlas, s, "", "");
    return { geo, cs, grid: Engine.computeGrid({ w: 1, h: 1, data: new Uint8Array(4) }, geo, s, cs) };
  }
  async function preparePreview() {
    if (!art) { pv = null; return; }
    const atlas = await h.atlasFor(Array.from(new Set(art.replace(/\n/g, ""))).join("")), s = plainLook(art, 14);
    pv = Object.assign({ s, atlas }, gridOf(art, s, atlas));
  }
  function renderRegion(rect, z) {
    if (!pv) return null;
    const w = Math.max(1, Math.round(rect.w * z)), hh = Math.max(1, Math.round(rect.h * z));
    return { rgb: Engine.flattenForPreview(Engine.render(pv.grid, pv.cs, pv.atlas, pv.s, { x: rect.x, y: rect.y, w, h: hh, scale: z }), w, hh), w, h: hh };
  }

  // ---------- every font at once ----------
  // Small previews of the first line in every font (or those the font search finds), a few at a time; click one
  // to use it. Built-in glyphs only (characters the built-in font lacks stay empty here), so it stays quick.
  async function tryAll() {
    const box = $("taAll"), my = ++allGen, line = (changeCase(T.text, T.textCase).split("\n")[0] || "Abc").slice(0, 24);
    box.innerHTML = ""; box.classList.remove("hidden");
    $("taAllBtn").textContent = "Stop";
    await (ready || (ready = listFonts()));
    const list = shownFonts(), atlas = h.baseAtlas();
    for (let i = 0; i < list.length; i += 8) {
      if (my !== allGen) return;
      for (const name of list.slice(i, i + 8)) {
        try {
          await loadFont(name);
          const a = figlet.textSync(line, { font: name, horizontalLayout: T.hLayout, printDirection: T.dir === "rtl" ? 1 : 0 }).replace(/\s+$/, "");
          if (!a.trim()) continue;
          const s = plainLook(a, 7), { geo, cs, grid } = gridOf(a, s, atlas), W = Math.round(geo.docW), H = Math.round(geo.docH);
          const rgb = Engine.flattenForPreview(Engine.render(grid, cs, atlas, s, { x: 0, y: 0, w: W, h: H, scale: 1 }), W, H);
          const item = document.createElement("div"), label = document.createElement("div"), img = document.createElement("img");
          item.className = "taItem" + (name === T.font ? " on" : ""); label.className = "taName"; label.textContent = name;
          img.src = await rgbToDataURL(rgb, W, H);
          item.appendChild(label); item.appendChild(img);
          item.addEventListener("click", () => { for (const x of box.querySelectorAll(".taItem")) x.classList.remove("on"); item.classList.add("on"); pickFont(name); });
          if (my !== allGen) return;
          box.appendChild(item);
        } catch (e) { console.error(name, e); }
      }
      status(`Trying every font… ${Math.min(i + 8, list.length)} of ${list.length}`);
      await new Promise((r) => setTimeout(r, 0));
    }
    if (my === allGen) { $("taAllBtn").textContent = "Try every font"; status(`${list.length} fonts. Click one to use it.`); }
  }
  function stopAll() { allGen++; $("taAllBtn").textContent = "Try every font"; }

  // ---------- Randomize ----------
  // A random style for your text: any font, now and then other layouts, case, spacing, alignment, a frame,
  // drawing with one character or your own letters, invert or a flip. The text, line width and breaks stay.
  const pick = (a) => a[Math.floor(Math.random() * a.length)], chance = (p) => Math.random() < p;
  const LAYOUTS = ["default", "full", "fitted", "controlled smushing", "universal smushing"];
  async function randomize() {
    await (ready || (ready = listFonts()));
    const letters = Array.from(new Set(Array.from(T.text.replace(/\s/g, "")))).join("");
    const draw = chance(0.75) ? "font" : chance(0.6) ? "char" : "text";
    Object.assign(T, {
      font: pick(fonts), hLayout: chance(0.75) ? "default" : pick(LAYOUTS), vLayout: chance(0.85) ? "default" : pick(LAYOUTS),
      align: pick(["left", "center", "center", "right"]), lineGap: chance(0.7) ? 0 : 1, letterGap: chance(0.8) ? 0 : pick([1, 1, 2]),
      textCase: chance(0.6) ? "as" : pick(["upper", "upper", "lower", "title"]), draw,
      drawChars: draw === "char" ? pick(["█", "▓", "▒", "#", "@", "*", "+", "$", "%"]) : draw === "text" ? letters || "STAR" : T.drawChars,
      invert: chance(0.1), flip: chance(0.92) ? "none" : pick(["h", "v"]), dir: "ltr",
      frame: chance(0.65) ? "none" : pick(Object.keys(FRAMES)), framePad: pick([0, 1, 1, 2]),
    });
    save(); sync(); update(0);
    status(`Random style: ${T.font}. ↶ Undo goes back.`);
  }

  // ---------- panel ----------
  const viewer = createViewer({
    wrap: $("textPreviewWrap"), img: $("textPreview"), msg: $("textPreviewMsg"), bar: $("textZoomBar"), grip: $("textPreviewGrip"), head: $("textPreviewHead"), storeKey: "gf:zoom:text", onLayout: () => h.fitLayout(true),
    docSize: () => (pv ? { w: pv.geo.docW, h: pv.geo.docH } : null), render: renderRegion,
    onError: (e) => { console.error(e); status(h.errMsg(e), true); },
  });
  const picker = makePicker({
    ids: { button: "taFontPicker", current: "taFontCurrent", chev: "taFontChev", panel: "taFontPanel", search: "taFontSearch", list: "taFontList" },
    label: () => T.font, items: (q) => (q ? fonts.filter((f) => f.toLowerCase().includes(q)) : fonts).map((f) => ({ id: f, label: f })), selected: () => T.font,
    onPick: (id) => pickFont(id), none: () => "No font matches", onToggle: () => h.fitLayout(true),
  });
  function sync() { // the controls from T
    $("taText").value = T.text; $("taDrawChars").value = T.drawChars;
    for (const [id, k] of Object.entries(SELECTS)) h.setSelect($(id), T[k]);
    for (const [id, k] of Object.entries(CHECKS)) { $(id).checked = !!T[k]; if ($(id).ckUpdate) $(id).ckUpdate(); }
    for (const [k, sl] of Object.entries(sliders)) { sl.input.value = T[k]; sl.val.textContent = SLIDERS[k][4](T[k]); }
    $("taDrawRow").classList.toggle("hidden", T.draw === "font");
    $("taFrameRows").classList.toggle("hidden", T.frame === "none");
    picker.fill(); h.refreshFields();
  }
  for (const [k, [label, min, max, step, fmt]] of Object.entries(SLIDERS)) {
    const host = $("tasl-" + k);
    host.innerHTML = `<div class="row"><span class="label" title="Double-click the name or the handle to reset">${label}</span>${SLIDER_HTML}<span class="val"></span></div>`;
    const val = host.querySelector(".val"), set = (v) => { T[k] = v; val.textContent = fmt(v); save(); update(); };
    const reset = () => { sliders[k].input.value = DEFAULTS[k]; set(DEFAULTS[k]); };
    sliders[k] = { input: makeSlider(host.querySelector(".slider"), min, max, step, set, reset), val };
    onDoubleClick(host.querySelector(".label"), reset);
  }
  for (const [id, k] of Object.entries(SELECTS)) $(id).addEventListener("change", () => { T[k] = $(id).value; save(); sync(); update(0); });
  for (const [id, k] of Object.entries(CHECKS)) h.onCheck($(id), (v) => { T[k] = v; save(); update(0); });
  $("taText").addEventListener("input", () => { T.text = $("taText").value; save(); update(); });
  $("taDrawChars").addEventListener("input", () => { T.drawChars = $("taDrawChars").value; save(); update(); });
  $("taPrev").addEventListener("click", () => stepFont(-1));
  $("taNext").addEventListener("click", () => stepFont(1));
  $("taAllBtn").addEventListener("click", () => ($("taAllBtn").textContent === "Stop" ? stopAll() : tryAll()));
  $("taFontSearch").addEventListener("input", () => { if (!$("taAll").classList.contains("hidden")) tryAll(); });
  $("taCopy").addEventListener("click", async () => {
    if (!art) return status("Type some text first.", true);
    try { await navigator.clipboard.setContent({ "text/plain": art }); status("Copied the text art."); } catch (e) { status(h.errMsg(e), true); }
  });
  $("taUse").addEventListener("click", () => { if (!art) return status("Type some text first.", true); h.useArt(art, T.font); });
  $("taRandom").addEventListener("click", randomize);
  $("taUndo").addEventListener("click", () => { if (hist.undo()) status("Undone." + (hist.canUndo() ? "" : " Nothing more to undo.")); });
  const style = () => { const o = Object.assign({}, T); delete o.text; return o; };
  makePresetBox({
    $, loadJSON: h.loadJSON, saveJSON: h.saveJSON, setSelect: h.setSelect, status, errMsg: h.errMsg, lfs, formats,
    ids: { select: "taPreset", reset: "taPresetReset", name: "taPresetName", save: "taPresetSave", del: "taPresetDelete", exp: "taPresetExport", imp: "taPresetImport" },
    storeKey: "gf:textArtPresets", builtIns: STYLES, builtInLabel: "Built-in styles", fileName: "ascii-by-star-text-styles.json", fileTag: "asciiByStarText",
    current: style, apply: (st) => { Object.assign(T, DEFAULTS, st, { text: T.text }); save(); sync(); update(0); },
    fresh: (st) => { const o = {}; for (const k of Object.keys(DEFAULTS)) if (k !== "text" && st[k] !== undefined) o[k] = st[k]; return o; },
  });
  sync();
  hist.note(); // the starting point

  return {
    viewer,
    activate() { update(0); },
    deactivate() { stopAll(); },
    relayout() { viewer.relayout(); },
  };
}

if (typeof module !== "undefined") module.exports = Object.assign(setupTextArt, { compose, decodeFont }); // compose and decodeFont: for tests
