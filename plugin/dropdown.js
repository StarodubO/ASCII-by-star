// Dropdowns drawn from plain elements. Photoshop's native dropdowns on macOS take mouse-wheel events while
// the pointer is over them, changing the value when you only meant to scroll the panel.
// Each <select> stays in the page, hidden, as the source of truth: code keeps reading and setting its value,
// filling its options and listening for "change". The drawn button shows the chosen option; clicking it opens
// the list in a panel below the row (scrollable on its own), and picking an item sets the <select>.
"use strict";

const dropdowns = [];
let openDd = null;

function enhanceSelect(sel, onLayout) {
  // "change" handlers are recorded so a pick can call them directly (UXP builds differ in dispatchEvent support)
  const handlers = [], addListener = sel.addEventListener.bind(sel);
  sel.addEventListener = (type, fn, opts) => { if (type === "change") handlers.push(fn); return addListener(type, fn, opts); };

  const dd = document.createElement("div"), btn = document.createElement("div"), text = document.createElement("span"), chev = document.createElement("span"), list = document.createElement("div");
  dd.className = "dd " + (sel.className || "");
  const style = sel.getAttribute && sel.getAttribute("style");
  if (style) dd.setAttribute("style", style);
  const tip = sel.getAttribute && sel.getAttribute("title");
  if (tip) dd.setAttribute("title", tip);
  btn.className = "ddBtn"; text.className = "ddText"; chev.className = "ddChev"; chev.textContent = "▾";
  list.className = "ddList hidden";
  btn.appendChild(text); btn.appendChild(chev); dd.appendChild(btn);
  sel.parentNode.insertBefore(dd, sel.nextSibling);
  // the list opens below the whole row, so the row's label stays where it is
  let row = dd.parentNode;
  while (row && !(row.classList && row.classList.contains("row"))) row = row.parentNode;
  const anchor = row || dd;
  anchor.parentNode.insertBefore(list, anchor.nextSibling);
  sel.classList.add("hidden");

  const options = () => Array.from(sel.options || []);
  const chosen = () => options().find((o) => !o.disabled && o.value === sel.value);
  let shown = null;
  const update = () => { const o = chosen(), t = o ? o.textContent : ""; if (t !== shown) { shown = t; text.textContent = t; } };
  const close = () => { if (openDd !== api) return; openDd = null; list.classList.add("hidden"); chev.textContent = "▾"; if (onLayout) onLayout(); };
  const open = () => {
    if (openDd && openDd !== api) openDd.close();
    while (list.firstChild) list.removeChild(list.firstChild);
    let selItem = null;
    for (const o of options()) {
      const it = document.createElement("div");
      it.textContent = o.textContent;
      if (o.disabled) it.className = "ddHead";
      else {
        it.className = "ddItem" + (o.value === sel.value ? " sel" : "");
        it.setAttribute("data-v", o.value);
        if (o.value === sel.value) selItem = it;
      }
      list.appendChild(it);
    }
    openDd = api;
    list.classList.remove("hidden");
    chev.textContent = "▴";
    if (onLayout) onLayout();
    if (selItem) setTimeout(() => { try { list.scrollTop = Math.max(0, selItem.offsetTop - list.offsetTop - 60); } catch (e) { /* no layout info */ } }, 0);
  };
  btn.addEventListener("click", () => (openDd === api ? close() : open()));
  list.addEventListener("click", (e) => {
    let n = e.target;
    while (n && n !== list && !(n.getAttribute && n.getAttribute("data-v") !== null)) n = n.parentNode;
    if (!n || n === list) return;
    const v = n.getAttribute("data-v");
    close();
    if (v === sel.value) return;
    for (const o of options()) o.selected = o.value === v;
    sel.value = v;
    update();
    for (const fn of handlers) { try { fn({ type: "change", target: sel, currentTarget: sel }); } catch (err) { console.error(err); } }
  });
  const api = { sel, dd, update, close, contains: (n) => { for (; n; n = n.parentNode) if (n === dd || n === list) return true; return false; } };
  sel.ddUpdate = update;
  update();
  return api;
}

// Replaces every <select> on the page. A select that can't be converted keeps its native look.
function enhanceAllSelects(onLayout) {
  document.querySelectorAll("select").forEach((sel) => {
    try { dropdowns.push(enhanceSelect(sel, onLayout)); } catch (e) { console.error("dropdown", sel.id, e); }
  });
  // clicking anywhere else closes an open list
  if (typeof document.addEventListener === "function") document.addEventListener("click", (e) => { if (openDd && !openDd.contains(e.target)) openDd.close(); });
  // code changes values and options directly; keep the buttons' text in step
  setInterval(() => { for (const d of dropdowns) d.update(); }, 250);
}

if (typeof module !== "undefined") module.exports = { enhanceAllSelects };
