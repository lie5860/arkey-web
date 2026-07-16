#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PACKAGE="$ROOT/apps/ArkeyMac"
APP="$ROOT/build/Arkey.app"
npm --prefix "$ROOT" run build
BIN_DIR=$(swift build --package-path "$PACKAGE" -c release --show-bin-path)

swift build --package-path "$PACKAGE" -c release
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/ArkeyMac" "$APP/Contents/MacOS/ArkeyMac"
RESOURCE_BUNDLE="$BIN_DIR/ArkeyMac_ArkeyMac.bundle"
if [ ! -d "$RESOURCE_BUNDLE" ]; then
    echo "Missing Swift package resource bundle: $RESOURCE_BUNDLE" >&2
    exit 1
fi
cp -R "$RESOURCE_BUNDLE" "$APP/Contents/Resources/"
cp "$PACKAGE/Resources/Info.plist" "$APP/Contents/Info.plist"
cp "$PACKAGE/Resources/Arkey.icns" "$APP/Contents/Resources/Arkey.icns"
cp "$ROOT/profiles/keychron-q6-pro-ansi.json" "$APP/Contents/Resources/keychron-q6-pro-ansi.json"
if [ -f "$ROOT/profiles/effects-v1.json" ]; then
    cp "$ROOT/profiles/effects-v1.json" "$APP/Contents/Resources/effects-v1.json"
fi
mkdir -p "$APP/Contents/Resources/ArkeyRuntime"
mkdir -p "$APP/Contents/Resources/ArkeyRuntime/dist"
cp -R "$ROOT/dist/src" "$APP/Contents/Resources/ArkeyRuntime/dist/src"
cp -R "$ROOT/profiles" "$APP/Contents/Resources/ArkeyRuntime/profiles"
mkdir -p "$APP/Contents/Resources/ArkeyRuntime/docs"
for document in ARCHITECTURE.md CODEX_MICRO_LAB.md FIRMWARE.md PORTING_QMK.md; do
    cp "$ROOT/docs/$document" "$APP/Contents/Resources/ArkeyRuntime/docs/$document"
done
mkdir -p "$APP/Contents/Resources/ArkeyRuntime/scripts"
for script in codex-micro-lab-bindings.mjs codex-micro-lab-config.mjs; do
    cp "$ROOT/scripts/$script" "$APP/Contents/Resources/ArkeyRuntime/scripts/$script"
done
cp "$ROOT/README.md" "$ROOT/LICENSE" "$ROOT/THIRD_PARTY_NOTICES.md" "$ROOT/TRADEMARKS.md" "$APP/Contents/Resources/ArkeyRuntime/"
cp -R "$ROOT/LICENSES" "$APP/Contents/Resources/ArkeyRuntime/LICENSES"
mkdir -p "$APP/Contents/Resources/ArkeyRuntime/node_modules"
for module in node-hid node-addon-api pkg-prebuilds; do
    cp -R "$ROOT/node_modules/$module" "$APP/Contents/Resources/ArkeyRuntime/node_modules/$module"
done
cp "$ROOT/package.json" "$APP/Contents/Resources/ArkeyRuntime/package.json"
codesign --deep --force --sign - "$APP"
echo "Built: $APP"
