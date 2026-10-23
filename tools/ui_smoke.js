// Smoke-test main.js UI wiring in Node with a fake DOM built from index.html ids.
const fs = require("fs"), root = require("path").join(__dirname, "../plugin/");
const html = fs.readFileSync(root + "index.html", "utf8");
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const els = {};
const mk = (id) => ({ id, value: "", checked: false, textContent: "", innerHTML: "", style: {}, dataset: {}, options: [], classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {}, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, insertBefore() {}, childNodes: [], querySelector(sel) { return mk(id + sel); }, querySelectorAll() { return []; }, getBoundingClientRect() { return { left: 0, top: 0, width: 1, height: 1 }; }, offsetHeight: 100 });
for (const id of ids) els[id] = mk(id);
global.document = { getElementById: (id) => { if (!els[id]) throw new Error("missing element #" + id); return els[id]; }, querySelectorAll: () => [], createElement: (t) => mk("new-" + t), documentElement: {}, addEventListener() {} };
global.window = { innerHeight: 800, addEventListener() {} };
global.localStorage = { getItem: () => null, setItem() {} };
global.navigator = {};
const Module = require("module"); const orig = Module._load;
Module._load = function (req, ...a) { if (req === "photoshop") return { app: {}, core: {}, action: { addNotificationListener() {} }, imaging: {}, constants: { LayerKind: {} } }; if (req === "uxp") return { storage: { localFileSystem: { getPluginFolder: async () => { throw new Error("no atlas in smoke test"); } }, formats: {} } }; return orig.call(this, req, ...a); };
global.setInterval = () => 0;
require(root + "main.js");
setTimeout(() => console.log("UI smoke test: buildUI/syncUI ran without errors"), 50);
