#!/bin/sh
set -eu

command -v codex >/dev/null 2>&1 || {
  echo "Codex CLI was not found on PATH." >&2
  exit 1
}

codex app-server --help >/dev/null

SCHEMA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/arkey-app-server-schema.XXXXXX")
cleanup() {
  find "$SCHEMA_DIR" -type f -delete 2>/dev/null || true
  find "$SCHEMA_DIR" -depth -type d -empty -delete 2>/dev/null || true
}
trap cleanup EXIT INT TERM

codex app-server generate-json-schema --experimental --out "$SCHEMA_DIR" >/dev/null
REQUEST_SCHEMA="$SCHEMA_DIR/ClientRequest.json"

for method in initialize account/read model/list thread/start thread/resume thread/list thread/fork turn/start turn/interrupt review/start; do
  grep -Fq "\"$method\"" "$REQUEST_SCHEMA" || {
    echo "Installed Codex schema is missing required method: $method" >&2
    exit 1
  }
done

if grep -Fq '"collaborationMode/list"' "$REQUEST_SCHEMA"; then
  echo "Codex App Server compatible: $(codex --version); optional Plan capability available."
else
  echo "Codex App Server core compatible: $(codex --version); optional Plan capability unavailable."
fi
