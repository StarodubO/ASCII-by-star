// Slider drawn from plain elements. Photoshop's native sliders on macOS take mouse-wheel events while the
// pointer is over them, so scrolling the settings would change values; this one ignores the wheel.
// Markup (built by the caller): .slider > .strack > (.sfill, .sthumb). Drag or click to set a value.
"use strict";

function makeSlider(el, min, max, step, onInput) {
  const track = el.querySelector(".strack"), fill = el.querySelector(".sfill"), thumb = el.querySelector(".sthumb");
  const dec = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  let value = min, drag = false, usePointer = false;
  const show = () => {
    const p = Math.max(0, Math.min(1, (value - min) / (max - min))) * 100;
    fill.style.width = p + "%";
    thumb.style.left = p + "%";
  };
  const fromX = (clientX) => {
    const r = track.getBoundingClientRect();
    if (!r || !r.width) return;
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const v = Math.max(min, Math.min(max, Number((Math.round((min + t * (max - min)) / step) * step).toFixed(dec))));
    if (v !== value) { value = v; show(); onInput(v); }
  };
  // pointer events where available, mouse events otherwise (UXP versions differ); moves are tracked on the
  // whole document so a drag keeps working when the pointer leaves the slider
  const down = (e, isPointer) => { if (isPointer) usePointer = true; else if (usePointer) return; drag = true; fromX(e.clientX); };
  const move = (e, isPointer) => { if (drag && (isPointer || !usePointer)) fromX(e.clientX); };
  const up = () => { drag = false; };
  el.addEventListener("pointerdown", (e) => down(e, true));
  el.addEventListener("mousedown", (e) => down(e, false));
  const root = typeof document !== "undefined" && typeof document.addEventListener === "function" ? document : el;
  root.addEventListener("pointermove", (e) => move(e, true));
  root.addEventListener("mousemove", (e) => move(e, false));
  root.addEventListener("pointerup", up);
  root.addEventListener("mouseup", up);
  show();
  return {
    get value() { return value; },
    set value(v) { value = Number(v); show(); },
  };
}

// Inner markup for a slider row's control.
const SLIDER_HTML = '<div class="slider"><div class="strack"><div class="sfill"></div><div class="sthumb"></div></div></div>';

if (typeof module !== "undefined") module.exports = { makeSlider, SLIDER_HTML };
