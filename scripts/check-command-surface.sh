#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

cd "$ROOT"
npm run check
swift test --package-path "$ROOT/apps/ArkeyMac"

if [ -n "${QMK_HOME:-}" ]; then
  "$ROOT/scripts/build-q6-pro.sh"
else
  echo "QMK build skipped: set QMK_HOME to the pinned Keychron QMK tree to include firmware compilation."
fi

if [ -f "$ROOT/build/arkey-q6-pro-ansi-v0.1.0.bin" ]; then
  shasum -a 256 "$ROOT/build/arkey-q6-pro-ansi-v0.1.0.bin"
fi

"$ROOT/scripts/build-macos-app.sh"
codesign --verify --deep --strict --verbose=2 "$ROOT/build/Arkey.app"

echo "Command Surface preflight complete. No firmware was flashed."
