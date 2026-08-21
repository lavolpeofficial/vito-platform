#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

EXPECTED_BRANCH="feature/vito-eo-01-governed-runtime-v0.1"
branch="$(git branch --show-current)"
if [[ "$branch" != "$EXPECTED_BRANCH" ]]; then
  echo "Refusing validation on branch '$branch'; expected '$EXPECTED_BRANCH'" >&2
  exit 1
fi

echo "===== EO-01.3 CORRECTION 02 POSTCONDITIONS ====="

grep -q 'model ProviderCapability' prisma/schema.prisma
echo "PASS: ProviderCapability Prisma model"

grep -Rqs 'estimatedCostMinorUnits' packages/contracts/src/engineering apps/api/src/modules/provider-registry prisma/schema.prisma
echo "PASS: estimatedCostMinorUnits exists"

grep -Rqs 'COST_UNKNOWN' packages/contracts/src/engineering apps/api/src/modules/provider-registry
echo "PASS: COST_UNKNOWN exists"

grep -Rqs 'provider_capabilities' prisma/migrations/20260820_add_provider_registry_routing prisma/migrations/20260821000000_add_provider_capability_and_estimated_cost
echo "PASS: migration has ProviderCapability"

grep -Rqs 'estimatedCostMinorUnits' prisma/migrations/20260820_add_provider_registry_routing prisma/migrations/20260821000000_add_provider_capability_and_estimated_cost
echo "PASS: migration has estimatedCostMinorUnits"

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
echo "EO-01.3 Correction 02 validation PASS. No code changes, commit or push performed by this harness."
