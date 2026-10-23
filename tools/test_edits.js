// Checks symbol edits (Edit symbols, engine applyEdits): node tools/test_edits.js test/sample.png
const fs = require("fs"), path = require("path");
const E = require("../plugin/engine.js"), { CHARSETS } = require("../plugin/charsets.js");
const { readPNG } = require("./test_engine.js");
const atlas = E.prepareAtlas(JSON.parse(fs.readFileSync(path.join(__dirname, "../plugin/atlas.json"))), fs.readFileSync(path.join(__dirname, "../plugin/atlas.bin")));
const src = readPNG(process.argv[2] || path.join(__dirname, "../test/sample.png"));
const chars = (id) => (CHARSETS.find((c) => c.id === id) || {}).chars;
function run(over) {
  const s = Object.assign({}, E.DEFAULTS, { charset: "standard", size: 16 }, over);
  const cs = E.charsetOf(atlas, s, chars(s.charset), chars(s.rainCharset)), geo = E.computeGeometry(src.w, src.h, s, atlas);
  return { s, cs, geo, grid: E.computeGrid(src, geo, s, cs) };
}
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok || info === undefined ? "" : " " + JSON.stringify(info))); if (!ok) fails++; };
const at = (r, c, geo) => [((c + 0.5) * geo.cellW) / geo.docW, ((r + 0.5) * geo.cellH) / geo.docH];
const chOf = (x, i) => (x.grid.glyph[i] < 0 ? " " : x.cs.chars[x.grid.glyph[i]]);

const base = run({});
const { geo } = base, cols = geo.cols, idx = (r, c) => r * cols + c;
let x = run({ cellEdits: [{ op: "write", text: "★", pts: [at(5, 7, geo)] }] });
check("write a character the set lacks", chOf(x, idx(5, 7)) === "★", chOf(x, idx(5, 7)));
check("other cells untouched", x.grid.glyph.every((g, i) => i === idx(5, 7) || chOf(x, i) === chOf(base, i)));

x = run({ cellEdits: [{ op: "write", text: "AB", pts: [at(3, 2, geo), at(3, 3, geo), at(3, 3, geo), at(3, 4, geo)] }] });
check("stroke cycles the text, each cell once", [2, 3, 4].map((c) => chOf(x, idx(3, c))).join("") === "ABA", [2, 3, 4].map((c) => chOf(x, idx(3, c))).join(""));

const [fx0, fy0] = at(10, 10, geo), [fx1, fy1] = at(11, 12, geo);
x = run({ cellEdits: [{ op: "write", text: "STAR", rect: [fx0 - 0.001, fy0 - 0.001, fx1 + 0.001, fy1 + 0.001] }] });
const rectText = [10, 11].map((r) => [10, 11, 12].map((c) => chOf(x, idx(r, c))).join("")).join("|");
check("selection in reading order", rectText === "STA|RST", rectText);

x = run({ cellEdits: [{ op: "erase", pts: [at(5, 7, geo)] }, { op: "write", text: "Z", pts: [at(6, 7, geo)] }, { op: "restore", pts: [at(5, 7, geo), at(6, 7, geo)] }] });
check("erase then restore gives the original back", chOf(x, idx(5, 7)) === chOf(base, idx(5, 7)) && chOf(x, idx(6, 7)) === chOf(base, idx(6, 7)));

x = run({ cellEdits: [{ op: "color", color: "#ff0000", rect: [0, 0, 1, 1] }] });
const red = x.grid.glyph.every((g, i) => g < 0 || (x.grid.color[i * 3] === 255 && x.grid.color[i * 3 + 1] === 0));
check("recolour everything with a character", red);
check("recolour shows in HTML export", /color:#ff0000/.test(E.toHTML(x.grid, x.cs, x.s)));
check("no edits: plain mono HTML", !/<span/.test(E.toHTML(base.grid, base.cs, base.s)));

const pt = [0.5, 0.5], big = run({ size: 32, cellEdits: [{ op: "write", text: "@", pts: [pt] }] }), g2 = big.geo;
const c2 = Math.floor((pt[0] * g2.docW) / g2.cellW), r2 = Math.floor((pt[1] * g2.docH) / g2.cellH);
check("edit follows the picture when the size changes", chOf(big, r2 * g2.cols + c2) === "@");

x = run({ cellEdits: [{ op: "write", text: "#", color: "#00ff00", pts: [at(4, 4, geo)] }], glitchOn: false });
const one = E.render(x.grid, x.cs, atlas, x.s, { x: 0, y: 0, w: src.w, h: src.h, scale: 1 });
let diff = 0;
for (let y0 = 0; y0 < src.h; y0 += 37) {
  const h = Math.min(37, src.h - y0), part = E.render(x.grid, x.cs, atlas, x.s, { x: 0, y: y0, w: src.w, h, scale: 1 });
  for (let i = 0; i < part.length; i++) diff = Math.max(diff, Math.abs(part[i] - one[y0 * src.w * 4 + i]));
}
check("strips match a one-piece render", diff === 0, diff);

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
