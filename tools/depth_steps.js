const docsToClose = [];
for (const cfg of [{ depth: 16 }, { depth: 32 }, { mode: "grayscaleMode", depth: 8 }, { mode: "grayscaleMode", depth: 16 }]) {
  await step("fresh doc " + JSON.stringify(cfg), async () => {
    const d = await core.executeAsModal(() => app.documents.add(Object.assign({ width: 400, height: 300, resolution: 72, mode: "RGBColorMode" }, cfg)), { commandName: "t" });
    docsToClose.push(d);
    S = freshSettings(PRESETS.find((p) => p.id === "neon").settings); src = null;
    await applyRaster(false);
    return [String(d.mode), String(d.bitsPerChannel), d.layers.map((l) => l.name), __el("status").textContent];
  });
}
await step("read back 16-bit layer", async () => {
  const d = docsToClose[0];
  const r = await core.executeAsModal(() => imaging.getPixels({ documentID: d.id, layerID: d.layers[0].id, sourceBounds: { left: 0, top: 0, right: 2, bottom: 1 } }), { commandName: "t" });
  const px = Array.from(await r.imageData.getData({ chunky: true })); const cs = r.imageData.componentSize; r.imageData.dispose();
  return { componentSize: cs, px };
});
for (const d of docsToClose) await step("close " + d.title, async () => core.executeAsModal(() => d.closeWithoutSaving(), { commandName: "t" }));
