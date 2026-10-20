# ASCII by Star: notes for Claude

Photoshop UXP plugin (manifest v5, id `com.ostap.asciibystar`, PS ≥ 25). The user tests in Photoshop 2026 (v27.11) on macOS.

- `plugin/engine.js` is pure JS and shared by the plugin and the Node tools. Keep it free of Photoshop APIs.
- UXP canvas can't draw text, so glyphs come from `plugin/atlas.bin`: 8-bit alpha, 24×47 cells of Menlo at 40pt, rasterized by `tools/gen_atlas.swift`. Rebuild it after changing `charsets.js`.
- Modules load via `require("./x.js")` from `main.js`. Do not add `<script>` tags for them.
- Layers made by the plugin are tagged `… #xxxxxx`. Settings for re-editing live in localStorage under `gf:layer:<tag>`. Merged reads hide tagged layers first.
- Composite `imaging.getPixels` fails on some documents ("Could not update smart object files"), e.g. artboards. `readViaStamp()` falls back to a temporary mergeVisible layer.
- The UXP text API (`createTextLayer`, leading) takes pixel values, not points.
- Font list: use batchPlay `get fontList`. Walking `app.fonts` takes about 30 s.
- Build and install: `tools/package.sh --install`. Headless Photoshop tests: `node tools/build_test.js`, then `open -a "Adobe Photoshop 2026" test/gf_test.psjs`. The log lands in the UXP PluginData temp folder. A syntax error in a .psjs leaves a dialog open in Photoshop that blocks later scripts.
- No screen or accessibility access from the shell. Ask the user for screenshots of the panel.
