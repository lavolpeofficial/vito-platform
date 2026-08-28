---
record_type: architecture-design
record_id: VITO-OB-002
title: "Operator Bridge v0.2 — First Real Operator Flow"
system: vito-platform
subsystem: operator-bridge
status: PROPOSED
created: 2026-08-28
updated: 2026-08-28
author: VITO Engineering
review_gate: ARCHITECTURE_REVIEW
related_pr: null
related_branch: design/vito-operator-bridge-v0.2-first-real-flow
supersedes: null
superseded_by: null
baseline:
  branch: main
  sha: "b5abe3f8e3b105a2db28b307a29990135e795729"
revision: 1
---

# VITO Operator Bridge v0.2 — First Real Operator Flow

## 1. Purpose

VITO-OB-001 established the governed machine ingress and proved the Operator Bridge implementation under unit, PostgreSQL, auth/application E2E, CI, merge, and post-merge CI gates.

VITO-OB-002 is the first operational proof that the bridge can execute one real engineering task through the production-shaped execution path and return a durable governed change-set.

The milestone is intentionally narrow. It does **not** add autonomous merge, autonomous push, general-purpose shell authority, repository selection from the external caller, or broad ChatGPT connectivity.

The target proof is:

```text
Operator client
  -> POST /v1/operator/tasks
  -> OperatorTask
  -> AgentWorkforceService
  -> ProviderRouter
  -> GovernedRuntime
  -> GovernedInvocation
  -> HeadlessLocalAgentAdapter
  -> RemoteExecutionWorker
  -> OpenCode-compatible local provider
  -> Bubblewrap sandbox
  -> repository worktree mutation
  -> changed-files + exact binary patch capture
  -> workspace cleanup
  -> GET /v1/operator/tasks/:taskId
  -> governed result
```

The first real run is successful only if the task is executed by the actual configured local coding provider, produces a bounded repository change inside the governed workspace, and VITO returns the resulting change-set without bypassing any existing policy or sandbox boundary.

---

## 2. Strategic Boundary

### 2.1 What OB-002 proves

OB-002 proves that VITO can be **used to build**, not merely built itself.

It validates, in one end-to-end operational path:

- machine identity authentication;
- bridge-only scope enforcement;
- tenant binding;
- idempotent OperatorTask creation;
- deterministic capability routing;
- governed runtime authorization;
- trusted workspace provisioning;
- real headless coding-agent invocation;
- network-isolated sandbox execution;
- repository mutation inside the ephemeral worktree;
- exact change-set capture;
- cleanup of the ephemeral workspace;
- durable task/result retrieval.

### 2.2 What OB-002 does not prove

OB-002 does **not** claim the full external flow `ChatGPT -> VITO` is production-ready. This repository cannot make the ChatGPT product call a private/local VITO endpoint by itself.

Direct ChatGPT dispatch requires a later ingress/connectivity milestone, expected as **VITO-OB-003**, covering a remotely reachable HTTPS endpoint plus a supported authenticated client/connector boundary.

OB-002 therefore proves the complete **VITO-side execution roundtrip** first. This avoids coupling external connectivity work to runtime correctness.

---

## 3. Existing Contract Reused Without Expansion

OB-002 MUST use the existing v0.1 routes unchanged:

```http
POST /v1/operator/tasks
GET  /v1/operator/tasks/:taskId
```

The POST request remains intent-level only:

```json
{
  "requestId": "<client-generated UUID>",
  "capabilityCode": "CODE_BUILD",
  "prompt": "<bounded engineering instruction>",
  "assuranceLevel": "<optional trusted hint>",
  "budget": {
    "maxDurationMs": 300000,
    "maxTokens": 100000,
    "maxCostMinorUnits": 0
  }
}
```

No external caller may provide executable path, shell command, provider ID, repository URL, base ref, filesystem path, environment variables, credentials, execution policy, or sandbox flags. Those remain server-owned decisions established by OB-001.

---

## 4. First Real Task

The canonical first task MUST be deliberately low-risk, deterministic, reviewable, and easy to verify.

Create exactly one documentation-only marker file in the governed repository worktree:

```text
docs/engineering/operator-bridge-real-flow-proof.md
```

Expected semantic content:

```markdown
# Operator Bridge Real Flow Proof

This file was created by a governed VITO operator task.
```

The provider instruction MUST prohibit unrelated changes.

A documentation-only mutation exercises real repository writing and exact patch capture without introducing application, schema, dependency, or migration risk.

---

## 5. Operator Client Harness

OB-002 SHOULD add a small repository-local smoke harness rather than requiring hand-written curl sequences.

Recommended location:

```text
scripts/operator-bridge-real-flow.mjs
```

The harness is an **operator client**, not an execution authority.

It may read `VITO_BASE_URL` and `VITO_OPERATOR_TOKEN` from environment, generate a UUID requestId, submit the canonical `CODE_BUILD` task, poll the existing GET endpoint at a bounded interval, stop on terminal status or timeout, print a concise summary, verify that only the intended proof file changed, verify that a non-empty governed patch is returned while sensitive retention permits it, and exit non-zero on any invariant violation.

The harness MUST NOT execute OpenCode directly, call the sandbox directly, write into the target repository itself, apply the returned patch, create commits or branches, push to GitHub, merge anything, print or persist the Bearer token, or accept provider/executable/repository/base-ref overrides.

---

## 6. Credential Handling

The existing OB-001 machine identity model remains authoritative.

Required external environment:

```text
VITO_BASE_URL=<HTTPS or local test endpoint>
VITO_OPERATOR_TOKEN=<JWT for MEMBER machine identity with machineScope=vito-bridge>
```

The token MUST remain outside repository files and command output. The harness MUST redact Authorization-bearing errors and MUST NOT echo process environment.

If the service account is missing, suspended, has a stale tokenVersion, is not a machine identity, or does not have exact scope `vito-bridge`, the run MUST fail closed.

---

## 7. Real Provider Requirement

A successful OB-002 acceptance run MUST use the actual configured headless coding provider used by VITO's `CODE_BUILD` capability. Mocks, fake executors, test doubles, and direct filesystem writes do not satisfy the operational acceptance gate.

The run must traverse the real production-shaped modules:

```text
OperatorBridgeService
  -> AgentWorkforceService
  -> ProviderRouterService
  -> GovernedRuntimeService
  -> GovernedInvocationServiceImpl
  -> HeadlessLocalAgentAdapter
  -> RemoteExecutionWorker
  -> BubblewrapSandboxExecutor
```

The existing trusted executable resolver remains authoritative. OB-002 must not introduce a caller-selectable executable path.

---

## 8. Repository and Workspace Invariants

For the acceptance run, the target repository MUST already be present in the trusted RepositoryRegistry; its base ref MUST already be allowed server-side; provisioning MUST use an ephemeral git worktree; the sandbox MUST retain network isolation; the provider MUST only see the governed worktree as writable project state; the worker MUST capture the change-set before cleanup; and cleanup MUST remove the ephemeral worktree even on provider failure or timeout.

The acceptance harness MUST NOT rely on the mutation remaining on disk after execution.

---

## 9. Result Contract and Acceptance Evidence

The terminal task result must be retrieved through the existing GET endpoint.

A PASS requires: POST returns taskId/requestId/correlationId; the exact replay of the same request resolves idempotently; terminal task status is success-equivalent; provider metadata identifies the real routed provider; `changedFiles` contains exactly the intended proof path; `patch` contains the intended addition while retained; `workspaceDisposition` is `CLEANED`; `reviewRequired` remains consistent with current policy; there are no unrelated changes; there is no credential material in stdout/stderr/patch; and a second GET returns the same durable task identity/result metadata.

Sensitive payload fields may expire under the existing retention policy. Acceptance evidence must be captured before expiry without bypassing expiry semantics.

---

## 10. Idempotency Proof

After the first successful POST, the client repeats the exact same request with the same `requestId`.

Expected result: no second provider execution, same logical OperatorTask resolution, no duplicate worktree execution, and no duplicate durable task lineage.

Then the client reuses the same `requestId` with a materially different payload.

Expected result: fail closed with the existing idempotency conflict semantics and no provider execution.

---

## 11. Failure-Path Proofs

At minimum, OB-002 should verify: missing token -> authentication failure; ordinary human MEMBER credential -> bridge denied; wrong machine scope -> bridge denied; invalid capability -> no execution; provider timeout -> terminal failure result plus cleanup; no-file-change result -> operationally valid but acceptance proof fails; unrelated changes -> harness rejects acceptance; conflicting replay -> idempotency conflict; and cross-tenant lookup -> not exposed.

Some cases may remain automated E2E tests if inducing them in the real provider is impractical. The canonical positive flow, however, must be an actual real-provider run.

---

## 12. CI Boundary

CI must continue to run the existing fail-closed Operator Bridge, PostgreSQL, E2E, build, and typecheck gates.

The real-provider acceptance run must not become a normal CI dependency if it depends on local OpenCode credentials, machine-specific executables, or paid/external model access.

Unit/E2E contract tests for the smoke harness belong in CI where practical. The real-provider run is an explicit operator acceptance command. Acceptance evidence should be recorded in a sanitized Engineering Record or dedicated acceptance report. No secrets are stored as artifacts.

---

## 13. Implementation Scope

Expected code changes are intentionally small:

```text
scripts/operator-bridge-real-flow.mjs
package.json                                    # one convenience command if appropriate
docs/engineering/vito-operator-bridge-v0.2-first-real-flow-design.md
docs/engineering/vito-operator-bridge-v0.2-acceptance.md   # after real run
```

Core runtime changes are **not expected**.

If implementation discovers that a core runtime change is required to make the canonical real flow work, STOP and return the architectural blocker for review rather than broadening scope opportunistically.

---

## 14. Suggested Operator Command

The implementation should expose one explicit operator command, for example:

```bash
npm run operator-bridge:real-flow
```

The exact package/workspace placement must follow the repository's existing package conventions discovered during implementation.

No command should accept a raw token as a CLI argument because shell history and process listings create avoidable leakage. Token input is environment-only.

---

## 15. Definition of Done

VITO-OB-002 is DONE only when all of the following are true:

1. Architecture review is PASS.
2. Smoke harness is implemented with bounded polling and fail-closed validation.
3. Existing CI remains green.
4. Real `CODE_BUILD` provider is used; no mock satisfies this gate.
5. Canonical documentation-only task produces exactly one intended changed file.
6. Exact governed patch is returned and reviewed before retention expiry.
7. Workspace disposition is `CLEANED`.
8. Exact replay proves idempotent resolution without duplicate execution.
9. Conflicting replay fails closed.
10. No secret/token appears in logs or result payloads.
11. Acceptance evidence is committed as a sanitized report.
12. Implementation PR passes required protected-branch checks.
13. Post-merge CI on `main` is green.

Only then should VITO receive its first product-development work package, recommended as a bounded TIMO task.

---

## 16. Follow-on Milestone

After OB-002 passes, create **VITO-OB-003 — External Operator Connectivity** for the remaining external leg:

```text
ChatGPT / approved external operator
  -> authenticated reachable VITO ingress
  -> existing Operator Bridge
  -> proven governed execution path
```

OB-003 must not weaken the machine-scope, tenant, policy, sandbox, idempotency, or change-set controls proven by OB-001/OB-002.

---

## 17. Architecture Review Questions

Reviewers should answer explicitly:

1. Does the smoke harness remain a pure client of the bridge rather than a parallel execution path?
2. Is the canonical task sufficiently low-risk while still proving a real repository mutation?
3. Is the real-provider acceptance gate clearly separated from credential-dependent CI?
4. Are secret-handling and output-redaction requirements sufficient?
5. Does the design preserve server-side authority over provider, repository, base ref, executable, policy, and sandbox?
6. Is idempotency proven at the real ingress boundary rather than only through mocks?
7. Is workspace cleanup observable enough to claim the full roundtrip?
8. Is OB-003 correctly separated so external ChatGPT connectivity does not contaminate the execution proof?

**Implementation authorization:** NONE until architecture review returns PASS.
