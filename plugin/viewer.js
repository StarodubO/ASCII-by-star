// Preview viewer shared by both tabs: a zoom slider (Fit to 400%), drag to move around, and in Fit a click
// zooms to 100% at that spot. The tab only supplies render(rect, z): document rect → RGB pixels at scale z.
// When zoomed in, the visible area is rendered first (quick), then the area around it (3 × 3 views) in the
// background, so dragging just slides an image that's already there. A new render is only needed when the
// view reaches the edge of what's rendered, or when refresh() says the settings changed.
// The preview's height is a share of the panel (drag the grip under it), and it can be hidden: then nothing
// is rendered until it's shown again. Both are remembered per tab.
"use strict";
const { imaging } = require("photoshop");
const { makeSlider, trackDrag, SLIDER_HTML } = require("./slider.js");

const MAX_ZOOM = 4; // 400%
const SIZE_MIN = 0.1, SIZE_MAX = 0.8, MIN_PX = 60; // preview height: share of the panel height

function load(key, d) { try { const v = JSON.parse(localStorage.getItem(key)); return v === null ? d : v; } catch (e) { return d; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* not saved */ } }

function createViewer({ wrap, img, msg, bar, grip, storeKey, render, docSize, onError, onLayout }) {
  let zoomT = Math.max(0, Math.min(1, Number(load(storeKey, 0)) || 0)); // slider position: 0 = Fit, 1 = 400%, logarithmic in between
  let sizeK = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Number(load(storeKey + ":size", 0.38)) || 0.38));
  let hidden = !!load(storeKey + ":hidden", false), panelH = 0, dirty = true;
  let centre = null; // document px at the middle of the view
  let shown = null; // what the image holds: {x, y, w, h} document px, z, gen
  let pending = null; // the same for an image that is still loading (the old one stays in place until then)
  let gen = 0, running = null, again = false;

  // ---------- geometry ----------
  const dpr = () => (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  function box() {
    let r = null;
    try { r = wrap.getBoundingClientRect(); } catch (e) { r = null; }
    return { w: (r && r.width) || wrap.offsetWidth || 300, h: (r && r.height) || wrap.offsetHeight || 200 };
  }
  // panel px per document px: Fit shows the whole document; 100% is one document px per screen pixel
  const fitK = (d, b) => Math.min(b.w / d.w, b.h / d.h);
  const maxK = (d, b) => Math.max(fitK(d, b), MAX_ZOOM / dpr());
  const scaleFor = (d, b) => fitK(d, b) * Math.pow(maxK(d, b) / fitK(d, b), zoomT);
  const zoomFor = (d, b, pct) => { const f = fitK(d, b), m = maxK(d, b), k = pct / dpr(); return m > f && k > f ? Math.min(1, Math.log(k / f) / Math.log(m / f)) : 0; };
  const renderZ = (k) => Math.min(1, k * dpr());
  const isFit = () => zoomT === 0;
  function clampCentre(d, b, k) {
    const hw = b.w / 2 / k, hh = b.h / 2 / k;
    centre.x = d.w <= 2 * hw ? d.w / 2 : Math.max(hw, Math.min(d.w - hw, centre.x));
    centre.y = d.h <= 2 * hh ? d.h / 2 : Math.max(hh, Math.min(d.h - hh, centre.y));
  }
  function clip(r, d) {
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(d.w, Math.ceil(r.x + r.w)), y1 = Math.min(d.h, Math.ceil(r.y + r.h));
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }
  function viewRect(d, b, k) {
    return clip({ x: centre.x - b.w / 2 / k, y: centre.y - b.h / 2 / k, w: b.w / k, h: b.h / k }, d);
  }
  const covers = (a, r) => a && r.x >= a.x && r.y >= a.y && r.x + r.w <= a.x + a.w && r.y + r.h <= a.y + a.h;

  // ---------- display ----------
  // Positions the rendered image so `centre` sits in the middle (dx, dy: a drag in progress).
  function place(dx, dy) {
    const d = docSize();
    if (!shown || !d) return;
    const b = box(), k = scaleFor(d, b);
    const left = b.w / 2 - (centre.x - shown.x) * k + (dx || 0), top = b.h / 2 - (centre.y - shown.y) * k + (dy || 0);
    img.style.width = shown.w * k + "px";
    img.style.height = shown.h * k + "px";
    img.style.left = left + "px";
    img.style.top = top + "px";
  }
  async function show(rect, z, myGen) {
    const res = await render(rect, z);
    if (!res || myGen !== gen) return false;
    const id = await imaging.createImageDataFromBuffer(res.rgb, { width: res.w, height: res.h, components: 3, chunky: true, colorProfile: "sRGB IEC61966-2.1", colorSpace: "RGB" });
    const b64 = await imaging.encodeImageData({ imageData: id, base64: true });
    id.dispose();
    if (myGen !== gen) return false;
    pending = Object.assign({}, rect, { z, gen: myGen });
    img.src = "data:image/jpeg;base64," + b64;
    img.classList.remove("hidden");
    msg.classList.add("hidden");
    return true;
  }
  img.addEventListener("load", () => { if (pending) { shown = pending; pending = null; place(drag && drag.moved ? drag.dx : 0, drag && drag.moved ? drag.dy : 0); } });
  async function run() {
    const myGen = gen, d = docSize();
    if (!d) return;
    const b = box(), k = scaleFor(d, b), z = renderZ(k);
    if (!centre) centre = { x: d.w / 2, y: d.h / 2 };
    clampCentre(d, b, k);
    const vr = viewRect(d, b, k);
    if (shown && shown.z === z && covers(shown, vr) && myGen === shown.gen) { place(); return; }
    if (!(await show(vr, z, myGen)) || (vr.w >= d.w && vr.h >= d.h)) return; // all of it is in view
    // then the surroundings, so dragging has something to show
    const around = clip({ x: vr.x - vr.w, y: vr.y - vr.h, w: vr.w * 3, h: vr.h * 3 }, d);
    if (around.w > vr.w || around.h > vr.h) await show(around, z, myGen);
  }
  async function pump() {
    if (running) { again = true; return running; }
    running = (async () => {
      do { again = false; try { await run(); } catch (e) { if (onError) onError(e); else console.error(e); } } while (again);
    })();
    try { await running; } finally { running = null; }
  }

  // ---------- controls ----------
  // Zooming scales the image already shown straight away; the sharper render follows once the slider rests
  // (none is needed while zooming within what's rendered at full resolution).
  let zTimer = null, slider = null, zval = null;
  function label() {
    const d = docSize();
    if (zval) zval.textContent = isFit() || !d ? "Fit" : Math.round(scaleFor(d, box()) * dpr() * 100) + "%";
  }
  function setZoom(t, at, settle) {
    zoomT = Math.max(0, Math.min(1, t));
    save(storeKey, zoomT);
    if (at) centre = at;
    const d = docSize();
    if (d && centre) clampCentre(d, box(), scaleFor(d, box()));
    if (slider && slider.value !== zoomT) slider.value = zoomT;
    label();
    place();
    clearTimeout(zTimer);
    if (settle) { zTimer = setTimeout(() => pump(), settle); return Promise.resolve(); }
    return pump();
  }
  let toggle = null;
  if (bar) {
    bar.innerHTML = `<span class="label zlabel" title="Double-click for Fit">Zoom</span>${SLIDER_HTML}<span class="val zval"></span><button class="zbtn ztoggle"></button>`;
    zval = bar.querySelector(".zval");
    slider = makeSlider(bar.querySelector(".slider"), 0, 1, 0.001, (t) => setZoom(t, null, 220));
    slider.value = zoomT;
    bar.querySelector(".zlabel").addEventListener("dblclick", () => setZoom(0));
    toggle = bar.querySelector(".ztoggle");
    toggle.addEventListener("click", () => setHidden(!hidden));
    label();
  }

  // ---------- size and visibility ----------
  const setShown = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
  // Sets the preview height for a panel `H` px tall (only writing styles that change).
  function layout(H) {
    panelH = H || panelH;
    setShown(wrap, !hidden); setShown(grip, !hidden);
    if (bar) {
      for (const el of bar.querySelectorAll(".zlabel, .slider, .zval")) setShown(el, !hidden);
      toggle.classList.toggle("grow", hidden);
      const t = hidden ? "Show preview" : "Hide";
      if (toggle.textContent !== t) { toggle.textContent = t; toggle.title = hidden ? "" : "Hide the preview (nothing is rendered while it's hidden)"; }
    }
    const px = Math.max(MIN_PX, Math.round(panelH * sizeK)) + "px";
    if (!hidden && wrap.style.height !== px) wrap.style.height = px;
  }
  function setHidden(h) {
    hidden = h;
    save(storeKey + ":hidden", hidden);
    layout();
    if (onLayout) onLayout();
    if (!hidden && dirty) pump();
  }
  if (grip) {
    let start = null;
    trackDrag(grip, {
      down: (e) => { if (!panelH) return false; start = { y: e.clientY, k: sizeK }; if (e.preventDefault) e.preventDefault(); },
      move: (e) => {
        sizeK = Math.max(SIZE_MIN, Math.min(SIZE_MAX, start.k + (e.clientY - start.y) / panelH));
        layout();
        if (onLayout) onLayout();
        place();
      },
      up: () => { save(storeKey + ":size", sizeK); pump(); }, // a bigger view may need more rendered around it
    });
  }

  let drag = null;
  const down = (e) => {
    if (!shown) return false;
    drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
    if (e.preventDefault) e.preventDefault();
  };
  const move = (e) => {
    drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
    if (Math.abs(drag.dx) + Math.abs(drag.dy) > 3) drag.moved = true;
    if (drag.moved) place(drag.dx, drag.dy);
  };
  const up = () => {
    const dr = drag, d = docSize();
    drag = null;
    if (!d || !shown) return;
    const b = box(), k = scaleFor(d, b);
    if (!dr.moved) { // a click: in Fit, zoom to 100% on that spot
      if (!isFit()) return;
      const r = img.getBoundingClientRect();
      if (!r || !r.width) return;
      const fx = (dr.x - r.left) / r.width, fy = (dr.y - r.top) / r.height;
      if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) setZoom(zoomFor(d, b, 1), { x: shown.x + fx * shown.w, y: shown.y + fy * shown.h });
      return;
    }
    // the image followed the pointer, so the centre moves the other way
    centre.x -= dr.dx / k; centre.y -= dr.dy / k;
    clampCentre(d, b, k);
    place();
    if (!covers(shown, viewRect(d, b, k))) pump(); // reached the edge of what's rendered
  };
  try { img.setAttribute("draggable", "false"); } catch (e) { /* not supported */ }
  img.addEventListener("dragstart", (e) => { if (e.preventDefault) e.preventDefault(); });
  trackDrag(wrap, { down, move, up });

  // Settings or the document changed: render again (what's on screen stays until the new image is ready).
  // While hidden, the render waits until the preview is shown.
  function refresh() { gen++; dirty = hidden; return hidden ? Promise.resolve() : pump(); }
  return {
    layout,
    get hidden() { return hidden; },
    refresh,
    // "fit", or a zoom such as "1" (100%) or "2" (200%)
    setMode(m, at) { const d = docSize(); return setZoom(m === "fit" || !d ? 0 : zoomFor(d, box(), Number(m)), at); },
    get zoom() { return zoomT; },
    setCentre(x, y) { centre = { x, y }; },
    showMessage(t) { gen++; shown = null; pending = null; msg.textContent = t; msg.classList.remove("hidden"); img.classList.add("hidden"); },
    relayout() { label(); place(); },
  };
}

if (typeof module !== "undefined") module.exports = { createViewer };
