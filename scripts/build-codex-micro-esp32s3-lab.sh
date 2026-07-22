#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PROJECT="$ROOT/firmware/esp32s3-codex-micro-lab"
BUILD_DIR="$ROOT/build/esp32s3-codex-micro-lab"

acknowledged=false
for argument in "$@"; do
    case "$argument" in
        --acknowledge-device-identity-test) acknowledged=true ;;
        *) echo "Unknown argument: $argument" >&2; exit 2 ;;
    esac
done

if [ "$acknowledged" != true ]; then
    echo "This laboratory build contains a Codex Micro compatibility USB identity." >&2
    echo "Review docs/FIRMWARE.md, then re-run with --acknowledge-device-identity-test." >&2
    exit 2
fi

if [ -z "${IDF_PATH:-}" ] || [ ! -x "$IDF_PATH/tools/idf.py" ]; then
    echo "ESP-IDF 6.0.1 is required. Export IDF_PATH after activating that toolchain." >&2
    exit 2
fi

idf_version=$($IDF_PATH/tools/idf.py --version 2>/dev/null || true)
case "$idf_version" in
    *"v6.0.1"*|*"6.0.1"*) ;;
    *) echo "Expected ESP-IDF 6.0.1, got: ${idf_version:-unknown}" >&2; exit 2 ;;
esac

"$IDF_PATH/tools/idf.py" -C "$PROJECT" -B "$BUILD_DIR" set-target esp32s3 build

echo "Built: $BUILD_DIR"
echo "Compile-only laboratory build complete. No board was opened and no firmware was written."
