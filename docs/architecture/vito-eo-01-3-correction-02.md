# VITO-EO-01.3 — Correction 02 (Hard Postconditions)

Target branch: `feature/vito-eo-01-governed-runtime-v0.1`

## Context

Correction 01 did not materially modify the EO-01.3 implementation. The correction report was empty and the required invariants were still absent. This block must not stop after inspection. It is successful only if all postconditions below are true in the live worktree and full validation passes.

## Required code corrections

### A. Durable ProviderCapability assignment

Add a durable `ProviderCapability` representation linking an `AgentProvider` to an EngineeringCapability code.

Minimum fields/invariants:
- `id`
- `organizationId`
- `agentProviderId`
- `capabilityCode`
- `isEnabled`
- timestamps as repository conventions require
- FK to AgentProvider
- organization-scoped indexes
- unique constraint preventing duplicate provider/capability assignments, e.g. `[organizationId, agentProviderId, capabilityCode]`

Do not duplicate the global EngineeringCapability taxonomy.

Router capability eligibility MUST use enabled provider-capability assignments. The old JSON-only `supportedCapabilities` mechanism must no longer be the routing authority. Remove it if safe, or leave only for backwards compatibility/documentation but do not use it for eligibility.

Mandatory tests:
- enabled capability => eligible
- disabled capability => rejected
- missing capability => rejected
- duplicate assignment prevented by schema constraint/equivalent

### B. Explicit estimated monetary cost

Add an explicit nullable estimated monetary cost representation, named `estimatedCostMinorUnits` unless an equally clear repository-consistent name is required.

This field is NOT `costScore`.

Budget behavior:
- no max budget => cost eligibility check does not block
- `estimatedCostMinorUnits <= maxCostMinorUnits` => eligible subject to other checks
- `estimatedCostMinorUnits > maxCostMinorUnits` => reject with machine-readable budget reason
- `estimatedCostMinorUnits` unknown AND `maxCostMinorUnits` present => reject fail-closed with `COST_UNKNOWN`

`costScore` may remain only as a ranking score after eligibility.

Mandatory tests:
- known under-budget cost passes
- known equal-budget cost passes
- over-budget cost rejects
- unknown cost + max budget rejects with `COST_UNKNOWN`
- excellent costScore cannot bypass over-budget/unknown-cost rejection

### C. Explicit provider status/health/quota semantics

Use and test one consistent v0.1 policy:
- ProviderStatus.ACTIVE: may route
- ProviderStatus.DISABLED: ineligible
- ProviderStatus.DEGRADED: explicit deterministic behavior; preferred for this block: ineligible at status-policy phase to preserve current behavior
- ProviderHealthStatus.HEALTHY: routable
- ProviderHealthStatus.DEGRADED: routable with health score penalty
- ProviderHealthStatus.UNKNOWN/UNAVAILABLE/DISABLED/QUOTA_LIMITED: ineligible
- ProviderQuotaStatus.AVAILABLE: routable
- ProviderQuotaStatus.LIMITED: routable, but explicitly tested
- ProviderQuotaStatus.EXHAUSTED: ineligible
- ProviderQuotaStatus.UNKNOWN: choose explicit fail-closed or documented routable behavior; prefer fail-closed for production governance

A separate internal QUOTA phase is allowed; do not change the high-level order: capability -> status -> availability/quota -> assurance -> independence -> budget -> score.

## Preserve these existing requirements

- Previous reviewer provider/model-family exclusions remain valid routing constraints.
- Ineligible provider can never win due to score.
- deterministic tie-break remains providerCode ordering or equally deterministic stable ordering.
- tenant isolation remains mandatory.
- every routing decision remains persisted/audited.
- no provider execution.
- no n8n provider branching.
- no EO-01.4 sandbox execution.
- no commit/push/merge.

## HARD POSTCONDITIONS

The correction is NOT complete unless all of the following commands succeed after implementation:

```bash
pnpm prisma:generate
pnpm --filter @vito/contracts test
pnpm --filter @vito/api test
pnpm build

grep -q 'model ProviderCapability' prisma/schema.prisma
grep -Rqs 'estimatedCostMinorUnits' packages/contracts/src/engineering apps/api/src/modules/provider-registry prisma/schema.prisma
grep -Rqs 'COST_UNKNOWN' packages/contracts/src/engineering apps/api/src/modules/provider-registry
```

The migration SQL must also contain creation of the ProviderCapability persistence and the estimated monetary cost field.

If any postcondition fails, continue correcting. Do not return a success report.

## Required final report

Return exactly:

### VITO-EO-01.3 CORRECTION 02 BUILD REPORT
- Changed files
- ProviderCapability model/constraint
- Router capability lookup behavior
- estimatedCostMinorUnits persistence/contract
- COST_UNKNOWN fail-closed behavior
- ProviderStatus/Health/Quota semantics
- Test commands and exact counts
- Build result
- Hard postconditions: PASS/FAIL for each
- Migration changes
- Deviations
- Git status
- Commit: NOT CREATED
- Push: NOT PERFORMED
