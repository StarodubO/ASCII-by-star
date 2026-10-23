#!/bin/sh
# Builds "ASCII by Star.ccx" from plugin/ and (with --install) installs it into Photoshop via Adobe's installer.
# The work is done by tools/package.js, which also runs on Windows: node tools/package.js [--install]
exec node "$(dirname "$0")/package.js" "$@"
