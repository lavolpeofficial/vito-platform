---
record_type: architecture-review
record_id: VITO-OB-002-AR-001
system: vito-platform
subsystem: operator-bridge
subject: VITO-OB-002
reviewer: GPT-5.6 Sol
reviewed_revision: 1
reviewed_branch: design/vito-operator-bridge-v0.2-first-real-flow
reviewed_baseline: b5abe3f8e3b105a2db28b307a29990135e795729
verdict: PASS
severity_ceiling: NONE
created: 2026-08-28
---

# VITO-OB-002 Architecture Review

## Verdict

**PASS — implementation authorized within the documented scope.**

No BLOCKER, HIGH, or MEDIUM architecture defect was identified.

## Review findings

The proposed smoke harness remains a pure client of the existing Operator Bridge. It does not introduce an alternate execution authority and explicitly prohibits direct OpenCode, sandbox, filesystem, SCM, repository-selection, executable-selection, and policy-selection control.

The canonical documentation-only mutation is appropriately low-risk while still proving the operationally important path: authenticated ingress, OperatorTask persistence, routing, governed execution, real coding-provider invocation, ephemeral worktree mutation, exact change-set capture, cleanup, durable result retrieval, and idempotent replay.

The design correctly preserves server-side authority for provider, repository, base ref, executable, execution policy, sandbox configuration, credentials, and workspace location.

The separation between credential-independent CI and an explicit credential-dependent real-provider acceptance run is correct. The real-provider run must not become a required general CI dependency while it relies on local OpenCode credentials or machine-specific executables.

The OB-003 boundary is correctly separated. External ChatGPT connectivity is not required to prove the VITO-side execution roundtrip and must not be introduced opportunistically into OB-002.

## Implementation constraints

The builder must preserve the following constraints exactly:

1. Do not modify core runtime behavior unless a genuine blocker is discovered. If a core runtime change is required, stop and report the blocker for architecture review.
2. The harness must call only `POST /v1/operator/tasks` and `GET /v1/operator/tasks/:taskId` for execution/result retrieval. It must never execute OpenCode, Bubblewrap, git mutation, or repository writes directly.
3. Bearer credentials are environment-only. They must not be accepted as CLI arguments, written to disk, included in thrown/logged request objects, or echoed in diagnostic output.
4. Polling must be bounded by both interval and total timeout. Transport errors, malformed responses, unknown statuses, timeout, or contract violations fail closed.
5. Acceptance must use the actual routed `CODE_BUILD` provider. Mocks/test doubles may test harness logic but do not satisfy the real-flow gate.
6. The positive proof must accept only the intended changed path: `docs/engineering/operator-bridge-real-flow-proof.md`. Any additional changed path fails acceptance.
7. The returned patch must be non-empty and consistent with the intended file addition while the sensitive payload is still retained. The harness must not weaken retention or attempt recovery after expiry.
8. `workspaceDisposition` must be `CLEANED` before the real-flow acceptance is considered successful.
9. Exact replay must reuse byte/semantic-equivalent request content and the same `requestId`; conflicting replay must use the same `requestId` with a materially different payload and must fail without a second provider execution.
10. The final acceptance report must contain sanitized evidence only: no JWT, Authorization header, environment dump, credentials, or unbounded raw provider output.

## Clarifications for implementation

The harness should derive terminal success/failure from the repository's authoritative `OperatorTaskStatus` contract rather than inventing status strings. If the contract is not conveniently exported to the script runtime, the builder may define a narrow local mapping only after verifying the current contract values and must add a test that fails when an unexpected terminal status is returned.

For idempotency evidence, equality of task identity/result lineage plus existing server-side idempotency behavior is sufficient; the harness must not attempt to inspect internal execution tables directly. Existing PostgreSQL/E2E tests remain authoritative for internal no-duplicate guarantees.

Workspace cleanup evidence is the governed result contract (`workspaceDisposition: CLEANED`) plus the existing worker tests. The harness must not reach into the workspace root to inspect or delete worktrees itself, because doing so would cross the client/execution trust boundary.

## Authorization

Implementation may proceed on a dedicated feature branch based on this reviewed design branch. Scope is limited to the smoke harness, minimal package command wiring, harness tests where practical, and the sanitized acceptance report produced after the real-provider run.
