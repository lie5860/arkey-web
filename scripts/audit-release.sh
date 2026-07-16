#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Release audit skipped until the clean staging repository is initialized."
  exit 0
}

tracked=$(git ls-files)
printf '%s\n' "$tracked" | grep -E '(^|/)(node_modules|dist|build|\.build|research)(/|$)|(^|/)\.DS_Store$|(^|/).*(_RESEARCH|_REPORT).*\.md$|(^|/)(AGENT_HANDOFF|PREFLIGHT-AUDIT)\.md$' && {
  echo "Release audit failed: generated files or development reports are tracked." >&2
  exit 1
}

git grep -n -E 'codex_micro_lab|codex-micro-lab|303A:8360|v[.]oai[.]' -- . ':!scripts/audit-release.sh' && {
  echo "Release audit failed: private Codex Micro compatibility material is present." >&2
  exit 1
}

git grep -nE '/Users/[^/]+/' -- . ':!scripts/audit-release.sh' && {
  echo "Release audit failed: a local absolute path is present." >&2
  exit 1
}

echo "Release audit passed."
