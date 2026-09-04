# VITO-EO-01 — Provider Router Contract v0.1

Status: Draft architecture contract

## Core rule

Capability != Provider.

VITO requests neutral capabilities such as `CODE_BUILD`, `RED_TEAM`, `SECURITY_REVIEW` or `TEST_EXECUTION`. Provider identity is a routing concern only.

## Provider classes

VITO EO recognizes provider classes rather than assuming that every provider is a cloud LLM.

Initial classes:

- `CLOUD_LLM` — remote model/API provider
- `LOCAL_LLM` — self-hosted/open-weight model executed on controlled infrastructure
- `DETERMINISTIC_TOOL` — non-LLM analysis such as static analysis, tests, linters, scanners or policy checks
- `LOCAL_TOOL` — locally executed deterministic engineering tool

A provider class does not imply capability. Every provider must explicitly declare its supported capabilities.

`RED_TEAM` may therefore be satisfied by different provider classes, subject to assurance policy.

Examples:

- cloud reasoning reviewer
- local reasoning/coding model
- deterministic security/static-analysis toolchain

No single provider class is mandatory for VITO runtime availability.

## Local Reviewer Node

A Local Reviewer Node is a first-class provider option, not an emergency shell shortcut.

It must use the same provider contract as remote reviewers and must expose at least:

- stable provider ID
- provider type = `LOCAL_LLM`
- model family/model identity
- supported capabilities
- runtime health
- resource/capacity status
- policy compatibility
- execution result normalization
- evidence/artifact references

Local execution does not automatically satisfy reviewer independence. Independence is evaluated by model family, execution identity, provider identity and the current assurance policy.

A local reviewer based on the same model family as the builder must not be counted as an independent AL-4 reviewer merely because it runs on different hardware.

## Deterministic Review Toolchain

Non-LLM tools are strategically useful because they provide methodologically different evidence.

Potential capability providers include:

- deterministic tests
- type checking/linting
- static application security testing
- dependency vulnerability scanning
- secret scanning
- repository policy checks
- CodeQL/Semgrep-class analysis

Exact tools remain implementation choices and are not encoded into workflow capability names.

Deterministic evidence supplements, but does not automatically replace, required independent model-family reviews at assurance levels whose policy explicitly requires model-family diversity.

## Routing pipeline

1. requested capability
2. mandatory eligibility predicates
3. governance/security policy
4. provider enabled + health + availability
5. quota/capacity
6. assurance compatibility
7. independence compatibility
8. budget compatibility
9. deterministic score
10. selected provider + ordered fallback candidates
11. auditable routing decision

## Provider record — minimal v0.1

- `providerCode`
- `providerType`
- `modelFamily?`
- `modelIdentity?`
- `supportedCapabilities[]`
- `enabled`
- `healthStatus`
- `quotaStatus` or local `capacityStatus`
- `assuranceLevels[]`
- `qualityScore?`
- `costWeight?`
- `latencyWeight?`
- `locationClass?` (`REMOTE` / `LOCAL`)
- `metadata`

`modelFamily` is mandatory when assurance policy depends on model-family independence. If required identity metadata is unavailable, assurance verification fails closed.

## Eligibility predicates

A provider is eligible only if all mandatory predicates pass:

- requested capability supported
- provider enabled
- provider health acceptable
- provider available
- cloud quota or local capacity acceptable
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
- locality preference where policy allows it

Scoring must never override a failed eligibility predicate.

Local execution must not receive an automatic quality bonus merely because it is local; locality is a policy/cost/resilience property, not a quality claim.

## Independence

For high-assurance review, provider/model-family history from the current workflow run is part of routing context.

AL-4 target behavior:

- at least two actual reviewer executions
- at least two reviewer model families when model-family diversity is required
- reviewer execution IDs distinct
- reviewer provider IDs distinct where policy requires provider diversity
- builder/reviewer independence must be verifiable
- inability to verify required independence fails closed
- reviewer disagreement is a workflow governance event, not a router voting mechanism

Different infrastructure locations alone do not establish independence.

## Fallback behavior

A provider-local execution problem such as quota exhaustion, temporary unavailability, local capacity exhaustion or timeout should allow the runtime to request another eligible provider when retry policy permits.

Provider failure != workflow failure.

Examples:

- Claude quota exhausted -> try another eligible reviewer
- cloud outage -> local reviewer may become eligible fallback
- local GPU/resource unavailable -> eligible cloud reviewer may be selected
- deterministic scanner unavailable -> select another deterministic provider only when assurance policy permits substitution

Policy violations do not automatically trigger fallback to a less-restricted provider. Security policy remains invariant across candidates.

## Routing decision contract

Every routing decision should record:

- workflowRunId
- workflowStepRunId
- requestedCapability
- assuranceLevel
- candidate provider IDs/codes
- provider classes
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
- `CAPACITY_UNAVAILABLE`
- `POLICY_INCOMPATIBLE`
- `ASSURANCE_LEVEL_UNSUPPORTED`
- `INDEPENDENCE_REQUIREMENT_UNSATISFIED`
- `MODEL_IDENTITY_UNVERIFIABLE`
- `BUDGET_INCOMPATIBLE`
- `NO_ELIGIBLE_PROVIDER`

## Health model — minimal

Suggested statuses:

- `UNKNOWN`
- `HEALTHY`
- `DEGRADED`
- `QUOTA_LIMITED`
- `CAPACITY_LIMITED`
- `UNAVAILABLE`
- `DISABLED`

EO-01 v0.1 may begin with manually/configuration-derived health plus execution feedback. Active health probing is should-have, not mandatory for the first router implementation.

## Quota/capacity model — minimal

Cloud-style status:

- `UNKNOWN`
- `AVAILABLE`
- `LIMITED`
- `EXHAUSTED`

Local-capacity status:

- `UNKNOWN`
- `AVAILABLE`
- `BUSY`
- `RESOURCE_CONSTRAINED`
- `UNAVAILABLE`

Unknown quota/capacity handling must be policy-defined. It must not silently imply unlimited capacity.

## Historical quality — future-compatible v0.1 metadata

The router should remain compatible with later provider-by-capability performance history:

- success rate
- disagreement rate
- retry rate
- latency
- cost
- human override rate

Historical metrics may influence score only after eligibility and governance predicates pass.

## Tests required

- preferred provider unavailable -> eligible fallback selected
- cloud reviewer quota exhausted -> eligible local reviewer can be selected when policy allows
- local reviewer capacity unavailable -> eligible cloud fallback can be selected
- provider with higher score but failed capability predicate cannot win
- provider with exhausted quota/capacity cannot win current routing decision
- AL-4 reviewer candidate from forbidden model family excluded
- local reviewer from same model family as builder does not count as independent merely because it is local
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
- treating local execution as inherently trusted or inherently independent
