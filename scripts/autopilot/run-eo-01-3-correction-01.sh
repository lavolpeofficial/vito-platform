#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

EXPECTED_BRANCH="feature/vito-eo-01-governed-runtime-v0.1"
PROMPT="$ROOT/docs/architecture/vito-eo-01-3-correction-01.md"
REPORT="$ROOT/.tmp/autopilot/eo-01-3-correction-01-report.txt"

mkdir -p "$ROOT/.tmp/autopilot"

branch="$(git branch --show-current)"
if [[ "$branch" != "$EXPECTED_BRANCH" ]]; then
  echo "Refusing correction on branch '$branch'; expected '$EXPECTED_BRANCH'" >&2
  exit 1
fi

command -v opencode >/dev/null 2>&1 || {
  echo "opencode not found" >&2
  exit 1
}

[[ -f "$PROMPT" ]] || {
  echo "correction prompt missing: $PROMPT" >&2
  exit 1
}

echo "Starting EO-01.3 Correction 01 on $branch"
echo "Existing uncommitted EO-01.3 implementation will be corrected in place."
echo "Report: $REPORT"

opencode run \
  "$(cat "$PROMPT")" \
  --model=opencode/big-pickle \
  --title="VITO EO-01.3 Correction 01" \
  --dir="$ROOT" \
  | tee "$REPORT"

echo
echo "EO-01.3 Correction 01 finished. No commit/push was performed by this harness."
echo "Current status:"
git status --short
