// A picker: a button showing the current choice that opens a panel below it with a search field and a list,
// filled a page at a time as it scrolls (long lists, like every installed font, stay quick). Shared by the ASCII
// tab's font chooser and the Text art tab's FIGlet fonts.
// o: ids {button, current, chev, panel, search, list}; label() (the button's text); items(q) → [{id, label, font?}]
//    matching the search text q, in the order to show (font: a CSS font-family to draw the label in);
//    selected() → the chosen id; onPick(id, item); none(q) (the note when nothing matches); onToggle(open).
"use strict";
const PAGE = 60;

function makePicker(o) {
  const $ = (id) => document.getElementById(id);
  const list = $(o.ids.list), search = $(o.ids.search);
  let open = false, matches = [], shown = 0, timer = null;
  function itemEl(it) {
    const d = document.createElement("div");
    d.className = "fontItem" + (it.id === o.selected() ? " sel" : "");
    d.setAttribute("data-id", it.id);
    if (it.font) d.style.fontFamily = it.font;
    d.textContent = it.label;
    return d;
  }
  function more() {
    const note = list.querySelector(".fontMore, .fontNote");
    if (note) list.removeChild(note);
    const next = matches.slice(shown, shown + PAGE);
    for (const it of next) list.appendChild(itemEl(it));
    shown += next.length;
    const n = document.createElement("div");
    if (shown < matches.length) { n.className = "fontMore"; n.textContent = `Scroll for more · ${matches.length - shown} left`; }
    else { n.className = "fontNote"; n.textContent = matches.length ? `${matches.length} found` : o.none(search.value.trim()); }
    list.appendChild(n);
  }
  function fill() {
    $(o.ids.current).textContent = o.label();
    if (!open) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    matches = o.items(search.value.trim().toLowerCase()); shown = 0;
    more();
    list.scrollTop = 0;
  }
  function toggle(v) {
    open = v;
    $(o.ids.panel).classList.toggle("hidden", !open);
    $(o.ids.chev).textContent = open ? "▴" : "▾";
    if (open) fill();
    if (o.onToggle) o.onToggle(open);
  }
  function checkScroll() { if (open && shown < matches.length && list.scrollTop + list.clientHeight >= list.scrollHeight - 60) more(); }
  $(o.ids.button).addEventListener("click", () => toggle(!open));
  list.addEventListener("scroll", checkScroll);
  setInterval(checkScroll, 200); // UXP may not fire scroll events
  list.addEventListener("click", (e) => {
    let n = e.target;
    if (n && n.className === "fontMore") return more();
    while (n && n !== list && !(n.getAttribute && n.getAttribute("data-id") !== null)) n = n.parentNode;
    if (!n || n === list) return;
    const id = n.getAttribute("data-id");
    search.value = "";
    toggle(false);
    o.onPick(id, matches.find((it) => it.id === id));
  });
  const refilter = () => { clearTimeout(timer); timer = setTimeout(fill, 60); };
  search.addEventListener("input", refilter);
  search.addEventListener("keyup", refilter);
  return { fill, open: toggle, isOpen: () => open, query: () => search.value.trim().toLowerCase() };
}

if (typeof module !== "undefined") module.exports = { makePicker };
