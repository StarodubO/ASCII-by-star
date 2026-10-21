# ASCII by Star

A Photoshop plugin that turns any image into ASCII and glyph art with a live preview, and adds realistic ink bleed on paper to any layer.

![logo](logo/ascii-by-star-logo.png)

## Install (Photoshop 2024 / v25 or newer)
1. Download the **`.ccx`** file (`ASCII.by.Star.ccx`) from the [latest release](https://github.com/StarodubO/ascii-by-star/releases/latest).
2. Double-click it. Creative Cloud installs it and warns that it isn't from the marketplace; confirm.
3. Restart Photoshop and open **Plugins ▸ ASCII by Star**.

Works with RGB and Grayscale documents at 8, 16 and 32 bits per channel, including artboard documents. Developed and tested on macOS.

## ASCII tab
- **Characters:** 60+ character sets (classic ASCII ramps, blocks, Braille, box drawing, katakana "Matrix", runes, symbols) or your own text, in three ways:
  - **As a brightness ramp:** each character is one tone step.
  - **As words:** words or letter pairs, e.g. `· oo OK WOW ###`. Each covers as many cells as it has letters; darker areas get inkier words.
  - **Written out, repeating:** a phrase fills the image like a typed page, with the picture showing through the letters' shade and colour.
- **Any installed font**, including your own: browse every installed font (each shown in its own typeface) or take it from a text layer. Photoshop renders it once, then it's cached. Characters missing from the built-in font are drawn by Photoshop, so nothing you type is dropped.
- **Shape matching:** picks characters that follow edges, not just brightness.
- **Tone:** contrast, brightness, gamma, threshold, invert, and 21 dithering modes (error diffusion, ordered Bayer, halftone screens, blue/white noise).
- **Colour:** a single colour, the image's own colours, or a 2–3 stop gradient map. The background can be solid, transparent or a colour mosaic. By default the output keeps the source's transparency (cut-out PNGs stay cut out).
- **Shadows:** drop shadow, long / 3D extrude shadow, offset (riso-style) shadow and glow, which can be combined. They scale with the character size.
- **Glitch** (seeded, so the preview, apply and batch all match): pixel sort, slice shift, datamosh, wave, melt, bit crush, channel swap; character corruption, row shift and stutter; RGB split, interlace, VHS tracking, scanlines and noise. Plus a **Randomize** button.
- **Output:**
  - a pixel layer, or a 2×/4× smart object that stays sharp when scaled up;
  - an editable text layer;
  - PNG at 1×, 2× or 4×;
  - .txt, coloured .html or vector .svg, or copy to the clipboard.
- **Live smart object:** places the result as a smart object and updates it as you change settings, with Photoshop's own zoom and pan.
- **Re-edit:** select a generated layer, adjust and **Update layer**.
- **Presets:** 24 built-in looks, plus your own presets, which you can import and export.
- **Batch:** process a folder of images to PNG (and optionally .txt).

## Ink bleed tab
Adds an ink-on-paper overlay to any layer (or the whole visible image) without touching it. The result is a group named *“<layer> Ink Bleed”* with four blend-mode layers you can fine-tune in Photoshop: **Ink bleed** and **Ink pooling** (Multiply), **Ink gaps** (Normal, showing the paper under your layer through the ink) and **Paper** (Multiply). For light ink on dark paper the modes swap automatically.

- **Paper:** 8 generated paper types (newsprint, office paper, blotting paper, washi, laid paper, cold-press watercolour, kraft, rough print) or **any image file as the paper**: your own scans, at any size. The texture shapes the bleed: ink skips its raised parts and pools in its dips.
- **Bleed:** wetness, distance, feathering, wicking along fibres, halo opacity and edge softness.
- **Inside the ink:** pooling, rim width, granulation, dry skip and mottling.
- **Paper settings:** grain size, grain, relief, fibres (amount, length, visibility, alignment, direction), laid lines and flecks, or texture scale, strength and colour.
- A 100% / 200% preview of any spot (click the preview to choose it). **Update overlay** re-renders in place and keeps your layer tweaks.

## Making changes
| What | Where |
|---|---|
| Panel layout | `plugin/index.html` |
| Photoshop logic for the ASCII tab (pixels, layers, export, batch) | `plugin/main.js` |
| ASCII rendering engine (pure JS, no Photoshop) | `plugin/engine.js` |
| Ink bleed effect (pure JS) / its tab and Photoshop I/O | `plugin/ink.js` / `plugin/inkui.js` |
| Wheel-safe sliders and dropdowns | `plugin/slider.js`, `plugin/dropdown.js` |
| Character sets | `plugin/charsets.js`, then rebuild the atlas (below) |
| Built-in looks | `plugin/presets.js` |
| Logo and icons | `tools/make_logo.js` writes `logo/` and `plugin/icons/` |

**Build and install:** `tools/package.sh --install`, then restart Photoshop. Without `--install` it only builds the `.ccx`. Bump `"version"` in `plugin/manifest.json` for each release.

**Rebuild the glyph atlas** (after editing charsets; needs macOS for the Menlo font):
```
node -e 'require("fs").writeFileSync("tools/chars.json", JSON.stringify(require("./plugin/charsets.js").allChars()))'
swift tools/gen_atlas.swift tools/chars.json plugin
```

**Tests without Photoshop:**
- `node tools/test_engine.js test/sample.png /tmp/out` renders every preset to PNG; compare md5s between builds.
- `node tools/test_ink.js test/sample.png /tmp/ink --check` renders every paper type and checks that tiled rendering matches a one-piece render.
- `node tools/ui_smoke.js` checks the panel builds.
- `test/sample.png` is drawn by `node tools/make_sample.js`.

**Tests in Photoshop:** `node tools/build_test.js` writes `test/gf_test.psjs` (set `TEST=ink`, `shadow`, `text`, `png` or `depth` for the other suites; `LOG_MIRROR=<file>` also writes the log there). Then run `open -a "Adobe Photoshop 2026" test/gf_test.psjs`.

## License
[MIT](LICENSE). The built-in glyph atlas (`plugin/atlas.bin`) is rasterised from the Menlo typeface that ships with macOS.
