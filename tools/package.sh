#!/bin/zsh
# Builds "ASCII by Star.ccx" from plugin/ and (with --install) installs it into Photoshop via Adobe's installer.
set -e
cd "$(dirname "$0")/.."
OUT="ASCII by Star.ccx"
rm -f "$OUT"
(cd plugin && zip -qr -X "../$OUT" manifest.json index.html main.js engine.js charsets.js presets.js atlas.bin atlas.json icons)
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
if [[ "$1" == "--install" ]]; then
  UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"
  # remove every installed copy first: the installer otherwise keeps old versions enabled side by side
  for i in 1 2 3 4 5 6 7 8; do "$UPIA" --remove "ASCII by Star" >/dev/null 2>&1 || break; done
  "$UPIA" --install "$PWD/$OUT" | tail -1
  echo "Restart Photoshop to load the new version."
fi
