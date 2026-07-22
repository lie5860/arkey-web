#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SOURCE="$ROOT/firmware/esp32s3-codex-micro-lab/main"
TEST="$ROOT/firmware/esp32s3-codex-micro-lab/test/protocol_test.c"
OUTPUT="$ROOT/build/esp32s3-codex-micro-protocol-test"

mkdir -p "$(dirname "$OUTPUT")"
cc -std=c11 -Wall -Wextra -Werror -I "$SOURCE" "$SOURCE/micro_protocol.c" "$TEST" -o "$OUTPUT"
"$OUTPUT"
