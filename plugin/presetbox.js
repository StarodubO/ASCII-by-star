// A preset box, shared by the tabs: a dropdown of built-in and saved presets (picking one applies it, Reset applies
// it again), a name field with Save, Delete (the button turns into "Sure?" first; a second click deletes), and
// Export / Import of the saved ones as a JSON file.
// o: ids {select, reset, name, save, del, exp, imp}, storeKey (localStorage), builtIns [{id, name, settings}],
//    builtInLabel, current() (settings to save), apply(settings), fresh(settings) (cleans imported ones),
//    fileName, fileTag (marks the JSON), onChange() (after the saved list changes), and from main.js
//    $, loadJSON, saveJSON, setSelect, status, errMsg, lfs, formats.
"use strict";

function makePresetBox(o) {
  const { $ } = o;
  let mine = o.loadJSON(o.storeKey, []);
  const store = () => o.saveJSON(o.storeKey, mine);
  const changed = () => { if (o.onChange) o.onChange(); };
  function build(selected) {
    let html = o.builtIns.length ? `<option value="" disabled>— ${o.builtInLabel} —</option>` : "";
    for (const p of o.builtIns) html += `<option value="b:${p.id}">${p.name}</option>`;
    if (mine.length) {
      html += '<option value="" disabled>— My presets —</option>';
      mine.forEach((p, i) => { html += `<option value="u:${i}">${String(p.name).replace(/</g, "&lt;")}</option>`; });
    }
    if (!o.builtIns.length && !mine.length) html = '<option value="" disabled>— No presets yet —</option>';
    $(o.ids.select).innerHTML = html;
    o.setSelect($(o.ids.select), selected || (o.builtIns.length ? "b:" + o.builtIns[0].id : mine.length ? "u:0" : ""));
  }
  function find(v) {
    if (v.startsWith("b:")) return o.builtIns.find((x) => x.id === v.slice(2)) || null;
    if (v.startsWith("u:")) return mine[Number(v.slice(2))] || null;
    return null;
  }
  function applyChosen() { const p = find($(o.ids.select).value); if (p) o.apply(p.settings); }
  function save() {
    const name = $(o.ids.name).value.trim();
    if (!name) return o.status("Type a preset name first.", true);
    const i = mine.findIndex((p) => p.name === name), rec = { name, settings: o.current() };
    if (i >= 0) mine[i] = rec; else mine.push(rec);
    store(); build("u:" + (i >= 0 ? i : mine.length - 1)); changed();
    o.status(`Saved preset “${name}”`);
  }
  let armed = null, armTimer = null;
  function disarm() { clearTimeout(armTimer); armed = null; const b = $(o.ids.del); b.textContent = "Delete"; b.classList.remove("danger"); }
  function del() {
    const v = $(o.ids.select).value;
    if (!v.startsWith("u:")) return o.status("Built-in presets can’t be deleted.", true);
    const p = mine[Number(v.slice(2))];
    if (!p) return;
    if (armed !== v) {
      disarm(); armed = v;
      const b = $(o.ids.del); b.textContent = "Sure?"; b.classList.add("danger");
      armTimer = setTimeout(disarm, 3000);
      return o.status(`Click “Sure?” to delete the preset “${p.name}”.`);
    }
    disarm();
    mine.splice(Number(v.slice(2)), 1);
    store(); build(); changed();
    o.status(`Deleted “${p.name}”.` + (o.undoHint ? " " + o.undoHint : ""));
  }
  async function exportAll() {
    try {
      const f = await o.lfs.getFileForSaving(o.fileName, { types: ["json"] });
      if (!f) return;
      await f.write(JSON.stringify({ [o.fileTag]: 1, presets: mine.length ? mine : [{ name: "Current", settings: o.current() }] }, null, 2), { format: o.formats.utf8 });
      o.status(`Saved ${f.name}`);
    } catch (e) { o.status(o.errMsg(e), true); }
  }
  async function importAll() {
    try {
      const f = await o.lfs.getFileForOpening({ types: ["json"] });
      if (!f) return;
      const data = JSON.parse(await f.read({ format: o.formats.utf8 }));
      let n = 0;
      for (const p of (data && data.presets) || []) if (p && p.name && p.settings) { mine.push({ name: String(p.name), settings: o.fresh(p.settings) }); n++; }
      store(); build(); changed();
      o.status(`Imported ${n} preset${n === 1 ? "" : "s"}`);
    } catch (e) { o.status("Couldn’t import: " + o.errMsg(e), true); }
  }
  $(o.ids.select).addEventListener("change", () => { disarm(); applyChosen(); });
  if (o.ids.reset) $(o.ids.reset).addEventListener("click", applyChosen);
  $(o.ids.save).addEventListener("click", save);
  $(o.ids.del).addEventListener("click", del);
  if (o.ids.exp) $(o.ids.exp).addEventListener("click", exportAll);
  if (o.ids.imp) $(o.ids.imp).addEventListener("click", importAll);
  build();
  return {
    build,
    list: () => mine, // the saved presets (undo keeps a copy)
    setList(list) { mine = list; store(); build(); },
  };
}

if (typeof module !== "undefined") module.exports = { makePresetBox };
