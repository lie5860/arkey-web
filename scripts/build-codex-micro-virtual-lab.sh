#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
PACKAGE="$ROOT/apps/CodexMicroVirtualLab"
PROJECT="$PACKAGE/CodexMicroVirtualLab.xcodeproj"
OUTPUT_DIR="$ROOT/build/CodexMicroVirtualLabProduct"

acknowledged=false
allow_updates=false
for argument in "$@"; do
    case "$argument" in
        --acknowledge-device-identity-test) acknowledged=true ;;
        --allow-provisioning-updates) allow_updates=true ;;
        *) echo "Unknown argument: $argument" >&2; exit 2 ;;
    esac
done

if [ "$acknowledged" != true ]; then
    echo "This laboratory build contains a virtual Codex Micro compatibility identity." >&2
    echo "Re-run with --acknowledge-device-identity-test after reviewing docs/CODEX_MICRO_LAB.md." >&2
    exit 2
fi

if [ -z "${ARKY_DEVELOPMENT_TEAM:-}" ] || [ -z "${ARKY_BUNDLE_IDENTIFIER:-}" ]; then
    echo "Set ARKY_DEVELOPMENT_TEAM and an explicit ARKY_BUNDLE_IDENTIFIER." >&2
    echo "The selected App ID must already be approved for HID Virtual Device." >&2
    exit 2
fi

set -- xcodebuild \
    -project "$PROJECT" \
    -scheme CodexMicroVirtualLab \
    -configuration Release \
    -destination "platform=macOS,arch=$(uname -m)" \
    DEVELOPMENT_TEAM="$ARKY_DEVELOPMENT_TEAM" \
    PRODUCT_BUNDLE_IDENTIFIER="$ARKY_BUNDLE_IDENTIFIER" \
    CONFIGURATION_BUILD_DIR="$OUTPUT_DIR"

if [ "$allow_updates" = true ]; then
    set -- "$@" -allowProvisioningUpdates -allowProvisioningDeviceRegistration
fi

"$@" build

echo "Built and provisioned: $OUTPUT_DIR/CodexMicroVirtualLab.app"
echo "This script did not start the virtual device and did not write firmware."
