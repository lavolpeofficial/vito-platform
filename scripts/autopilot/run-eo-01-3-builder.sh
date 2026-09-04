#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PROMPT="$ROOT/docs/architecture/vito-eo-01-3-builder-prompt.md"
REPORT="$ROOT/.tmp/autopilot/eo-01-3-build-report.txt"
EXPECTED_BRANCH="feature/vito-eo-01-governed-runtime-v0.1"

mkdir -p "$ROOT/.tmp/autopilot"

branch="$(git branch --show-current)"
if [[ "$branch" != "$EXPECTED_BRANCH" ]]; then
  echo "Refusing EO-01.3 build on branch '$branch'; expected '$EXPECTED_BRANCH'" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing EO-01.3 build: worktree is not clean." >&2
  git status --short >&2
  exit 1
fi

command -v opencode >/dev/null 2>&1 || {
  echo "opencode not found" >&2
  exit 1
}

[[ -f "$PROMPT" ]] || {
  echo "builder prompt missing: $PROMPT" >&2
  exit 1
}

echo "Starting EO-01.3 builder on $branch"
echo "Report: $REPORT"

opencode run \
  "$(cat "$PROMPT")" \
  --model=opencode/big-pickle \
  --title="VITO EO-01.3 Provider Registry + Capability Router" \
  --dir="$ROOT" \
  | tee "$REPORT"

echo
echo "EO-01.3 builder finished. No commit/push was performed by this harness."
echo "Inspect report: $REPORT"
echo "Current status:"
git status --short
