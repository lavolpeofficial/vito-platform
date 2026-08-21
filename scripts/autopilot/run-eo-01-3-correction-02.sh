#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

EXPECTED_BRANCH="feature/vito-eo-01-governed-runtime-v0.1"
PROMPT="$ROOT/docs/architecture/vito-eo-01-3-correction-02.md"
REPORT="$ROOT/.tmp/autopilot/eo-01-3-correction-02-report.txt"

mkdir -p "$ROOT/.tmp/autopilot"

branch="$(git branch --show-current)"
if [[ "$branch" != "$EXPECTED_BRANCH" ]]; then
  echo "Refusing correction on branch '$branch'; expected '$EXPECTED_BRANCH'" >&2
  exit 1
fi

command -v opencode >/dev/null 2>&1 || { echo 'opencode not found' >&2; exit 1; }
[[ -f "$PROMPT" ]] || { echo "missing prompt: $PROMPT" >&2; exit 1; }

rm -f "$REPORT"

echo "Starting EO-01.3 Correction 02 with hard postconditions"
echo "Report: $REPORT"

set +e
opencode run \
  "$(cat "$PROMPT")" \
  --model=opencode/big-pickle \
  --title="VITO EO-01.3 Correction 02 Hard Postconditions" \
  --dir="$ROOT" \
  --auto \
  | tee "$REPORT"
agent_rc=${PIPESTATUS[0]}
set -e

if [[ $agent_rc -ne 0 ]]; then
  echo "Builder exited non-zero: $agent_rc" >&2
  exit $agent_rc
fi

echo
echo "===== HARNESS POSTCONDITIONS ====="

fail=0
check() {
  local label="$1"; shift
  if "$@"; then
    echo "PASS: $label"
  else
    echo "FAIL: $label" >&2
    fail=1
  fi
}

check "ProviderCapability Prisma model" grep -q 'model ProviderCapability' prisma/schema.prisma
check "estimatedCostMinorUnits exists" grep -Rqs 'estimatedCostMinorUnits' packages/contracts/src/engineering apps/api/src/modules/provider-registry prisma/schema.prisma
check "COST_UNKNOWN exists" grep -Rqs 'COST_UNKNOWN' packages/contracts/src/engineering apps/api/src/modules/provider-registry
check "migration has ProviderCapability" grep -Rqs 'provider_capabilities' prisma/migrations/20260820_add_provider_registry_routing prisma/migrations/20260821000000_add_provider_capability_and_estimated_cost
check "migration has estimatedCostMinorUnits" grep -Rqs 'estimatedCostMinorUnits' prisma/migrations/20260820_add_provider_registry_routing prisma/migrations/20260821000000_add_provider_capability_and_estimated_cost

if [[ $fail -ne 0 ]]; then
  echo "Correction 02 FAILED hard postconditions. Do not review/commit." >&2
  exit 2
fi

echo
echo "===== TRUSTED VALIDATION ====="
pnpm prisma:generate
pnpm --filter @vito/contracts test
pnpm --filter @vito/api test
pnpm build

echo
echo "===== FINAL STATUS ====="
git status --short

echo
echo "Correction 02 hard postconditions and trusted validation PASS."
echo "No commit/push performed by harness."
