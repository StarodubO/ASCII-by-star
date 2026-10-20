# ASCII by Star: notes for Claude

Photoshop UXP plugin (manifest v5, id `com.ostap.asciibystar`, PS ≥ 25). The user tests in Photoshop 2026 (v27.11) on macOS.

- `plugin/engine.js` is pure JS and shared by the plugin and the Node tools. Keep it free of Photoshop APIs.
- UXP canvas can't draw text, so glyphs come from `plugin/atlas.bin`: 8-bit alpha, 24×47 cells of Menlo at 40pt, rasterized by `tools/gen_atlas.swift`. Rebuild it after changing `charsets.js`.
- Modules load via `require("./x.js")` from `main.js`. Do not add `<script>` tags for them.
- Output layers are named `<source layer> ASCII by Star` (`OUR_RE`; older `#xxxxxx` tags still recognised). Re-edit settings live in localStorage under `gf:layer:<doc title>:<layer id>`, with `gf:layerName:<name>` as a fallback. Merged reads hide these layers first.
- Composite `imaging.getPixels` fails on some documents ("Could not update smart object files"), e.g. artboards. `readViaStamp()` falls back to a temporary mergeVisible layer.
- The UXP text API (`createTextLayer`, leading) takes pixel values, not points.
- Icons: the manifest path `icons/x.png` with `scale: [1,2]` means the files must be named `x@1x.png` and `x@2x.png`. Generate them with `node tools/make_logo.js`.
- Font list: use batchPlay `get fontList`. Walking `app.fonts` takes about 30 s.
- Build and install: `tools/package.sh --install`. Headless Photoshop tests: `node tools/build_test.js`, then `open -a "Adobe Photoshop 2026" test/gf_test.psjs`. The log lands in the UXP PluginData temp folder. A syntax error in a .psjs leaves a dialog open in Photoshop that blocks later scripts.
- No screen or accessibility access from the shell. Ask the user for screenshots of the panel.
- Glitch: three stages in engine.js. `glitchSource` runs on the analysis image, `glitchGrid` on the character grid, and `glitchOutput` on the rendered RGBA (row-local only, so strip rendering matches). Everything is gated by `s.glitchOn` and seeded by `s.glitchSeed`, with sizes in document-relative units. Never add an effect that moves pixels vertically in `glitchOutput`.
- Before shipping engine changes: render all looks with `node tools/test_engine.js test/dahlia.png <dir>` and compare md5s with the previous build (unrelated looks must be byte-identical). Then `node tools/ui_smoke.js`: it checks that every element id main.js uses exists in index.html and that the UI builds. The "no atlas" error is expected.
- Live view = smart object: `toggleLive` places a smart object (`placeSmartObject`), selects it, runs `placedLayerEditContents` and treats the opened .psb as the live window. `runLive` writes into it (with corner markers), and `saveLive` saves the .psb about 0.9 s after edits pause, which updates the parent. `closeLive` saves and closes. In-panel zoom/pan was removed because UXP routes wheel events badly.
- Apply quality > 1: `placeSmartObject` renders N× into a scratch doc (with invisible corner pixels so bounds equal the canvas), runs `newPlacedLayer`, duplicates into the source doc and scales by 1/N anchored top-left. If it fails it falls back to a pixel layer and says so in the status line.
- Custom fonts: `buildFontAtlas` creates one text layer per character in a scratch doc, reads the composite and crops the glyphs centred into cells. Results are cached in memory and in the data folder as `font-<hash>.json/.bin`. `readyAtlas()` must run before any render; it swaps the global `atlas`. Cache keys include `atlas.id`.
- Installing: Adobe's installer keeps old versions enabled side by side, and Photoshop may load an old one. `tools/package.sh --install` removes every copy first. Check `~/Library/Application Support/Adobe/UXP/PluginsInfo/*/PS.json` if the user doesn't see a change.

