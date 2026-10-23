// Builds "ASCII by Star.ccx" from plugin/ and (with --install) installs it into Photoshop via Adobe's installer.
// Works on macOS and Windows: `node tools/package.js [--install]` (tools/package.sh runs this).
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib"), { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, ".."), PLUGIN = path.join(ROOT, "plugin"), OUT = path.join(ROOT, "ASCII by Star.ccx");
const FILES = ["manifest.json", "index.html", "main.js", "engine.js", "ink.js", "inkui.js", "slider.js", "dropdown.js", "viewer.js", "pixels.js", "charsets.js", "presets.js", "atlas.bin", "atlas.json", "icons"];

// ---------- zip (deflate, no external tools) ----------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function dosTime(d) { return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }
function zip(entries) { // entries: [{name, data (Buffer) | null for a folder, mtime}]
  const parts = [], central = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8"), dir = e.data === null, raw = dir ? Buffer.alloc(0) : e.data;
    const packed = dir ? raw : zlib.deflateRawSync(raw, { level: 9 }), method = dir ? 0 : 8, crc = crc32(raw), t = dosTime(e.mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(t.time, 10); local.writeUInt16LE(t.date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(t.time, 12); cen.writeUInt16LE(t.date, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(dir ? 0x10 : 0, 38); cen.writeUInt32LE(off, 42);
    parts.push(local, name, packed); central.push(cen, name);
    off += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
function collect(rel, list) {
  const abs = path.join(PLUGIN, rel), st = fs.statSync(abs);
  if (!st.isDirectory()) return list.push({ name: rel, data: fs.readFileSync(abs), mtime: st.mtime });
  list.push({ name: rel + "/", data: null, mtime: st.mtime });
  for (const f of fs.readdirSync(abs).sort()) if (!f.startsWith(".")) collect(rel + "/" + f, list);
}

const entries = [];
for (const f of FILES) collect(f, entries);
fs.writeFileSync(OUT, zip(entries));
console.log(`Built ${path.basename(OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);

// ---------- install ----------
if (process.argv.includes("--install")) {
  const UPIA = process.platform === "win32"
    ? path.join(process.env["CommonProgramFiles"] || "C:\\Program Files\\Common Files", "Adobe", "Adobe Desktop Common", "RemoteComponents", "UPI", "UnifiedPluginInstallerAgent", "UnifiedPluginInstallerAgent.exe")
    : "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent";
  if (!fs.existsSync(UPIA)) { console.error("Adobe's plugin installer wasn't found at " + UPIA + ". Is Creative Cloud installed? Double-click the .ccx instead."); process.exit(1); }
  // remove every installed copy first: the installer otherwise keeps old versions enabled side by side
  for (let i = 0; i < 8; i++) if (spawnSync(UPIA, ["--remove", "ASCII by Star"], { stdio: "ignore" }).status !== 0) break;
  const r = spawnSync(UPIA, ["--install", OUT], { encoding: "utf8" });
  const lines = String(r.stdout || r.stderr || "").trim().split(/\r?\n/);
  if (lines[0]) console.log(lines[lines.length - 1]);
  if (r.status !== 0) process.exit(r.status || 1);
  // On Windows the agent can exit 0 without installing anything. Check Photoshop's plugin list, and if the new
  // version isn't there, hand the .ccx to Creative Cloud (it asks you to confirm, then installs and reloads it).
  const version = JSON.parse(fs.readFileSync(path.join(PLUGIN, "manifest.json"), "utf8")).version;
  const info = path.join(process.env.APPDATA || "", "Adobe", "UXP", "PluginsInfo", "v1", "PS.json");
  const registered = () => fs.existsSync(info) && fs.readFileSync(info, "utf8").includes(`com.ostap.asciibystar_${version}`);
  if (process.platform === "win32" && !registered()) {
    spawnSync("cmd", ["/c", "start", "", OUT], { stdio: "ignore" });
    console.log(`The installer didn't register ${version}; opened the .ccx in Creative Cloud instead. Confirm there (Continue, OK).`);
  } else console.log("Restart Photoshop to load the new version.");
}
