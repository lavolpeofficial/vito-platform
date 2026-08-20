# VITO-EO-01 — Provider Router Contract v0.1

Status: Draft architecture contract

## Core rule

Capability != Provider.

VITO requests neutral capabilities such as `CODE_BUILD`, `RED_TEAM`, `SECURITY_REVIEW` or `TEST_EXECUTION`. Provider identity is a routing concern only.

## Routing pipeline

1. requested capability
2. mandatory eligibility predicates
3. governance/security policy
4. provider enabled + health + availability
5. quota
6. assurance compatibility
7. independence compatibility
8. budget compatibility
9. deterministic score
10. selected provider + ordered fallback candidates
11. auditable routing decision

## Provider record — minimal v0.1

- `providerCode`
- `providerType`
- `modelFamily`
- `supportedCapabilities[]`
- `enabled`
- `healthStatus`
- `quotaStatus`
- `assuranceLevels[]`
- `qualityScore?`
- `costWeight?`
- `latencyWeight?`
- `metadata`

## Eligibility predicates

A provider is eligible only if all mandatory predicates pass:

- requested capability supported
- provider enabled
- provider health acceptable
- provider available
- quota available
- execution policy compatible
- assurance level compatible
- reviewer independence requirement satisfied where applicable
- execution budget not known to be exceeded

Ineligible candidates must be excluded before scoring.

## Deterministic scoring v0.1

Scoring is deliberately simple and explainable. Candidate score may combine normalized values for:

- historical quality
- estimated cost
- latency
- provider preference policy

Scoring must never override a failed eligibility predicate.

## Independence

For high-assurance review, provider/model-family history from the current workflow run is part of routing context.

AL-4 target behavior:

- at least two reviewers
- at least two reviewer model families
- builder/reviewer independence must be verifiable
- inability to verify required independence fails closed
- reviewer disagreement is a workflow governance event, not a router voting mechanism

## Fallback behavior

A provider-local execution problem such as quota exhaustion, temporary unavailability or timeout should allow the runtime to request another eligible provider when retry policy permits.

Provider failure != workflow failure.

Policy violations do not automatically trigger fallback to a less-restricted provider. Security policy remains invariant across candidates.

## Routing decision contract

Every routing decision should record:

- workflowRunId
- workflowStepRunId
- requestedCapability
- assuranceLevel
- candidate provider IDs/codes
- eligibility result per candidate
- rejection reason codes
- score components for eligible candidates
- selected provider
- ordered fallback candidates
- timestamp
- routing policy version

## Reason codes — initial set

- `CAPABILITY_UNSUPPORTED`
- `PROVIDER_DISABLED`
- `PROVIDER_UNHEALTHY`
- `PROVIDER_UNAVAILABLE`
- `QUOTA_UNAVAILABLE`
- `POLICY_INCOMPATIBLE`
- `ASSURANCE_LEVEL_UNSUPPORTED`
- `INDEPENDENCE_REQUIREMENT_UNSATISFIED`
- `BUDGET_INCOMPATIBLE`
- `NO_ELIGIBLE_PROVIDER`

## Health model — minimal

Suggested statuses:

- `UNKNOWN`
- `HEALTHY`
- `DEGRADED`
- `UNAVAILABLE`

EO-01 v0.1 may begin with manually/configuration-derived health plus execution feedback. Active health probing is should-have, not mandatory for the first router implementation.

## Quota model — minimal

Suggested statuses:

- `UNKNOWN`
- `AVAILABLE`
- `LIMITED`
- `EXHAUSTED`

Unknown quota handling must be policy-defined. It must not silently imply unlimited capacity.

## Tests required

- preferred provider unavailable -> eligible fallback selected
- provider with higher score but failed capability predicate cannot win
- provider with exhausted quota cannot win current routing decision
- AL-4 reviewer candidate from forbidden model family excluded
- no eligible provider -> explicit fail-closed result
- deterministic same input -> same selected provider
- routing decision contains human-readable rejection reasons
- router remains provider-neutral

## Non-goals

- ML-based selection
- adaptive online-learning scoring
- provider marketplace
- dynamic procurement/pricing optimization
- autonomous relaxation of assurance requirements
