# VITO-EO-01.3 — Correction 01

Target branch: `feature/vito-eo-01-governed-runtime-v0.1`

## Context

Independent Nemotron review returned Verdict C / Gate CLOSED. Not every reported finding is material. This correction intentionally addresses only verified EO-01.3 contract gaps and preserves the existing architecture.

## Fix only these material findings

### 1. Provider capability enable/disable semantics

The EO-01.3 builder spec requires provider support for an EngineeringCapability to allow enabled/disabled support.

Current implementation stores only a JSON array of supported capability codes, which cannot represent per-capability enabled/disabled state.

Implement the minimal durable representation needed to support:
- provider -> multiple engineering capabilities
- each provider-capability assignment has `isEnabled`
- tenant-safe lookup
- no duplicate provider/capability assignment

Prefer a minimal `ProviderCapability` model/relation if consistent with Prisma conventions.
Do not duplicate the EngineeringCapability taxonomy itself.

Router capability eligibility must require an enabled capability assignment.

Add tests proving:
- enabled capability => eligible
- disabled capability => rejected
- missing capability => rejected
- duplicate provider-capability assignment prevented by schema/constraint

### 2. Budget semantics must use actual estimated cost, not normalized costScore

Current routing compares `costScore` to `maxCostMinorUnits`. This is invalid because `costScore` is a ranking input, not an actual monetary estimate.

Introduce the smallest explicit estimated-cost representation required for v0.1 routing, e.g. an `estimatedCostMinorUnits` field on provider declaration/record or equivalent explicit cost metadata accessor.

Requirements:
- when request contains `maxCostMinorUnits`, reject a provider whose declared estimated cost exceeds the budget
- when budget enforcement is required and estimated cost is unknown, reject fail-closed with a machine-readable reason such as `COST_UNKNOWN`
- keep normalized `costScore` only as a ranking dimension after eligibility
- do not build billing

Add tests proving:
- actual estimated cost <= budget => eligible
- actual estimated cost > budget => rejected
- unknown cost + mandatory budget => rejected fail-closed
- a high normalized costScore cannot bypass budget eligibility

### 3. Clarify DEGRADED and quota semantics without broad redesign

Keep the existing separation between administrative provider status and observed health.

Required semantics for v0.1:
- `ProviderStatus.ACTIVE` = routable subject to later checks
- `ProviderStatus.DISABLED` = not routable
- `ProviderStatus.DEGRADED` = choose one explicit behavior and document/test it; recommended: administratively degraded but still routable only if health is routable, with a score penalty OR treat as non-routable. Be consistent.
- `ProviderHealthStatus.DEGRADED` may remain routable with a health-preference penalty
- quota `EXHAUSTED` is ineligible
- quota `LIMITED` may remain eligible but should be explicit/tested

Do not change the high-level eligibility order. A separate internal QUOTA phase is acceptable as long as availability/quota are evaluated before assurance, independence, budget and scoring.

## Findings that are NOT correction requirements

Do NOT remove previous reviewer provider/model-family exclusion logic. The EO-01.3 builder spec explicitly requires support for previous reviewer provider IDs and model families as routing constraints for independence.

Do NOT add real-DB/testcontainers integration solely because the reviewer suggested it; the builder spec does not require a specific database test technology.

Do NOT add provider execution, n8n provider selection, generic policy language, ML routing, billing, secrets storage, commit/push/merge automation or EO-01.4 sandbox execution.

## Validation

Run:
- `pnpm prisma:generate`
- `pnpm --filter @vito/contracts test`
- `pnpm --filter @vito/api test`
- `pnpm build`

Preserve all existing EO-01.1, EO-01.2 and EO-01.3 tests and add targeted tests for the corrections above.

## Git boundary

Do not commit.
Do not push.

## Required final report

Return:

### VITO-EO-01.3 CORRECTION 01 BUILD REPORT
- Changed files
- ProviderCapability representation
- Budget representation and fail-closed behavior
- DEGRADED/quota semantics
- New/updated tests
- Full test counts
- Build result
- Deviations
- Git status
- Commit: NOT CREATED
- Push: NOT PERFORMED
