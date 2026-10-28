// The Glitch section of the Dither, Lines and Map tabs (glitch.js): sliders, effect menus and the Random,
// New seed and Clear buttons, bound to the tab's settings object. The section's markup is in index.html with the
// tab's prefix (ids <p>GlOn, <p>GlWhere, <p>GlSwap, <p>GlRandom, <p>GlSeed, <p>GlClear, <p>GlBody, <p>gsl-<key>).
"use strict";
const Glitch = require("./glitch.js");
const { makeSlider, onDoubleClick, SLIDER_HTML } = require("./slider.js");

const pct = (v) => Math.round(v * 100) + "%";
const SLIDERS = {
  glSlices: ["Slices", "Bands of rows pushed sideways."], glSliceSize: ["Slice height", "How tall the slices are."],
  glWave: ["Wave", "Rows bent by a wave."], glWaveFreq: ["Wave count", "How many waves from top to bottom."],
  glBlocks: ["Blocks", "Broken macroblocks, like a corrupted video: shifted, smeared, inverted or tinted."], glBlockSize: ["Block size", "How big the blocks are."],
  glSort: ["Pixel sort", "Sorts runs of bright pixels along each row, dark to light. More = more of the picture sorted."],
  glSplit: ["RGB split", "Red and blue pulled apart sideways."], glInterlace: ["Interlace", "Every other band of lines shifted, like an interlaced video."],
  glTracking: ["Tracking", "VHS tracking bands: rows torn sideways, with noise."], glCrush: ["Bit crush", "Fewer colour levels: banding."],
  glScanlines: ["Scanlines", "Dark lines across, like a CRT."], glNoise: ["Noise", "Static over the picture."],
};
const RANGES = { glWaveFreq: [1, 30, 1, (v) => String(Math.round(v))] };

function setupGlitchUI({ prefix, $, get, changed, onCheck, before }) {
  const els = {}, id = (x) => prefix + x;
  for (const [key, [label, tip]] of Object.entries(SLIDERS)) {
    const host = $(prefix + "gsl-" + key), [min, max, step, fmt] = RANGES[key] || [0, 1, 0.01, pct];
    host.innerHTML = `<div class="row" title="${tip}"><span class="label" title="${tip} Double-click the name or the handle to reset.">${label}</span>${SLIDER_HTML}<span class="val"></span></div>`;
    const val = host.querySelector(".val");
    const reset = () => { get()[key] = Glitch.DEFAULTS[key]; sync(); changed(); };
    const input = makeSlider(host.querySelector(".slider"), min, max, step, (v) => { get()[key] = v; val.textContent = fmt(v); changed(); }, reset);
    onDoubleClick(host.querySelector(".label"), reset);
    onDoubleClick(val, reset);
    els[key] = { input, val, fmt };
  }
  onCheck($(id("GlOn")), (v) => { get().glOn = v; sync(); changed(); });
  $(id("GlSwap")).addEventListener("change", () => { get().glSwap = $(id("GlSwap")).value; changed(); });
  if (before) $(id("GlWhere")).addEventListener("change", () => { get().glWhere = $(id("GlWhere")).value; changed(); });
  $(id("GlRandom")).addEventListener("click", () => { Object.assign(get(), Glitch.randomize(), before ? { glWhere: get().glWhere } : {}); sync(); changed(); });
  $(id("GlSeed")).addEventListener("click", () => { get().glSeed = Math.floor(Math.random() * 99999) + 1; changed(); });
  $(id("GlClear")).addEventListener("click", () => { const s = get(); for (const k of Glitch.KEYS) if (k !== "glOn" && k !== "glSeed" && k !== "glWhere") s[k] = Glitch.DEFAULTS[k]; sync(); changed(); });
  function sync() {
    const s = get();
    for (const [k, el] of Object.entries(els)) { el.input.value = String(s[k]); el.val.textContent = el.fmt(s[k]); }
    const on = $(id("GlOn")); on.checked = !!s.glOn; if (on.syncChecked) on.syncChecked();
    for (const [x, k] of [["GlSwap", "glSwap"], ["GlWhere", "glWhere"]]) { const el = $(id(x)); if (!el) continue; el.value = s[k]; if (el.ddUpdate) el.ddUpdate(); }
    $(id("GlBody")).classList.toggle("hidden", !s.glOn);
    if (!before) $(id("GlWhereRow")).classList.toggle("hidden", true);
  }
  return { sync };
}
if (typeof module !== "undefined") module.exports = { setupGlitchUI };
