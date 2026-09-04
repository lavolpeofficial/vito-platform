# VITO-EO-01.3 — Builder Prompt

Target branch: `feature/vito-eo-01-governed-runtime-v0.1`
Parent issue: #10

## Mission

Implement only the provider-neutral Provider Registry + Capability Router for the governed engineering runtime.

VITO chooses providers. n8n must not contain provider-selection logic.

Capability != Provider.

Reuse EO-01.1 engineering contracts and EO-01.2 Workflow Runtime. Do not implement productive provider adapters yet; EO-01.4 Execution Policy & Sandbox is a security gate before productive provider execution.

## Before editing

1. Verify branch/worktree and clean status.
2. Read:
   - `packages/contracts/src/engineering/**`
   - `apps/api/src/modules/workflow-runtime/**`
   - `docs/architecture/vito-eo-01-build-specs.md`
   - `docs/architecture/vito-n8n-engineering-autopilot-v0.1.md`
   - issue #10 requirements if available locally
3. Inventory existing `Capability`, `DigitalEmployeeCapability`, audit and Prisma conventions.
4. Reuse existing repository patterns; do not create a second capability system.

## Provider-neutral data model — minimal v0.1

Add only fields/entities necessary to support deterministic provider eligibility/routing and auditable decisions.

### AgentProvider
Minimum expected semantics:
- id
- organizationId or explicit global/system scope consistent with repository conventions
- providerCode (stable machine identifier, e.g. `OPENCODE`, `ANTHROPIC`, but provider names must never appear in capability codes)
- displayName
- status: ACTIVE / DISABLED / DEGRADED as minimally needed
- modelFamily
- optional modelName/modelCode
- capability declarations
- availability / health status
- quota status
- optional qualityScore
- optional latencyScore
- optional costScore / cost metadata sufficient for v0.1 routing
- timestamps

Do not add secrets/API keys to provider records.

### ProviderCapability
Represent provider support for an `EngineeringCapability` without duplicating the capability taxonomy.

Must allow:
- provider -> multiple engineering capabilities
- enabled/disabled support
- optional assurance ceiling/floor only if required for deterministic eligibility

### ProviderHealth
May be persisted fields on AgentProvider or a minimal separate entity only if justified.
Required semantics:
- AVAILABLE
- DEGRADED
- UNAVAILABLE
- QUOTA_BLOCKED (or equivalent normalized quota state)
- checkedAt / updatedAt

### ProviderRoutingDecision
Persist an auditable routing decision or provide a minimal durable model if repository patterns require it.
At minimum record:
- organizationId
- workflowRunId / workflowStepRunId where supplied
- requested capability
- requested assurance level
- selected providerId (nullable when none eligible)
- candidate provider IDs considered
- rejected candidates with machine-readable reason codes
- normalized score inputs / final score for eligible candidates
- decision reason
- createdAt
- correlationId

No prompt content or secrets in routing decisions.

## Routing algorithm

Implement deterministic routing in this order:

1. capability eligibility
2. provider enabled/status policy
3. availability / quota
4. assurance compatibility
5. independence requirement
6. budget eligibility
7. deterministic score/rank among remaining candidates

An ineligible provider must NEVER win because of a high score.

Suggested score dimensions for eligible candidates only:
- historicalQuality
- estimatedCost
- latency
- availability/health preference

Keep weights explicit/configured in code for v0.1. Do not build ML.

Tie-breaking must be deterministic, e.g. stable providerCode/id ordering after equal score.

## Independence

Use EO-01.1 `IndependenceContext` semantics.

For reviewer selection, support exclusion rules such as:
- providerId already used when distinct provider required
- modelFamily equal to builder family when assurance requires independence
- previous reviewer model families/provider IDs when AL4 requires distinct evidence

Do not redefine AL4 state-machine rules. Router only determines whether a candidate is eligible for the requested constraints.

## Availability / quota

Provider outage or quota exhaustion is provider state, not workflow failure.

Must prove:
- Claude/Anthropic unavailable cannot block routing when another eligible provider exists
- quota-blocked provider cannot win
- if no eligible provider exists, return normalized `NO_ELIGIBLE_PROVIDER` / assurance-unsatisfied result; do not silently select an ineligible provider

## Cost/budget

Use minimal deterministic budget eligibility.
Do not build billing.

If a request contains a max cost budget and candidate declared estimated cost exceeds it, reject candidate with machine-readable reason.

Unknown cost behavior must be explicit/fail-closed when budget enforcement is mandatory.

## Audit

Use existing AuditService patterns.
Audit each routing decision with:
- organizationId
- capability
- assurance level
- selected provider or none
- candidate count
- rejection reason codes
- correlationId

No secrets, tokens, prompts or full environment dumps.

## API/service boundary

Implement a small provider registry/router module/service.
No provider execution in EO-01.3.
No OpenCode/Claude/Codex CLI invocation.
No n8n provider branching.

A minimal router request should conceptually contain:
- organizationId
- capability
- assuranceLevel
- workflowRunId?
- workflowStepRunId?
- independenceContext?
- budget?
- correlationId

Return:
- selected provider snapshot or none
- routing decision ID/reference
- normalized reasons
- eligible candidates / scores as needed for explainability

## Tests — mandatory

At minimum prove:

1. provider supporting requested capability is eligible
2. provider without capability is rejected
3. disabled provider is rejected
4. unavailable provider is rejected
5. quota-blocked provider is rejected
6. assurance-incompatible provider is rejected
7. reviewer violating independence/model-family requirement is rejected
8. budget-ineligible provider is rejected
9. ineligible provider cannot win even with highest quality score
10. deterministic best eligible provider wins
11. deterministic tie-break
12. Claude/Anthropic unavailable -> alternative eligible reviewer/provider selected
13. no eligible provider -> normalized fail-closed result
14. routing decision persisted/audited with explainable reasons
15. tenant isolation if provider registry is tenant-scoped
16. existing EO-01.1 contract tests remain green
17. existing EO-01.2 runtime tests remain green
18. full API tests remain green
19. build passes

## Explicit non-goals

Do NOT implement:
- provider API/CLI adapters
- OpenCode execution
- Claude execution
- Codex execution
- n8n provider selection
- generic policy language
- ML routing
- billing system
- secrets storage
- automatic commit/push/merge
- EO-01.4 sandbox functionality beyond interfaces needed for routing compatibility

## Git boundary

Do not commit or push.

## Required final report

Return exactly:

### VITO-EO-01.3 BUILD REPORT

- Branch
- Changed files
- Prisma changes/migration
- Provider registry model
- Router request/response contract
- Eligibility order
- Scoring/tie-break behavior
- Independence behavior
- Availability/quota fallback behavior
- Audit behavior
- Test commands/results
- Build result
- Deviations
- Open questions
- Git status
- Commit: NOT CREATED
- Push: NOT PERFORMED

Stop afterward. No EO-01.4 work without gate.
