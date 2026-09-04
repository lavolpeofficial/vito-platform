# VITO-EO-01 — Local Reviewer Node v0.1

Status: Draft architecture specification

## Purpose

Define a provider-neutral local review execution option for VITO Engineering Orchestration.

The Local Reviewer Node exists to reduce cloud-provider dependency, improve resilience, support sensitive workloads, and provide an additional independent review path where assurance policy permits.

It is not a replacement for governance, and local execution is not automatically trusted.

## Core principles

1. Capability != Provider.
2. Local != independent.
3. Local != trusted by default.
4. Local execution uses the same normalized provider contract as remote execution.
5. Assurance requirements remain fail-closed.
6. Human release authority is unchanged.
7. Local reviewers have no commit/push/merge authority.

## Runtime role

A Local Reviewer Node may satisfy capabilities such as:

- `CODE_REVIEW`
- `RED_TEAM`
- `SECURITY_REVIEW`
- `ARCHITECTURE_REVIEW`

Capability eligibility depends on the concrete model/tool declaration and policy.

## Logical placement

VITO Orchestrator
-> Provider Router
-> Local Reviewer Adapter
-> Local Reviewer Node
-> isolated reviewer worktree / artifact input
-> normalized AgentExecutionResult

The workflow engine must not contain local-model-specific branches.

## Minimum identity metadata

Each local reviewer provider must expose:

- provider ID
- provider code
- provider type = `LOCAL_LLM`
- runtime/node ID
- model identity
- model family
- model/version fingerprint where available
- supported capabilities
- assurance levels supported
- health status
- capacity status
- execution-policy compatibility

If model-family identity is required for assurance and cannot be verified, the reviewer is ineligible for that assurance decision.

## Security profile

Default reviewer profile:

- repository source: read-only
- reviewer worktree: source read-only
- temp/test-output path: isolated write
- secrets: DENY
- unrestricted HOME: DENY
- git commit: DENY
- git push: DENY
- merge: DENY
- branch deletion: DENY
- network: DENY unless explicitly required by runtime/model stack
- shell commands: allowlisted/policy-controlled

Local model hosting must not inherit the full user's environment into model-visible context.

## Evidence requirements

A local review execution must produce the same evidence classes as a cloud reviewer when applicable:

- reviewer execution ID
- workflow run ID
- workflow step ID
- input artifact references
- review report
- structured verdict
- findings
- output artifact references
- start/end timestamp
- timeout/cancel state
- model identity metadata

The review result must be attributable to the exact reviewed revision/artifact set.

## Independence

A local reviewer can count toward higher assurance only when the required independence can be demonstrated.

Not sufficient by itself:

- different machine
- local instead of cloud
- different provider adapter
- different process

Relevant dimensions include:

- model family
- model identity
- provider identity
- reviewer execution identity
- reviewed artifact identity

Example:

Builder = model family X via cloud
Local reviewer = same model family X locally

This may provide resilience, but it does not satisfy model-family diversity for an AL-4 policy requiring a different family.

## Capacity and health

Local provider capacity differs from cloud quota.

Suggested capacity states:

- `UNKNOWN`
- `AVAILABLE`
- `BUSY`
- `RESOURCE_CONSTRAINED`
- `UNAVAILABLE`

Suggested health states:

- `UNKNOWN`
- `HEALTHY`
- `DEGRADED`
- `UNAVAILABLE`
- `DISABLED`

The router must treat capacity/health as eligibility inputs before scoring.

## Failure semantics

Local runtime problems are provider-local outcomes, not automatically workflow failures.

Examples:

- model server unavailable
- GPU/CPU memory exhaustion
- timeout
- corrupted runtime response
- policy denial

When retry policy permits, VITO may route the capability to another eligible provider.

Security-policy failure must never trigger fallback to a less restrictive execution policy.

## Deterministic local tools

A Local Reviewer Node may coexist with deterministic tools such as:

- tests
- type checking
- linters
- static security analyzers
- dependency scanners
- secret scanners
- repository policy validators

These tools should be represented as independent provider/tool executions with their own artifacts and evidence.

Deterministic tool evidence is valuable because it is methodologically different from LLM review, but it does not automatically replace a required independent LLM/model-family review.

## Deployment phases

### Phase 0 — Contract readiness

No local model required yet.

- provider type exists
- capacity/health semantics exist
- local reviewer adapter contract defined
- assurance independence rules support local providers

### Phase 1 — Developer workstation pilot

One local reviewer runtime on a controlled workstation.

Purpose:
- fallback testing
- low-risk code review
- routing validation
- privacy/resilience experiments

Not automatically eligible for AL-4.

### Phase 2 — Dedicated VITO Reviewer Node

Dedicated machine/server with controlled runtime, stable model identity, isolated filesystem and explicit health/capacity reporting.

### Phase 3 — Multi-node local reviewer pool

Only if workload and commercial demand justify it.

Possible later capabilities:
- tenant-isolated execution pools
- GPU scheduling
- local redundancy
- model-family diversification

## Acceptance tests

Before a Local Reviewer Node is productive:

1. router discovers it as `LOCAL_LLM`
2. capability eligibility is explicit
3. model identity/family captured
4. source write is denied
5. secrets access denied
6. commit/push denied
7. timeout enforced
8. unavailable local node triggers eligible fallback
9. same-family local reviewer cannot satisfy model-family independence rule
10. review artifacts are attributable to exact input revision
11. execution is audited
12. human release gate remains mandatory

## Non-goals for EO-01 v0.1

- choosing a permanent local model vendor/model
- building a GPU cluster
- Kubernetes inference infrastructure
- training/fine-tuning a custom model
- replacing all cloud reviewers
- assuming local execution is cheaper in all circumstances
- giving local reviewers release authority

## Strategic consequence

VITO's Red Team is a capability layer, not a Claude integration.

A future workflow can combine:

- cloud reviewer family A
- local reviewer family B
- deterministic security/tool evidence
- human release authority

This provides stronger resilience and methodological diversity than a single-provider review chain.
