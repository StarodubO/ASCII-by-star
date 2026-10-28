// Preview viewer shared by both tabs: a zoom slider (Fit to 400%), drag to move around, and in Fit a click
// zooms to 100% at that spot. The tab only supplies render(rect, z): document rect → RGB pixels at scale z.
// When zoomed in, the visible area is rendered first (quick), then the area around it (3 × 3 views) in the
// background, so dragging just slides an image that's already there. A new render is only needed when the
// view reaches the edge of what's rendered, or when refresh() says the settings changed.
// The preview's height is a share of the panel (drag the grip under it), and it can be hidden: then nothing
// is rendered until it's shown again. Both are remembered per tab.
// setEditor(ed) turns the preview into a canvas: a click or drag calls ed.down/move/up with document px
// (Option/Alt-drag still moves the view) and ed.hover follows the pointer. setMarks(rects) outlines document
// rects (cells; {cls} adds a class) over the image. head: the "▾ Preview" line above it, which shows and hides it. With onEditToggle, the zoom bar gets an Edit button that calls it (editTitle: its tooltip).
"use strict";
const { imaging } = require("photoshop");
const { makeSlider, trackDrag, onDoubleClick, SLIDER_HTML } = require("./slider.js");

const MAX_ZOOM = 4; // 400%
const SIZE_MIN = 0.1, SIZE_MAX = 0.8, MIN_PX = 60; // preview height: share of the panel height

function load(key, d) { try { const v = JSON.parse(localStorage.getItem(key)); return v === null ? d : v; } catch (e) { return d; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* not saved */ } }

function createViewer({ wrap, img, msg, bar, grip, head, storeKey, render, docSize, onError, onLayout, onEditToggle, editTitle, onFitDrag, bleed }) {
  let zoomT = Math.max(0, Math.min(1, Number(load(storeKey, 0)) || 0)); // slider position: 0 = Fit, 1 = 400%, logarithmic in between
  let sizeK = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Number(load(storeKey + ":size", 0.38)) || 0.38));
  let hidden = !!load(storeKey + ":hidden", false), panelH = 0, dirty = true;
  let centre = null; // document px at the middle of the view
  let shown = null; // what the image holds: {x, y, w, h} document px, z, gen
  let pending = null; // the same for an image that is still loading (the old one stays in place until then)
  let gen = 0, running = null, again = false;
  let editor = null, marks = [], placed = null; // placed: where place() put the image {left, top, k}
  const markEls = [];

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
    placed = { left, top, k };
    drawMarks();
  }
  function drawMarks() {
    while (markEls.length < marks.length) {
      const el = document.createElement("div");
      el.className = "vmark";
      wrap.appendChild(el);
      markEls.push(el);
    }
    markEls.forEach((el, i) => {
      const m = marks[i];
      if (!m || !shown || !placed) { if (el.style.display !== "none") el.style.display = "none"; return; }
      const { left, top, k } = placed;
      el.style.display = "block";
      const cls = "vmark" + (m.cls ? " " + m.cls : "");
      if (el.className !== cls) el.className = cls;
      el.style.left = left + (m.x - shown.x) * k + "px";
      el.style.top = top + (m.y - shown.y) * k + "px";
      el.style.width = Math.max(2, m.w * k) + "px";
      el.style.height = Math.max(2, m.h * k) + "px";
    });
  }
  // document px under a pointer position, or null when the image isn't there
  function toDoc(cx, cy) {
    if (!shown) return null;
    let r = null;
    try { r = img.getBoundingClientRect(); } catch (e) { r = null; }
    if (!r || !r.width || !r.height) return null;
    return { x: shown.x + ((cx - r.left) / r.width) * shown.w, y: shown.y + ((cy - r.top) / r.height) * shown.h };
  }
  async function show(rect, z, myGen) {
    const res = await render(rect, z);
    if (!res || myGen !== gen) return false;
    const url = await rgbToDataURL(res.rgb, res.w, res.h);
    if (myGen !== gen) return false;
    pending = Object.assign({}, rect, { z, gen: myGen });
    img.src = url;
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
    if (!(await show(vr, z, myGen))) return;
    if (bleed && isFit()) { // then past the edges (the tab draws there), so a drag in Fit shows what's beyond
      const bx = Math.round(d.w * bleed), by = Math.round(d.h * bleed);
      await show({ x: -bx, y: -by, w: d.w + 2 * bx, h: d.h + 2 * by }, z, myGen);
      return;
    }
    if (vr.w >= d.w && vr.h >= d.h) return; // all of it is in view
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
  let editBtn = null;
  if (head) head.addEventListener("click", () => setHidden(!hidden));
  function showEditBtn() {
    if (!editBtn) return;
    const t = editor ? "Done" : "Edit";
    if (editBtn.textContent !== t) editBtn.textContent = t;
    editBtn.classList.toggle("primary", !!editor);
    editBtn.title = editor ? "Stop editing; clicks and drags move and zoom the preview again" : editTitle || "Edit symbols: click or drag on the preview to change characters";
  }
  if (bar) {
    bar.innerHTML = `<span class="label zlabel" title="Double-click for Fit">Zoom</span>${SLIDER_HTML}<span class="val zval"></span>${onEditToggle ? '<button class="zbtn zedit"></button>' : ""}`;
    zval = bar.querySelector(".zval");
    slider = makeSlider(bar.querySelector(".slider"), 0, 1, 0.001, (t) => setZoom(t, null, 220), () => setZoom(0));
    slider.value = zoomT;
    onDoubleClick(bar.querySelector(".zlabel"), () => setZoom(0));
    editBtn = bar.querySelector(".zedit");
    if (editBtn) { editBtn.addEventListener("click", () => onEditToggle()); showEditBtn(); }
    label();
  }

  // ---------- size and visibility ----------
  const setShown = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
  // Sets the preview height for a panel `H` px tall (only writing styles that change).
  function layout(H) {
    panelH = H || panelH;
    setShown(wrap, !hidden); setShown(grip, !hidden);
    if (bar) {
      setShown(bar, !hidden);
    }
    if (head) {
      const chev = head.querySelector(".chev"), t = hidden ? "▸" : "▾";
      if (chev.textContent !== t) { chev.textContent = t; head.title = hidden ? "Show the preview" : "Hide the preview (nothing is rendered while it's hidden)"; }
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
    if (editor && !e.altKey) { // edit: the press and every move go to the editor
      const p = toDoc(e.clientX, e.clientY);
      if (!p) return false;
      drag = { edit: true };
      if (e.preventDefault) e.preventDefault();
      editor.down(p, e);
      return;
    }
    drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
    if (e.preventDefault) e.preventDefault();
  };
  const move = (e) => {
    if (drag.edit) { const p = toDoc(e.clientX, e.clientY); if (p) editor.move(p, e); return; }
    drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
    if (Math.abs(drag.dx) + Math.abs(drag.dy) > 3) drag.moved = true;
    if (drag.moved) place(drag.dx, drag.dy);
  };
  const up = () => {
    const dr = drag, d = docSize();
    drag = null;
    if (dr.edit) { if (editor) editor.up(); return; }
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
    // in Fit a tab may take the drag (Map: moves the area); the image stays where it was dropped until the new render
    if (isFit() && onFitDrag && onFitDrag(-dr.dx / k, -dr.dy / k)) return;
    // the image followed the pointer, so the centre moves the other way
    centre.x -= dr.dx / k; centre.y -= dr.dy / k;
    clampCentre(d, b, k);
    place();
    if (!covers(shown, viewRect(d, b, k))) pump(); // reached the edge of what's rendered
  };
  try { img.setAttribute("draggable", "false"); } catch (e) { /* not supported */ }
  img.addEventListener("dragstart", (e) => { if (e.preventDefault) e.preventDefault(); });
  trackDrag(wrap, { down, move, up });
  // Wheel and pinch zoom around the pointer, when Photoshop passes those events to the panel (it doesn't always:
  // UXP may keep them). A macOS trackpad pinch arrives as a wheel event with ctrlKey, or as gesture events.
  function zoomAround(t, cx, cy) {
    const d = docSize(), at = toDoc(cx, cy);
    if (!d || !centre || hidden) return;
    const b = box(), kOld = scaleFor(d, b), old = zoomT;
    zoomT = Math.max(0, Math.min(1, t));
    const kNew = scaleFor(d, b);
    zoomT = old;
    const c = at ? { x: at.x + ((centre.x - at.x) * kOld) / kNew, y: at.y + ((centre.y - at.y) * kOld) / kNew } : null; // the point under the pointer stays put
    setZoom(t, c, 220);
  }
  const onWheel = (e) => {
    const dy = e.deltaY !== undefined ? e.deltaY : -(e.wheelDelta || 0);
    if (!dy || !shown) return;
    if (e.preventDefault) e.preventDefault();
    zoomAround(zoomT + (e.ctrlKey ? -dy * 0.01 : -Math.sign(dy) * 0.05), e.clientX, e.clientY);
  };
  wrap.addEventListener("wheel", onWheel);
  wrap.addEventListener("mousewheel", (e) => { if (e.deltaY === undefined) onWheel(e); });
  let pinchFrom = null;
  wrap.addEventListener("gesturestart", (e) => { pinchFrom = zoomT; if (e.preventDefault) e.preventDefault(); });
  wrap.addEventListener("gesturechange", (e) => { if (pinchFrom === null || !e.scale) return; if (e.preventDefault) e.preventDefault(); zoomAround(pinchFrom + Math.log(e.scale) * 0.6, e.clientX, e.clientY); });
  wrap.addEventListener("gestureend", () => { pinchFrom = null; });
  const hover = (e) => { if (editor && editor.hover && !drag) editor.hover(e ? toDoc(e.clientX, e.clientY) : null); };
  for (const t of ["pointermove", "mousemove"]) wrap.addEventListener(t, hover);
  for (const t of ["pointerleave", "mouseleave"]) wrap.addEventListener(t, () => hover(null));

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
    showMessage(t) { gen++; shown = null; pending = null; msg.textContent = t; msg.classList.remove("hidden"); img.classList.add("hidden"); drawMarks(); },
    relayout() { label(); place(); },
    setEditor(ed) { editor = ed || null; img.style.cursor = editor ? "crosshair" : ""; showEditBtn(); },
    setMarks(rects) { marks = rects || []; drawMarks(); },
  };
}

// RGB pixels (w × h × 3) as a JPEG data URL for an <img> (previews, the Text art tab's font list).
async function rgbToDataURL(rgb, w, h) {
  const id = await imaging.createImageDataFromBuffer(rgb, { width: w, height: h, components: 3, chunky: true, colorProfile: "sRGB IEC61966-2.1", colorSpace: "RGB" });
  try { return "data:image/jpeg;base64," + (await imaging.encodeImageData({ imageData: id, base64: true })); }
  finally { id.dispose(); }
}

if (typeof module !== "undefined") module.exports = { createViewer, rgbToDataURL };
