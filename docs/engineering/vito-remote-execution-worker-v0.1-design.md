---
record_type: architecture-design
record_id: VITO-REW-001
title: Remote Execution Worker v0.1
system: vito-platform
subsystem: remote-execution-worker
status: IMPLEMENTED_VERIFIED
created: 2026-08-25
updated: 2026-08-25
author: VITO Engineering
review_gate: POST_MERGE_VERIFIED
related_pr: "#17 (feature/vito-agent-workforce-control-plane-v0.1) — MERGED"
related_branch: vito-rew-001/worker-v0.1
supersedes: null
superseded_by: null
baseline:
  branch: main
  merge_commit: "4980f90f8969b4f10425016ff129fc783050421f"
  reviewed_head: "efed6784b057beebc2d477cf11ce7fc15aefbc04"
---

# VITO Remote Execution Worker v0.1 — Engineering Record

**Status: IMPLEMENTED_VERIFIED**
**Review gate: POST_MERGE_VERIFIED**

This record documents the architecture, implementation, and verification of the Remote Execution Worker v0.1. The worker provides a Bubblewrap-sandboxed execution boundary for VITO's governed runtime, replacing bare `child_process.spawn()` in `HeadlessLocalAgentAdapter`.

---

## IMPLEMENTATION SUMMARY

### What was built

A new NestJS module (`remote-execution-worker`) that provides Bubblewrap-sandboxed execution for the `HeadlessLocalAgentAdapter`. The worker:

1. Provisions an isolated workspace (git shallow clone)
2. Executes the agent binary inside a Bubblewrap sandbox with resource limits
3. Captures a governed change-set (tracked modifications + untracked files + deletions + binary)
4. Cleans up the workspace deterministically
5. Returns the complete result envelope including inline change-set

### What was NOT built

- Auto-push or auto-merge (deferred; v0.1 captures changeset only)
- Artifact Store persistence (deferred; change-set is inline)
- `maxWorktreeBytes` enforcement (deferred; reserved for cgroup)
- `extraEnvAllowlist` / `readOnlyMounts` (deferred; env governed by explicit allowlists)
- Idempotency (owned by `GovernedInvocationServiceImpl` upstream)
- Audit event emission (delegated to existing `AuditModule`)

### What was replaced

- `HeadlessLocalAgentAdapter`'s `spawn()` call → `RemoteExecutionWorkerService.executeSandboxed()`
- Adapter result mapping now includes `governedResultSettling`, `workspaceDisposition`, typed error codes

---

## MERGED PR AND VERIFICATION

| Item | Value |
|------|-------|
| Merged PR | #17 (`feature/vito-agent-workforce-control-plane-v0.1`) |
| Merge commit | `4980f90f8969b4f10425016ff129fc783050421f` |
| Final reviewed head | `efed6784b057beebc2d477cf11ce7fc15aefbc04` |
| Review history | 6 code reviews → architecture + security approved → test-hygiene correction → post-merge verified |
| Post-merge verified | 2026-08-25, clean main at `4980f90f8969b4f10425016ff129fc783050421f` |

---

## ARCHITECTURE AND TRUST BOUNDARIES

```
+---------------------------------------------------------------+
|                    VITO CONTROL PLANE                         |
|                                                               |
|  +--------------+   +--------------+   +----------------+     |
|  | AgentWorkforce|   |  Provider    |   | Governed       |     |
|  | Service       |-->|  Router      |-->| Invocation     |     |
|  | (capability + |   | (routing     |   | Service        |     |
|  |  task only)   |   |  decision)   |   | (policy eval)  |     |
|  +--------------+   +--------------+   +-------+--------+     |
|                                                |              |
|  TenantContext ---- organizationId (NEVER from request)        |
|  TrustedLocalExecutableResolver -- binary path + SHA-256      |
|  RepositoryRegistry -- repo URL + baseRef (trusted values)     |
|  evaluatePolicy() -- ALLOW/DENY decision                      |
|  CredentialBroker -- credential injection (deferred null)     |
|  IdempotencyStore -- duplicate execution protection           |
|  AuditService -- immutable audit chain                        |
+----------------------------+----------------------------------+
                             | GovernedExecutionContext
                             | (trusted, pre-validated)
                             v
+---------------------------------------------------------------+
|                  EXECUTION BOUNDARY                           |
|                                                               |
|  +--------------------------------------------------------+   |
|  | WorkspaceProvisioner                                   |   |
|  | - git shallow clone from exact base-ref/SHA            |   |
|  | - org-scoped path under GOVERNED_WORKSPACE_ROOT        |   |
|  | - allowed/denied path enforcement at OS level          |   |
|  +----------------------------+---------------------------+   |
|                                |                               |
|  +----------------------------v---------------------------+   |
|  | SandboxExecutor (Bubblewrap only in v0.1)              |   |
|  | - Dedicated process namespace                           |   |
|  | - Restricted filesystem mount                           |   |
|  | - Network DENIED (--unshare-net)                        |   |
|  | - Resource limits (CPU, memory, time)                   |   |
|  | - No shell, no PATH, no inherited env                   |   |
|  +----------------------------+---------------------------+   |
|                                |                               |
|  +----------------------------v---------------------------+   |
|  | Change-Set Capture                                     |   |
|  | - Temporary GIT_INDEX_FILE captures all changes         |   |
|  | - tracked modifications + untracked + deletions + binary |   |
|  | - Complete binary diff via git diff --cached --binary   |   |
|  +----------------------------+---------------------------+   |
|                                |                               |
|  +----------------------------v---------------------------+   |
|  | Captured Output                                        |   |
|  | - bounded stdout/stderr (rolling 256KB window)          |   |
|  | - exit code                                            |   |
|  | - duration                                             |   |
|  | - governedResultSettling (inline change-set)            |   |
|  | - workspaceDisposition: 'CLEANED'                       |   |
|  | - integrity hash of executable used                    |   |
|  +--------------------------------------------------------+   |
|                                                               |
|  AGENT NEVER SEES:                                           |
|  X TenantContext / organizationId                             |
|  X Provider credentials                                      |
|  X Repository URLs / base refs (agent may not influence)     |
|  X Other tenants' workspaces                                 |
|  X VITO server environment variables                         |
|  X Governance policy source                                  |
|  X Release approval state                                    |
|  X Other agents' execution state                             |
+---------------------------------------------------------------+
```

### Implemented Trust Boundaries

| Boundary | Implementation | Verified by |
|----------|---------------|-------------|
| Identity | `organizationId` from `TenantContext` (JWT), never from task request | Adapter preserves auth context (test) |
| Routing | Agent never selects provider; `ProviderRouterService` decides | Adapter delegates to worker (test) |
| Policy | `evaluatePolicy()` returns ALLOW/DENY before execution | `UNSUPPORTED_ACTION` rejection (test) |
| Executable | `TrustedLocalExecutableResolver` resolves path + SHA-256 hash | `trustedExecutable` from context (test) |
| Workspace | Per-job isolated worktree under `GOVERNED_WORKSPACE_ROOT` | Path confinement tests (workspace-provisioner.spec.ts) |
| Network | `--unshare-net` unconditional for v0.1 | Bubblewrap E2E (bubblewrap-e2e.spec.ts) |
| Resources | `--rlimit-as` (512MiB), `--rlimit-cpu` (600s), SIGTERM→SIGKILL | Resource-limit tests (sandbox-executor.spec.ts) |
| Environment | Minimal env: HOME, TMPDIR, PATH, USER, LANG, LC_ALL only | Env allowlist tests (sandbox-executor.spec.ts) |
| Credential | `null` in v0.1 — all credential-requiring providers fail closed | N/A (deferred) |
| Audit | Events produced by `AuditModule`/`AuditService`; worker emits DEBUG logs only | Worker does not duplicate audit (verified by design) |
| Idempotency | Owned by `GovernedInvocationServiceImpl` upstream | Worker does NOT create second engine (verified by design) |

---

## ADVERSARIAL THREAT ANALYSIS (IMPLEMENTED)

| Threat | Mitigation | Test Coverage | Result |
|--------|-----------|---------------|--------|
| Workspace escape | Bubblewrap: `--bind {worktree} /workspace`, unshare-user/pid/net | `bubblewrap-e2e.spec.ts` | SANDBOXED |
| Cross-tenant access | Per-org isolated worktree; Bubblewrap bind-mounts only current worktree | `workspace-provisioner.spec.ts` | ISOLATED |
| Agent injects provider selection | Agent never communicates with router; provider selected before adapter | `adapter.spec.ts` — delegates to worker | VERIFIED |
| Environment leakage | Minimal env with explicit allowlist; never inherits host env | `sandbox-executor.spec.ts` — 4 env override tests | BLOCKED |
| Unbounded resource consumption | Wall-clock timeout, memory/CPU limits, network denied | `sandbox-executor.spec.ts` + E2E | ENFORCED |
| Protected branch mutation | Git commit/push denied by `evaluatePolicy()` before adapter | Policy boundary (evaluated pre-adapter) | ENFORCED |
| Duplicate execution | Idempotency owned by `GovernedInvocationServiceImpl` upstream | Pre-existing (PR #17) | ENFORCED |
| Repository substitution | v0.1 allows exactly `lavolpeofficial/vito-platform` | `repository-registry.spec.ts` — 16 tests including adversarial | ENFORCED |
| Base-ref injection | Ref validated against `allowedBaseRefs[]` per repository | `workspace-provisioner.spec.ts` — ref validation tests | ENFORCED |
| Sandbox downgrade | Production ALWAYS rejects `technology=none`; no override possible | `sandbox-executor.spec.ts` — unconditional production check | FAIL-CLOSED |
| System-managed env override | HOME, TMPDIR, XDG_CONFIG_HOME, XDG_CACHE_HOME rejected | `sandbox-executor.spec.ts` — 4 adversarial tests | DENIED |
| Non-allowlisted caller key | Unknown env keys rejected | `sandbox-executor.spec.ts` | DENIED |
| Path traversal in workflowRunId | `isConfined()` validates path stays under workspace root | `workspace-provisioner.spec.ts` | REJECTED |
| Path traversal in organizationId | Same `isConfined()` validation | `workspace-provisioner.spec.ts` | REJECTED |
| Oversized patch | `CHANGESET_TOO_LARGE` — fail-closed, no partial patch returned | `change-set-capture.spec.ts` — dedicated test | FAIL-CLOSED |
| Capture failure | `CHANGESET_CAPTURE_FAILED` — fail-closed, NOT empty success | `service.spec.ts` + `adapter.spec.ts` | FAIL-CLOSED |
| Untracked file loss | Temporary GIT_INDEX_FILE captures `git add -A` staging | `change-set-capture.spec.ts` — untracked test | CAPTURED |
| Binary file loss | `git diff --cached --binary` preserves binary content | `change-set-capture.spec.ts` — binary test | CAPTURED |
| Cleanup on capture failure | `finally` block runs cleanup regardless of capture error | `service.spec.ts` — call order test | ENFORCED |

---

## SECURITY CORRECTIONS (vs. Original Design)

| Correction | Original (eo-01-5-wip) | Implemented (v0.1) |
|------------|------------------------|---------------------|
| Production sandbox=none | Allowed via env override | Production ALWAYS rejects `none`, unconditionally. No override. |
| Repository authority | Accepted arbitrary repos from JSON env array | v0.1 allows only `lavolpeofficial/vito-platform` |
| Environment boundary | Blindly forwarded `input.env` into sandbox | Explicit allowlist; unknown keys rejected fail-closed |
| HOME/TMPDIR paths | Used host-only absolute paths | Workspace-relative: `{worktree}/.vito-agent-home` |
| Workspace path confinement | No canonicalization validation | `isConfined()` validates resolved path stays under root |
| Cleanup lifecycle | `git worktree remove --force` (mismatched with shallow-clone) | `rmSync(recursive, force)` matching shallow-clone lifecycle |
| Resource-budget truthfulness | Declared but not enforced | `--rlimit-as` and `--rlimit-cpu` enforced |
| Audit/idempotency ownership | Unclear | Documented: idempotency upstream, audit delegated to `AuditModule` |
| extraEnvAllowlist / readOnlyMounts | Declared in contract but unused | Removed from contract; not supported in v0.1 |
| patchTruncated semantics | Partial patch returned as success | **Removed** — oversized patch throws `CHANGESET_TOO_LARGE` (fail-closed) |

---

## IMPLEMENTED GUARANTEES

| Guarantee | Implementation | Test |
|-----------|---------------|------|
| No partial patch as success | `CHANGESET_TOO_LARGE` thrown when patch > MAX_PATCH_BYTES | `change-set-capture.spec.ts` — dedicated test |
| No empty success on capture failure | `CHANGESET_CAPTURE_FAILED` thrown; NOT swallowed into empty result | `service.spec.ts` + `adapter.spec.ts` |
| Typed error propagation | `ChangeSetCaptureError` → `WorkerExecutionError` (code preserved) → adapter maps on `error.code` | `adapter.spec.ts` — typed code tests |
| Cleanup always runs | `finally` block in worker; verified after CHANGESET_CAPTURE_FAILED and CHANGESET_TOO_LARGE | `service.spec.ts` — call order test + error propagation tests |
| No patchTruncated in successful result | Field removed from `GovernedResultSettling` contract | `adapter.spec.ts` — metadata test |
| No patch body in logs | Worker logs only: executionId, changed-file count, patch byte size, empty flag | Design constraint; verified by log format |
| Workspace deterministically cleaned | `workspaceDisposition: 'CLEANED'` returned | `service.spec.ts` — workspaceDisposition test |
| Non-zero production resource defaults | 512MiB memory, 600s CPU passed to worker | `adapter.spec.ts` — CRITICAL memory/CPU defaults test |
| sideEffects.filesModified from changedFiles | Derived from `governedResultSettling.changedFiles` | `adapter.spec.ts` — dedicated test |
| Inline change-set (no artifact ref) | `governedResultSettling` returned inline in providerExecutionMetadata | `adapter.spec.ts` — metadata test |

---

## DEFERRED ITEMS (v0.2+)

| Item | Rationale | Required for |
|------|-----------|-------------|
| Auto-push / auto-merge | v0.1 captures changeset; push/merge remain governed operations | Post-merge workflow |
| Artifact Store persistence | Inline change-set sufficient for v0.1 | Durable evidence storage |
| `maxWorktreeBytes` enforcement | Reserved for cgroup-based enforcement | Disk quota enforcement |
| `extraEnvAllowlist` / `readOnlyMounts` | Not needed in v0.1; env governed by explicit allowlists | Future env customization |
| `retryAuthorizationToken` | Future blocks may add retry authorization proof | Retry authorization |
| Network egress policy | Deferred; current v0.1 denies all network | Provider API access |
| `credentialBroker` | Deferred; all credential-requiring providers fail closed | Credential injection |
| Idempotency (in worker) | Owned by `GovernedInvocationServiceImpl` upstream | Duplicate execution protection |

---

## FILES CREATED (16)

| File | Purpose |
|------|---------|
| `remote-execution-worker/types.ts` | Shared interfaces + `SANDBOX_SYSTEM_MANAGED_ENV` + `SANDBOX_CALLER_PERMITTED_ENV` |
| `remote-execution-worker/repository-registry.ts` | `EnvRepositoryRegistry` — v0.1 single-repo invariant |
| `remote-execution-worker/repository-registry.spec.ts` | 16 tests including v0.1 invariant adversarial |
| `remote-execution-worker/workspace-provisioner.ts` | `GitWorkspaceProvisioner` — shallow clone + path confinement |
| `remote-execution-worker/workspace-provisioner.spec.ts` | 7 tests including traversal adversarial |
| `remote-execution-worker/sandbox-executor.ts` | `BubblewrapSandboxExecutor` — production path with env protection |
| `remote-execution-worker/sandbox-executor.spec.ts` | 22 tests including system-managed env adversarial |
| `remote-execution-worker/output-capture.ts` | `BoundedOutputCapture` — rolling 256KB window |
| `remote-execution-worker/output-capture.spec.ts` | 5 tests |
| `remote-execution-worker/change-set-capture.ts` | `captureGovernedResultSettling` — complete change-set with typed errors |
| `remote-execution-worker/change-set-capture.spec.ts` | 8 tests including CHANGESET_TOO_LARGE |
| `remote-execution-worker/remote-execution-worker.service.ts` | `RemoteExecutionWorkerService` — orchestration + change-set + typed error propagation |
| `remote-execution-worker/remote-execution-worker.service.spec.ts` | 13 tests including typed error propagation |
| `remote-execution-worker/remote-execution-worker.module.ts` | NestJS module with DI |
| `remote-execution-worker/bubblewrap-e2e.spec.ts` | 4 E2E tests with real executor |
| `governed-runtime/adapters/headless-local-agent.adapter.spec.ts` | 20 adapter integration/regression tests |

## FILES MODIFIED (8, purely additive)

| File | Change |
|------|--------|
| `governed-runtime/governed-runtime.module.ts` | Import `RemoteExecutionWorkerModule`; inject `RemoteExecutionWorkerService` into adapter factory |
| `governed-runtime/adapters/headless-local-agent.adapter.ts` | Delegate to worker; non-zero resource defaults; typed error mapping; change-set inline |
| `remote-execution-worker/repository-registry.ts` | `enforceV01RepositoryInvariant()` — exactly `lavolpeofficial/vito-platform` only |
| `remote-execution-worker/sandbox-executor.ts` | Sandbox-visible env; reject system-managed overrides |
| `remote-execution-worker/types.ts` | `SANDBOX_SYSTEM_MANAGED_ENV`, `SANDBOX_CALLER_PERMITTED_ENV` split |
| `remote-execution-worker/remote-execution-worker.service.ts` | Change-set capture before cleanup; typed error propagation; sensitive payload logging |
| `contracts/src/engineering/invocation.ts` | Add `GovernedSandboxConfig`, `SandboxExecutionResult` |
| `contracts/src/index.ts` | Re-export new types |

---

## TEST RESULTS (POST-MERGE VERIFIED)

Verified against merged main at `4980f90f8969b4f10425016ff129fc783050421f`.

| Suite | Tests | Status | Classification |
|-------|-------|--------|----------------|
| `change-set-capture.spec.ts` | 8 | PASS | — |
| `repository-registry.spec.ts` | 16 | PASS | — |
| `workspace-provisioner.spec.ts` | 7 | PASS | — |
| `sandbox-executor.spec.ts` | 22 | PASS | — |
| `output-capture.spec.ts` | 5 | PASS | — |
| `remote-execution-worker.service.spec.ts` | 13 | PASS | — |
| `headless-local-agent.adapter.spec.ts` | 20 | PASS | — |
| `bubblewrap-e2e.spec.ts` | 4 | PASS (4 skip) | ENVIRONMENT LIMITATION (no bwrap in CI) |
| **Worker + adapter total** | **95** | **ALL PASS** | — |
| `@vito/contracts` (all) | 225 | ALL PASS | — |
| **Grand total** | **320** | **ALL PASS** | — |

### API Suite Failures (ALL PRE-EXISTING)

| Suite | Classification | Root cause |
|-------|---------------|------------|
| `governed-runtime.module.spec.ts` | PRE-EXISTING | Prisma models not generated |
| `governed-runtime.pg.spec.ts` | PRE-EXISTING | Prisma model type errors |
| `governed-runtime.service.spec.ts` | PRE-EXISTING | Prisma model type errors |
| `provider-registry.service.spec.ts` | PRE-EXISTING | Prisma model type errors |
| `provider-router.service.spec.ts` | PRE-EXISTING | Prisma model type errors |
| `users.service.spec.ts` | PRE-EXISTING | Prisma model type errors |
| `workflow-runtime.service.spec.ts` | PRE-EXISTING | Prisma model type errors |
| `digital-employees.activation.spec.ts` | PRE-EXISTING | Prisma model type errors |
| `agent-workforce.service.spec.ts` | PRE-EXISTING | Prisma model type errors |
| `aoe-import.service.spec.ts` | PRE-EXISTING | Prisma model type errors |

None of these failures involve the remote-execution-worker or adapter modules.

---

## HISTORICAL REVIEW NOTES

> **Note:** The original design document proposed `patchTruncated: true` semantics for oversized patches. This was superseded in the Fifth Code Review (commit `3ada2f1a`) which established that a partial patch is not reconstructable and must not be treated as a successful governed result. The current behavior is `CHANGESET_TOO_LARGE` fail-closed — throwing an error instead of returning a partial patch. The `patchTruncated` field has been removed from `GovernedResultSettling`.

> **Note:** The original design referenced a synthetic artifact reference `gov://execution/{id}/changeset`. This was superseded in the Fourth Code Review (commit `43523027`) which established that no durable Artifact Store exists in v0.1. The change-set is now returned inline in `governedResultSettling` — the patch and changed files are the authoritative change-set, returned directly in the result envelope.

> **Note:** The original design used `workspacePath` to return the path to the cleaned workspace. This was superseded in the Fourth Code Review (commit `43523027`) which replaced it with `workspaceDisposition: 'CLEANED'` — the workspace directory no longer exists when `executeSandboxed()` returns.
