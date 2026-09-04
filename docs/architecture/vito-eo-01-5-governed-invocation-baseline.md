# VITO EO-01.5 — Governed Invocation Boundary

## Status

- **State:** BASELINE FROZEN
- **Branch:** `main`
- **Final main SHA:** `f226a06ece467012d556245e285cc43508365fb3`
- **Independent review verdict:** EO-01.5 BASELINE FREEZE — PASS WITH NON-BLOCKING FINDINGS

Final validation on the frozen snapshot:

| Check | Result |
| --- | --- |
| Focused EO-01.5 tests | 95/95 PASS |
| Full API tests | 241/241 PASS (12 suites) |
| Contracts TypeScript (`--noEmit`) | PASS |
| API TypeScript (`--noEmit`) | PASS |

Review history of the merged snapshots:

- Reviewed pre-F1 merged snapshot: `8b5578b173761f08d8b58cf41477eddc0f9acbdc`
- Independent review blocker:
  **F1** — idempotency incorrectly applied to non-consequential READ_FILE/GIT_READ.
- Resolution:
  Fixed in main commit `f226a06ece467012d556245e285cc43508365fb3` ("vito(eo-01.5): restrict
  idempotency claims to consequential actions") by restricting idempotency claim/finalization
  to the canonical predicate:

  ```text
  isConsequentialExecutionAction(request.requestedAction)
  ```

- Independent delta re-review result: **F1 FIXED.**

## Purpose

EO-01.5 is the governed runtime invocation boundary between routing/orchestration and
productive provider-adapter execution.

Core invariant:

> Provider routing or a caller request alone never creates execution authority.
> Authority is reconstructed and revalidated immediately before productive adapter
> execution.

Every invocation passes through one deterministic, fail-closed chain; each stage can only
narrow authority, never widen it.

## Final Execution Chain

```text
Governed Invocation Request
→ Structural Validation
→ Current Provider Eligibility Revalidation
→ Trusted Execution Profile Resolution
→ Trusted Execution Policy Resolution
→ EO-01.4 evaluatePolicy()
→ Human Gate Scope Validation where required
→ Trusted Credential Resolution
→ Consequential-Action Idempotency Claim
→ Productive adapter.execute()
→ Runtime Timeout / Exception Boundary
→ Lifecycle Validation
→ Result / Error / Secret Sanitization
→ Idempotency Completion State
→ Audit-safe Completion
```

There is **exactly ONE productive `adapter.execute()` call site**
(`governed-invocation.service.ts`, inside `invokeAdapterWithTimeout`). No other code path in
the governed-invocation module invokes an adapter productively.

## Trust Boundaries

### Caller-Controlled Request

The caller may provide request data. The caller may NOT directly provide:

- authoritative ExecutionProfile
- PolicyDecision
- HumanGateBinding
- releaseGateStatus
- raw credentials
- idempotency-store claim
- unrestricted environment authority

### Execution Profile

`request.executionProfile` is non-authoritative — it is a structural hint only. The effective
execution profile comes exclusively from the trusted `ExecutionProfileResolver`. A missing or
invalid trusted profile fails closed (`EXECUTION_PROFILE_NOT_GOVERNED`) before any productive
execution. BUILDER / REVIEWER / ORCHESTRATOR cannot self-elevate to RELEASE_AUTHORITY through
request input; profile/action mismatches are denied by policy before execution.

### Execution Policy

Routing eligibility is not execution permission. The EO-01.4 policy evaluation
(`evaluatePolicy()`) remains authoritative at execution time over a trusted, resolved policy
context. Missing or invalid trusted policy context fails closed.

### Human Gate

The caller provides only `humanApprovalReference` as lookup input. The trusted
`HumanGateResolver` supplies the authoritative binding. The binding validates against the
invocation context:

- organization
- workflow run
- workflow step
- capability
- provider where scoped
- inputReference where scoped
- requestedAction
- expiry
- artifact scope where authoritative comparison exists

A missing `requestedAction` does NOT become wildcard release authority — release-consequential
actions require explicit action scope and fail closed otherwise. Artifact-bound approval
remains fail-closed where authoritative invocation-side artifact identity is unavailable.

### Credentials

The `CredentialBroker` is trusted; the caller cannot provide credential authority.
`REQUIRED` / `UNKNOWN` credential states fail closed. Credential references exist only at the
trusted adapter boundary and are sanitized from outputs and audits.

## Provider Eligibility Revalidation

At execution time, current eligibility is revalidated for:

- organization ownership
- capability support
- status
- health
- quota
- assurance compatibility
- bounded estimated execution cost

Historical routing success is NOT execution authority. No provider fallback occurs inside
EO-01.5.

## Human Gate Scope

Release/consequential approval is scope-bound. An action approval cannot be reused for
another consequential action: approval for `GIT_COMMIT` does not authorize `GIT_PUSH`.
Expiry remains enforced. Artifact scope is preserved contractually, but complete end-to-end
artifact authority requires a future authoritative invocation-side `artifactReference`
(recorded as follow-up).

## Runtime Failure Boundary

- EO-01.5 independently bounds adapter waiting with its own timeout (the adapter is not
  trusted to honor `context.timeoutMs` voluntarily).
- Adapter exceptions normalize into governed failure results.
- Illegal lifecycle terminal states are rejected.
- Late Promise completion does not create a second EO-01.5 completion path.
- Timeout is NOT equivalent to cancellation.

Accepted limitation: underlying adapter activity may continue after an EO-01.5 timeout until
future AbortSignal/cancellation support exists. The idempotency claim bounds this residual
risk to one execution per logical operation instead of unbounded retries.

## Output / Secret Boundary

- Raw provider-controlled references are not blindly trusted.
- Governed references use approved `gov://` semantics where implemented.
- Provider metadata is sanitized; usage metadata is sanitized.
- Error messages are sanitized/bounded.
- Exact trusted credentialReference values are recursively redacted. Redaction covers values,
  nested objects, arrays, and object keys.
- Side-effect metadata is sanitized.
- Audit output is derived from the normalized/sanitized representation.

This is bounded secret-leak prevention, not a general DLP system.

## Idempotency Model

Three separate identities are maintained deliberately; they must not be collapsed.

### Attempt Identity

`invocationId`

Purpose: attempt ownership, audit evidence, conflict evidence.
It is NOT the duplicate-prevention key.

### Logical Operation Identity

`logicalOperationKey` — schema `logop-v2`.

Purpose: duplicate prevention for consequential side effects.

Properties:

- independent of invocationId
- independent of provider
- independent of execution profile
- independent of assurance level
- changing execution mechanism does not reset duplicate protection
- action-aware authoritative target semantics
- deterministic
- length-prefixed encoding
- no arbitrary JSON.stringify
- no timestamps

Current fields:

- organizationId
- workflowRunId
- workflowStepRunId
- capabilityCode
- requestedAction
- action-authoritative target where modeled
- inputReference where applicable

Action target semantics:

- FILE mutation (WRITE_FILE / CREATE_FILE / DELETE_FILE) → `requestedPath`
- RUN_COMMAND → `requestedCommand`

Irrelevant target fields do not alter identity. Contradictory action/target combinations
(e.g., WRITE_FILE with requestedCommand, RUN_COMMAND with requestedPath) fail request
validation.

### Governed Context Fingerprint

Purpose: exact execution-context binding, replay and forensic evidence. May additionally
contain provider, trusted execution profile, and assurance level. A context-fingerprint
change does NOT create permission to execute the same logical consequential operation twice;
it is evidence, never authorization.

## Idempotency Scope — Final F1 Correction

Idempotency claim/finalization applies ONLY when:

```text
isConsequentialExecutionAction(request.requestedAction) === true
```

Non-consequential actions such as READ_FILE and GIT_READ do NOT acquire logical-operation
claims merely because an idempotency store is present. This is the final F1 freeze-blocker
correction (commit `f226a06ece467012d556245e285cc43508365fb3`).

Tests prove:

- distinct READ_FILE operations in one governed context may both execute
- GIT_READ is not duplicate-blocked by store presence
- consequential duplicate protection remains unchanged

## Consequential Operations

The canonical set is defined once in contracts
(`CONSEQUENTIAL_INVOCATION_ACTIONS`) and consumed via
`isConsequentialExecutionAction()` — the single source of classification truth:

- WRITE_FILE
- CREATE_FILE
- DELETE_FILE
- RUN_COMMAND
- NETWORK_ACCESS
- GIT_COMMIT
- GIT_PUSH

Consequential operations require trusted idempotency protection. If the idempotency store is
missing when a consequential action requires it, the request fails closed
(`IDEMPOTENCY_STORE_MISSING`) before any productive execution. Claims are not released merely
because execution timed out or ended in an unknown state (`TIMED_OUT_UNKNOWN` /
`FAILED_UNKNOWN` remain locked).

## Non-Blocking Independent Review Findings

### F2 — Provider Registry Review Coverage

Classification: non-blocking review limitation. The provider-registry implementation was not
included in Claude's compact review package, so helper internals were not independently
source-verified there. This does NOT mean a defect was proven.

### F3 — auditSafe() Unused

Classification: low / hardening follow-up. `auditSafe()` exists but is not currently enforced
at audit persistence call sites.

### F4 — GIT_READ Blanket Allow

Classification: low architecture-consistency follow-up. GIT_READ is read-only and currently
unconditionally allowed by EO-01.4 policy logic rather than following the same
command/profile mechanism as other actions.

### F5 — Credential Resolution Before Idempotency Claim

Classification: low resource-amplification follow-up. Duplicate consequential attempts may
trigger credential-broker resolution before being rejected by the idempotency claim. No
confidentiality bypass was proven.

### F6 — Dead / Vestigial Compatibility Code

Classification: INFO / cleanup. Unused constants/helpers remain in the execution-policy
architecture.

### F7 — Dual Failure Surfaces

Classification: INFO / API-contract consistency. Some pre-execution fail-closed paths throw
Errors, while post-execution runtime failures normalize to
`GovernedCapabilityInvocationResult`. Both remain fail-closed.

## Accepted V0.1 Follow-Ups

These are NOT unresolved EO-01.5 baseline blockers:

1. Persistent / atomic GovernedInvocationIdempotencyStore implementation.
2. Adapter cancellation / AbortSignal support.
3. Authoritative invocation-side artifactReference.
4. Authoritative NETWORK_ACCESS target identity.
5. Authoritative GIT_COMMIT / GIT_PUSH revision or target identity.
6. GitHub CI/check workflow for independent remote validation.
7. Cleanup of dead compatibility mappings/helpers.
8. Consider auditSafe enforcement at the audit persistence boundary.
9. Consider moving credential resolution after successful idempotency claim, if compatible
   with future runtime architecture.
10. Review GIT_READ EO-01.4 allow semantics for consistency.
11. Normalize pre-execution vs post-execution failure contract in a future API consistency
    block if beneficial.

## Not Proven by EO-01.5 Baseline

EO-01.5 does NOT claim to prove:

- persistent distributed-store atomicity
- restart-safe claims
- multi-instance idempotency
- adapter process cancellation
- full DLP
- correctness of every future resolver implementation
- authoritative artifact identity
- authoritative network target identity
- authoritative git revision identity
- CI enforcement

These belong to later runtime / infrastructure / integration layers.

## Security Invariants

1. Routing != execution authority.
2. Caller cannot self-select authoritative ExecutionProfile.
3. Caller cannot inject PolicyDecision.
4. Caller cannot inject authoritative HumanGateBinding.
5. Human approval reference alone grants no authority.
6. Human approval is context/action scoped.
7. Credentials remain behind the trusted broker boundary.
8. Provider eligibility is revalidated at execution time.
9. Productive adapter execution has exactly one controlled call site.
10. Runtime failures remain fail-closed.
11. Illegal lifecycle states cannot become valid terminal results.
12. Credential references cannot leave normalized result/audit surfaces.
13. Consequential duplicate prevention follows logical operation identity, not invocationId.
14. Provider/profile/assurance changes do not reset consequential idempotency.
15. Irrelevant target fields cannot alter logical-operation identity.
16. READ_FILE/GIT_READ are not incorrectly subject to consequential idempotency claims.
17. Timeout does not release unknown consequential-operation ownership.
18. Late adapter completion does not create a second EO-01.5 completion path.

## Non-Goals

EO-01.5 does not implement:

- provider ranking
- provider fallback
- distributed idempotency persistence
- generic shell runtime
- process-level cancellation
- domain capabilities
- complete artifact/revision authority architecture
- CI infrastructure

## Historical Review Evidence

- Reviewed WIP snapshot before merge: `aa2ef0043c98ebbe0ab246fb343d2c684a0e533f`
- Merged pre-F1 main: `8b5578b173761f08d8b58cf41477eddc0f9acbdc`
- Final F1-corrected main: `f226a06ece467012d556245e285cc43508365fb3`

Independent review history:

1. Initial final review: EO-01.5 BASELINE FREEZE — FAIL (blocker: F1)
2. F1 correction: restrict idempotency claims to consequential actions
3. Independent delta re-review: F1 FIXED
4. Final independent verdict: EO-01.5 BASELINE FREEZE — PASS WITH NON-BLOCKING FINDINGS
