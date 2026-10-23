// Edit symbols in Photoshop (TEST=edit node tools/build_test.js): a Photoshop marquee selecting cells and Apply, apply
// and text output with edits, and the live smart object picking up an edit.
const M = (fn) => core.executeAsModal(fn, { commandName: "t" });
baseAtlas = atlas; atlas.id = "builtin"; // as init() would
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await wait(50); return cond(); };
const marquee = (d, l, t, r, b) => M(() => action.batchPlay([{ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _obj: "rectangle", top: { _unit: "pixelsUnit", _value: t }, left: { _unit: "pixelsUnit", _value: l }, bottom: { _unit: "pixelsUnit", _value: b }, right: { _unit: "pixelsUnit", _value: r } } }], {}));
const deselect = () => M(() => action.batchPlay([{ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" } }], {}));
let doc;
await step("create doc (144 ppi, so points and pixels differ)", async () => {
  doc = await M(() => app.documents.add({ width: 600, height: 300, resolution: 144, mode: "RGBColorMode", depth: 8, fill: "white" }));
  const W = doc.width, H = doc.height, buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, v = (255 * x) / W; buf[o] = buf[o + 1] = buf[o + 2] = v; buf[o + 3] = 255; }
  await M(async () => { const id = await makeImageData(buf, W, H, false, doc.colorProfileName); await imaging.putPixels({ documentID: doc.id, layerID: doc.layers[0].id, imageData: id }); id.dispose(); });
  return [W, H];
});
await step("selection → write edit", async () => {
  S = freshSettings({ charset: "standard", size: 20, fg: "#000000", bg: "#ffffff" }); src = null; editing = null; __el("quality").value = "1";
  tool.op = "write"; tool.text = "STAR"; tool.useColor = true; tool.color = "#ff0000";
  await marquee(doc, 120, 60, 360, 130);
  await editFromSelection();
  applySelection();
  await deselect();
  const e = S.cellEdits[0], { cs, grid } = await outputGrid(), lines = Engine.gridLines(grid, cs);
  return { rect: e && e.rect, expect: [0.2, 0.2, 0.6, 0.433333], rows: lines.filter((l) => /STAR|TARS|ARST|RSTA/.test(l)).length, html: /color:#ff0000/.test(Engine.toHTML(grid, cs, S)), status: __el("status").textContent };
});
await step("apply with edits: red pixels where the edit is", async () => {
  await applyRaster(false);
  const top = doc.layers[0], r = await M(() => imaging.getPixels({ documentID: doc.id, layerID: top.id, sourceBounds: { left: 120, top: 60, right: 360, bottom: 130 } }));
  const px = await toRGBA8(r.imageData); r.imageData.dispose();
  let red = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] < 60 && px[i + 3] > 128) red++;
  return { layer: top.name, redPixels: red };
});
await step("preset keeps edits, presets don't store them", async () => {
  applyPreset("b:classic");
  const kept = S.cellEdits.length;
  __el("presetName").value = "edit test"; savePreset();
  const saved = userPresets[userPresets.length - 1].settings.cellEdits.length;
  userPresets.pop(); saveJSON("gf:userPresets", userPresets);
  return { kept, saved };
});
await step("live smart object follows an edit", async () => {
  S = freshSettings({ charset: "standard", size: 20, fg: "#000000", bg: "#ffffff" }); src = null; editing = null;
  await toggleLive();
  await until(() => !liveRunning && !busy, 15000);
  const psb = app.activeDocument;
  await marquee(psb, 0, 0, psb.width, psb.height / 2);
  tool.op = "erase";
  await editFromSelection();
  applySelection();
  await deselect();
  await renderPreview(); // as the panel does after an edit; it schedules the live update
  await until(() => liveRunning, 3000); await until(() => !liveRunning, 15000);
  const r = await M(() => imaging.getPixels({ documentID: psb.id, layerID: live.layerId, sourceBounds: { left: 0, top: 0, right: psb.width, bottom: Math.floor(psb.height / 2) - 25 } }));
  const px = await toRGBA8(r.imageData); r.imageData.dispose();
  let ink = 0; for (let i = 0; i < px.length; i += 4) if (px[i] < 100 && px[i + 3] > 128) ink++;
  const r2 = await M(() => imaging.getPixels({ documentID: psb.id, layerID: live.layerId, sourceBounds: { left: 0, top: Math.ceil(psb.height / 2) + 25, right: psb.width, bottom: psb.height } }));
  const px2 = await toRGBA8(r2.imageData); r2.imageData.dispose();
  let ink2 = 0; for (let i = 0; i < px2.length; i += 4) if (px2[i] < 100 && px2[i + 3] > 128) ink2++;
  const edits = S.cellEdits.map((e) => e.op + " " + e.rect.join(","));
  await closeLive();
  return { edits, darkPixelsInErasedHalf: ink, darkPixelsInOtherHalf: ink2, status: __el("status").textContent };
});
await step("close test doc", async () => M(() => doc.closeWithoutSaving()));
