// Text fields and checkboxes drawn from plain elements. On macOS Photoshop draws <input> and <textarea> as
// native controls laid over the panel; while the settings scroll they are moved after the page, so their
// values trail behind the rows they belong to.
// Text fields: the <input>/<textarea> stays as the source of truth (code reads and sets its value and listens
// to it) but is hidden; a plain box shows its value. Clicking the box swaps the real field in for typing, and
// leaving it (Enter, Esc, a click elsewhere) swaps the box back.
// Checkboxes: the <input> moves out of its <label>, hidden; a drawn box takes its place and a click on the label
// toggles the input and calls its "change" and "click" listeners directly (UXP builds differ in dispatchEvent).
"use strict";

const fields = [];
let typingField = null;

// Records el's listeners of the given types, so they can be called directly.
function recordListeners(el, types) {
  const handlers = [], addListener = el.addEventListener.bind(el);
  el.addEventListener = (type, fn, opts) => { if (types.includes(type)) handlers.push(fn); return addListener(type, fn, opts); };
  return (type) => { for (const fn of handlers.slice()) { try { fn({ type, target: el, currentTarget: el }); } catch (err) { console.error(err); } } };
}

function enhanceField(el) {
  const area = el.tagName === "TEXTAREA";
  const box = document.createElement("div");
  box.className = "tf" + (area ? " tfArea" : "") + (el.classList.contains("hex") || el.classList.contains("hexInk") ? " tfHex" : "");
  const style = el.getAttribute("style"), tip = el.getAttribute("title");
  if (style) box.setAttribute("style", style);
  if (tip) box.setAttribute("title", tip);
  el.parentNode.insertBefore(box, el);
  el.classList.add("hidden");
  let typing = false, shown = null, before = "", sawChange = false;
  el.addEventListener("change", () => { sawChange = true; });
  const fire = recordListeners(el, ["change"]);
  const update = () => {
    if (typing) return;
    const v = String(el.value || ""), t = v || el.getAttribute("placeholder") || "";
    if (t === shown) return;
    shown = t;
    box.textContent = t;
    box.classList.toggle("tfEmpty", !v);
  };
  const done = () => {
    if (!typing) return;
    typing = false;
    if (typingField === api) typingField = null;
    try { el.blur(); } catch (e) { /* not focused */ }
    el.classList.add("hidden");
    box.classList.remove("hidden");
    if (!sawChange && String(el.value) !== before) fire("change"); // left without a native "change"
    update();
  };
  box.addEventListener("click", () => {
    if (typingField && typingField !== api) typingField.done();
    typing = true; typingField = api; before = String(el.value); sawChange = false;
    box.classList.add("hidden");
    el.classList.remove("hidden");
    setTimeout(() => { try { el.focus(); if (!area && el.select) el.select(); } catch (e) { /* a click on the field focuses it */ } }, 0);
  });
  el.addEventListener("blur", () => setTimeout(done, 0)); // after any "change" that comes with leaving the field
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.key === "Enter" && !area)) { try { el.blur(); } catch (err) { /* done() below */ } setTimeout(done, 0); }
  });
  const api = { update, done, owns: (n) => n === el || n === box };
  update();
  return api;
}

function enhanceCheck(el) {
  const label = el.parentNode;
  if (!label || label.tagName !== "LABEL") return null;
  const fire = recordListeners(el, ["change", "click"]);
  const ck = document.createElement("span"), mark = document.createElement("span");
  ck.className = "ck"; mark.className = "ckMark"; mark.textContent = "✓";
  ck.appendChild(mark);
  label.insertBefore(ck, el);
  label.parentNode.insertBefore(el, label); // outside the label, so a click on it can't toggle the input as well
  el.classList.add("hidden");
  let shown = null;
  const update = () => {
    const on = !!el.checked, off = !!el.disabled, k = on + "|" + off;
    if (shown === k) return;
    shown = k;
    ck.classList.toggle("on", on);
    label.classList.toggle("ckOff", off);
  };
  label.addEventListener("click", () => {
    if (el.disabled) return;
    el.checked = !el.checked;
    update();
    fire("change");
  });
  el.ckUpdate = update;
  update();
  return { update, done() {}, owns: () => false };
}

// Replaces every text field and checkbox on the page. One that can't be converted keeps its native look.
// Must run before any listener is added to them.
function enhanceAllFields() {
  const inputs = Array.from(document.querySelectorAll("input"));
  for (const el of inputs.concat(Array.from(document.querySelectorAll("textarea")))) {
    const type = el.tagName === "TEXTAREA" ? "textarea" : String(el.getAttribute("type") || "text").toLowerCase();
    try {
      const f = type === "text" || type === "textarea" ? enhanceField(el) : type === "checkbox" ? enhanceCheck(el) : null;
      if (f) fields.push(f);
    } catch (e) { console.error("field", el.id, e); }
  }
  // a click anywhere else ends typing, in case the field gets no "blur"
  if (typeof document.addEventListener === "function") document.addEventListener("click", (e) => { if (typingField && !typingField.owns(e.target)) typingField.done(); });
  // code sets values directly; keep the drawn ones in step
  setInterval(refreshFields, 250);
}
function refreshFields() { for (const f of fields) f.update(); }

if (typeof module !== "undefined") module.exports = { enhanceAllFields, refreshFields };
