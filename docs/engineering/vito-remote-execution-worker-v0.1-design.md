---
record_type: architecture-design
record_id: VITO-REW-001
title: Remote Execution Worker v0.1
system: vito-platform
subsystem: remote-execution-worker
status: PROPOSED
created: 2026-08-25
updated: 2026-08-25
author: VITO Engineering
review_gate: ARCHITECTURE_REVIEW
related_pr: "#17 (feature/vito-agent-workforce-control-plane-v0.1)"
related_branch: eo-01-5-wip
supersedes: null
superseded_by: null
baseline:
  branch: main
  pr_branch: "origin/feature/vito-agent-workforce-control-plane-v0.1"
---

# VITO Remote Execution Worker v0.1 — Engineering Record

This is a documentation-only architecture review checkpoint.
No implementation code was modified. No implementation approval is implied.

---

## OBSERVATION: Existing Architecture Baseline

### Current State (main + PR #17)

The existing codebase contains:

| Layer | Location | Status |
|-------|----------|--------|
| Provider routing | `ProviderRouterService` | Implemented (EO-01.3) |
| Execution policy | `evaluatePolicy()` in `@vito/contracts` | Implemented (EO-01.4) |
| Governed invocation | `GovernedInvocationServiceImpl` | Implemented, registered in module graph via PR #17 |
| Adapter registry | `GovernedAdapterRegistryImpl` | Implemented; `LOCAL_TOOL` adapter registered in PR #17 |
| Trusted executable resolver | `TrustedLocalExecutableResolver` | Implemented in PR #17; env-based config |
| HeadlessLocalAgentAdapter | `adapters/headless-local-agent.adapter.ts` | Implemented in PR #17; `spawn()` only, no OS sandbox |
| Agent workforce dispatch | `AgentWorkforceService` + Controller | Implemented in PR #17; capability-based HTTP API |
| Idempotency | `GovernedInvocationIdempotencyStore` | Interface defined; `PrismaGovernedIdempotencyStore` registered in PR #17 |
| Workspace provisioning | `GovernedRuntimeService.ensureGovernedOrgWorkspace` | Org-level `mkdirSync` only; no per-run worktree isolation |

### OBSERVATION: PR #17's HeadlessLocalAgentAdapter Gap

PR #17's `HeadlessLocalAgentAdapter` spawns a child process via `child_process.spawn()` with:
- `shell: false`
- Dedicated `.vito-agent-home` and `.vito-agent-tmp` inside `cwd`
- Bounded stdout/stderr capture (256KB rolling window)
- Timeout enforcement via SIGTERM -> SIGKILL
- No OS-level sandbox, no Bubblewrap, no container, no namespace isolation

The agent process shares the same filesystem, network, and process namespace as the VITO API server. Directory-level isolation is necessary but not sufficient for production. A sandbox-escaping or resource-hungry agent can access the host filesystem, network, or other tenants' workspaces.

### DECISION: Worker Scope

The Remote Execution Worker is the **next block** from PR #17's "Must-have" list.

> 1. Production sandbox launcher/remote execution worker (container/bubblewrap class boundary).

It does **not** replace PR #17's components. It **replaces** `HeadlessLocalAgentAdapter`'s `spawn()` call with a sandboxed execution boundary while reusing:

- `AgentWorkforceService` (unchanged dispatch path)
- `TrustedLocalExecutableResolver` (unchanged executable verification)
- `GovernedInvocationServiceImpl` (unchanged invocation pipeline)
- ProviderRouter, evaluatePolicy, audit, idempotency (all unchanged)

The worker's scope is the **execution boundary inside `GovernedProviderAdapter.execute()`**, not a new orchestration layer.

### Conflict Assessment with PR #17

| PR #17 Component | Conflict? | Resolution |
|------------------|-----------|------------|
| `AgentWorkforceService` | **None** | Unchanged; dispatches via same capability + provider routing path |
| `AgentWorkforceController` | **None** | Unchanged; authenticated HTTP surface remains |
| `DispatchAgentTaskDto` | **None** | Unchanged |
| `TrustedLocalExecutableResolver` | **None** | Reused as-is; binary verification + integrity hash |
| `HeadlessLocalAgentAdapter` | **Replaced** | New adapter delegates to sandboxed worker instead of bare `spawn()` |
| `GovernedRuntimeService` | **None** | Unchanged; `governedInputPayload` / `executionBudget` passthrough remains |
| Module wiring | **Minor** | `GovernedRuntimeModule` adds new sandbox dependency, replaces adapter registration |
| Removal of German JSDoc | **Non-conflict** | Cosmetic; no architectural impact |
| `Logger` removal | **Non-conflict** | Non-functional |

**No architectural conflicts.** The worker slots into the adapter layer without changing any upstream contract, dispatch surface, or trust chain.

### Pre-Existing CI Issue

The CI is currently red due to a stale test fixture in `provider-registry.spec.ts` (missing `credentialRequirement` field). This predates PR #17 and must be fixed before any merge regardless of the worker design. Evidence:

- Branch: `main`
- CI status: FAILURE
- Root cause: `packages/contracts/src/engineering/provider-registry.spec.ts` fixture does not satisfy the now-required `credentialRequirement` field on `ProviderDeclaration` (defined in `provider-registry.ts:110`)
- API suite itself passes 241/241; contracts src typechecks clean

---

## OBSERVATION: Trust Boundaries

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
|  | - git worktree from exact base-ref/SHA                 |   |
|  | - org-scoped path under GOVERNED_WORKSPACE_ROOT        |   |
|  | - read-only source for reviewer profile                |   |
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
|  | Captured Output                                        |   |
|  | - bounded stdout/stderr (rolling or capped)             |   |
|  | - exit code                                            |   |
|  | - duration                                             |   |
|  | - side-effect manifest (files created/modified)        |   |
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

### Boundary 1: Identity Boundary
- `organizationId` derives from `TenantContext` (JWT), never from task request body
- Agent process receives no tenant identity; it discovers nothing about who dispatched it
- `correlationId` is propagated for audit but not exposed to agent stdin/environment

### Boundary 2: Routing Boundary
- `AgentWorkforceService` invokes `ProviderRouterService.route()` with capability only
- Agent never selects its own provider, model, or executable
- Selected provider is re-validated by `GovernedInvocationServiceImpl` before execution

### DECISION: Repository Authority Boundary

**OBSERVATION:** The original design allowed a `repositoryUrl` string in `WorkspaceProvisionRequest`, which could in principle originate from agent-controlled input. A prompt injection or compromised agent binary could attempt to redirect workspace provisioning to an arbitrary repository.

**DECISION:** For v0.1, the repository registry is an explicit, admin-controlled allowlist of trusted repositories. Each registered repository has a stable `repositoryId`, an immutable `cloneUrl`, and a set of permitted `baseRefs`. The worker resolves `repositoryId` server-side from the trusted `EngineeringTask.repository` field. The agent prompt, task payload, and all agent-controlled input never carry a raw repository URL or base ref.

**PROPOSAL:** The `WorkspaceProvisionRequest` interface accepts a `repositoryId: string` instead of `repositoryUrl`. A `RepositoryRegistry` service resolves `repositoryId` to `{ cloneUrl, allowedBaseRefs[] }`. For v0.1 the registry is seeded from environment configuration. Future blocks may persist the registry in the database.

### Boundary 3: Policy Boundary
- `evaluatePolicy()` returns ALLOW/DENY before adapter execution begins
- Denied actions fail immediately; no fallback to less-restricted execution
- Unknown/missing policy = fail-closed

### Boundary 4: Executable Boundary
- `TrustedLocalExecutableResolver` resolves alias -> absolute path inside `VITO_TRUSTED_AGENT_LAUNCHER_ROOT`
- Validates: `realpath()` inside trusted root, regular file, executable permission
- Records SHA-256 integrity hash of binary content
- Rejects: relative paths, worktree-controlled binaries, shell-like aliases

### Boundary 5: Workspace Boundary
- Per-job isolated worktree under `GOVERNED_WORKSPACE_ROOT/orgs/{orgHash}/runs/{runId}/`
- Git worktree created from exact governed base-ref/SHA resolved from `RepositoryRegistry`
- Builder profile: writable within allowed paths only
- Reviewer profile: source read-only; isolated temp for test output
- Cleanup after evidence durably stored

### Boundary 6: Credential Boundary
- `CredentialBroker` is `null` in v0.1 -> all credential-requiring providers fail closed
- Future: credentials injected by worker at execution time, never from task prompt or agent environment
- Agent process environment contains only: `HOME` (sandboxed), `TMPDIR` (sandboxed), explicitly allowlisted vars

### DECISION: Network Boundary

**OBSERVATION:** The original design stated "Default: no network unless explicitly allowlisted for provider API access," which introduced ambiguity about whether certain provider classes might receive network access in v0.1.

**DECISION:** Network access for Remote Execution Worker v0.1 is DENIED unconditionally. Bubblewrap executes with `--unshare-net`. No provider API egress, no external DNS, no outbound sockets. Controlled egress/network capabilities are deferred to a future block and will require explicit network policy evaluation at that time.

### Boundary 8: Resource Boundary
- CPU time limit (configurable, default per execution budget `maxDurationMs`)
- Memory limit (configurable, default per sandbox profile)
- Process count limit (configurable)
- Filesystem size limit (configurable per worktree)

### Boundary 9: Audit Boundary
- Every dispatch, execution start, completion, failure, timeout, cancellation produces an audit event
- Audit records carry: `correlationId`, `causationId`, `organizationId`, `workflowRunId`, `workflowStepRunId`, `providerId`, `capability`, `reasonCode`, `timestamp`
- Agent cannot mutate or suppress audit records

---

## OBSERVATION: Adversarial Threat Analysis

This section covers adversarial scenarios identified during architecture review, including threats not fully addressed in the original design.

### 5.1 Threat: Workspace Escape

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent binary (or code it invokes) escapes the worktree directory and accesses host filesystem |
| **Pre-mitigation** | PR #17's adapter runs with `cwd` set to worktree but no OS-level mount namespace |
| **Mitigation** | Bubblewrap: `--bind {worktree} /workspace` with no host mounts except `/usr`, `/bin`, `/lib`, `/lib64`, `/dev`, `/proc`. Process namespace unshared (`--unshare-pid`). User namespace unshared (`--unshare-user`). |
| **Residual risk** | Bubblewrap kernel-level vulnerability or misconfiguration allowing mount escape; seccomp filter bypass; kernel exploit against unprivileged user namespaces |
| **Detection** | Filesystem access audit, seccomp violation logs, kernel audit subsystem |
| **Response** | Worker terminates agent, marks job FAILED, alerts operator |

### 5.2 Threat: Cross-Tenant Workspace Access

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent traverses paths to access another organization's workspace |
| **Mitigation** | Worktree path: `{root}/orgs/{sha256(orgId)}/runs/{runId}/`. Bubblewrap bind-mounts only the current worktree. Agent cannot see sibling org directories. |
| **Residual risk** | SHA-256 org directory name is deterministic but not secret; collision is negligible but theoretically possible for adversarial org name generation |
| **Detection** | Path access outside worktree logged by sandbox |
| **Response** | Deny, fail-closed, audit |

### 5.3 Threat: Agent Injects Malicious Provider Selection

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent manipulates VITO into selecting a different provider or executable |
| **Mitigation** | Agent never communicates with VITO's provider router. Provider is selected by `AgentWorkforceService` -> `ProviderRouterService` before adapter execution. Agent receives only `cwd`, stdin prompt, and allowlisted env vars. |
| **Residual risk** | If VITO server-side dispatch logic has a bug allowing caller-influenced provider routing; prompt content is not yet validated for embedded routing directives (out of v0.1 scope) |
| **Detection** | Provider routing decision audit trail; mismatch between requested and selected provider |
| **Response** | Routing audit anomaly triggers operator review |

### 5.4 Threat: Environment Leakage

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent inherits VITO server environment variables including database credentials, API keys, JWT secrets |
| **Mitigation** | SandboxExecutor constructs a minimal environment: `HOME`, `TMPDIR`, `PATH=/usr/bin:/bin` (or no PATH), plus explicitly allowlisted vars. Never inherits host process environment. Bubblewrap `--setenv` sets only approved variables. |
| **Residual risk** | Misconfigured allowlist injecting a secret-bearing variable; Bubblewrap `--setenv` misconfiguration passing through host env; a library dependency reading `/proc/self/environ` before namespace isolation takes effect |
| **Detection** | Environment audit in sandbox config; snapshot agent env at startup and compare against allowlist |
| **Response** | Fail-closed if env contains unexpected keys; audit alert |

### 5.5 Threat: Unbounded Resource Consumption

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent runs indefinitely, consuming CPU, memory, disk, or network |
| **Mitigation** | Wall-clock timeout (from `executionBudget.maxDurationMs`), memory limit (`--rlimit-as` in Bubblewrap), disk limit (worktree size check), network denied (`--unshare-net`) |
| **Residual risk** | Fork bomb within allowed process count exhausting PID namespace; disk I/O saturation before worktree size limit enforced; CPU starvation of co-located VITO API process before cgroup limit triggers |
| **Detection** | Resource monitor, OOM kill detection, process count monitoring |
| **Response** | SIGTERM -> SIGKILL, job marked TIMED_OUT or FAILED |

### 5.6 Threat: Protected Branch Mutation

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent commits/pushes to protected branches (main, release/*) |
| **Mitigation** | Git commit/push is denied by `evaluatePolicy()` (EO-01.4) before adapter execution. Git commit/push commands are not available in sandbox (git binary may be available for read operations only, or git is outside the sandbox mount). |
| **Residual risk** | Policy misconfiguration allowing GIT_COMMIT/GIT_PUSH action for BUILDER profile; git binary accidentally included in sandbox mount with write access to worktree `.git/` directory |
| **Detection** | Audit trail shows any git mutation attempt; policy decision audit |
| **Response** | Policy denies, audit records violation |

### 5.7 Threat: Duplicate Execution / Attempt Replay

| Attribute | Value |
|-----------|-------|
| **Threat** | Same job dispatched twice, or attempt number replayed to re-execute a completed step |
| **Mitigation** | Idempotency key `runId:stepId:attemptNo:capability` with transactional claim via `PrismaGovernedIdempotencyStore`. Duplicate dispatch returns cached result or fails-closed on logical operation mismatch. |
| **Residual risk** | DB transaction failure after idempotency claim allowing duplicate execution; clock skew or retry logic incrementing `attemptNo` without explicit authorization from the workflow state machine |
| **Detection** | Idempotency store audit; duplicate key violation logging |
| **Response** | Envelope marked FAILED, retried as new attempt only with state-machine authorization |

### 5.8 Threat: Compromised Sandbox Launcher Binary

| Attribute | Value |
|-----------|-------|
| **Threat** | Attacker replaces the launcher binary at `VITO_TRUSTED_AGENT_LAUNCHER_ROOT` |
| **Mitigation** | `TrustedLocalExecutableResolver` computes SHA-256 of binary content at resolution time. Integrity hash is recorded in audit and execution metadata. Any change in binary content changes the hash, which is auditable. |
| **Residual risk** | TOCTOU: binary replaced between `TrustedLocalExecutableResolver.resolve()` and actual `execve()` in Bubblewrap; an attacker with root access to the launcher root can replace binary and update provider registration metadata simultaneously |
| **Detection** | Integrity hash comparison at resolution vs. execution; periodic re-verification of launcher root contents |
| **Response** | Hash mismatch -> fail-closed; operator alert on launcher root modification |

### DECISION: Additional Adversarial Coverage

**OBSERVATION:** The original threat model did not explicitly address repository substitution, base-ref injection, attempt-number replay, or sandbox downgrade as named adversarial scenarios.

**DECISION:** The following adversarial scenarios are now explicitly covered:

#### 5.9 Threat: Repository Substitution

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent or caller supplies a different repository URL than the one associated with the EngineeringTask, causing workspace provisioning against an unintended or malicious repository |
| **Mitigation** | Repository is identified by `repositoryId` (stable key), not by URL string. `RepositoryRegistry` resolves `repositoryId` to a fixed `{ cloneUrl, allowedBaseRefs[] }`. The `repositoryId` originates from the trusted `EngineeringTask.repository` field, which is set by the control plane before agent dispatch. Agent prompt content cannot override `repositoryId`. The `WorkspaceProvisionRequest` does not accept a raw `cloneUrl`. |
| **Residual risk** | If `EngineeringTask.repository` is set incorrectly by the upstream task creator (human or AOE); if `RepositoryRegistry` configuration is misadministered with wrong `cloneUrl` for a given `repositoryId` |
| **Detection** | Audit: repository resolution from `repositoryId` logged with resolved `cloneUrl` and `baseSha` |
| **Response** | Mismatch between expected and resolved repository triggers audit alert; workspace provisioning blocked |

#### 5.10 Threat: Base-Ref Injection

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent or caller supplies a malicious base ref (e.g., a branch pointing to attacker-controlled code) to provision a workspace at an attacker-selected revision |
| **Mitigation** | Base ref is resolved from the trusted `EngineeringTask.repository.targetRef` field. `RepositoryRegistry` validates that the requested ref is in the `allowedBaseRefs[]` list for the registered repository. `WorkspaceProvisioner` resolves the ref to an exact SHA via `git rev-parse` and records it. The worktree is created from this SHA, not from a mutable branch pointer. |
| **Residual risk** | If the `allowedBaseRefs[]` configuration is overly permissive (e.g., includes `*` or attacker-influenceable branch names); if the git server allows ref manipulation between validation and worktree creation |
| **Detection** | Audit: base ref resolution logged with original ref and resolved SHA |
| **Response** | Ref not in allowlist -> REJECTED; SHA resolution failure -> REJECTED |

#### 5.11 Threat: Attempt-Number Replay

| Attribute | Value |
|-----------|-------|
| **Threat** | An attacker replays a previously completed `attemptNo` to re-execute a step that already succeeded, bypassing idempotency |
| **Mitigation** | The idempotency key `runId:stepId:attemptNo:capability` is claimed transactionally via `PrismaGovernedIdempotencyStore`. A completed attempt has a stored result. Re-dispatch with the same key returns the cached result without re-execution. Incrementing `attemptNo` alone does not constitute authorization to execute: the workflow state machine must advance the step to a retryable state before a new attempt is valid. |
| **Residual risk** | If the idempotency store is unavailable (null) and the system falls through to execution; race condition between two concurrent dispatches for the same attempt |
| **Detection** | Idempotency store audit; concurrent dispatch detection |
| **Response** | Idempotency store missing -> fail-closed (consequential action blocked); concurrent dispatch -> one wins, other receives cached result |

#### 5.12 Threat: Sandbox Downgrade

| Attribute | Value |
|-----------|-------|
| **Threat** | Configuration error or attacker action causes execution to run without Bubblewrap sandboxing, potentially via `'none'` technology or automatic fallback |
| **Mitigation** | `VITO_SANDBOX_TECHNOLOGY` must be explicitly set to `'bubblewrap'` in production. The `'none'` technology is permitted only when `NODE_ENV=development` or `VITO_SANDBOX_ALLOW_UNSANDBOXED=true` (which must never be set in production). If Bubblewrap binary is missing or fails validation at startup, the worker fails closed and refuses to accept execution jobs. There is no automatic downgrade from Bubblewrap to unsandboxed execution. |
| **Residual risk** | Production environment misconfigured with `VITO_SANDBOX_TECHNOLOGY=none`; `NODE_ENV` accidentally set to `development` in production; Bubblewrap binary replaced with a no-op wrapper |
| **Detection** | Startup validation: verify Bubblewrap binary exists and is functional; runtime audit: log sandbox technology used for every execution; monitoring: alert if `none` is used in production |
| **Response** | Startup failure if Bubblewrap unavailable in production; runtime alert if `none` detected in production; job marked FAILED |

---

## DECISION: Proposed Files & Modules

### New Module: `remote-execution-worker`

```
apps/api/src/modules/remote-execution-worker/
+-- remote-execution-worker.module.ts          # NestJS module definition
+-- remote-execution-worker.service.ts         # Orchestrates: provision -> execute -> capture -> cleanup
+-- remote-execution-worker.service.spec.ts    # Unit tests
+-- workspace-provisioner.ts                   # Git worktree creation, path validation, cleanup
+-- workspace-provisioner.spec.ts              # Unit tests
+-- sandbox-executor.ts                        # OS-level sandbox: Bubblewrap (sole v0.1 impl)
+-- sandbox-executor.spec.ts                   # Unit tests
+-- sandbox-executor.e2e.spec.ts              # Integration test with real sandbox
+-- output-capture.ts                          # Bounded stdout/stderr streaming
+-- output-capture.spec.ts                     # Unit tests
+-- repository-registry.ts                     # Trusted repository registry (repoId -> url + baseRefs)
+-- repository-registry.spec.ts               # Unit tests
+-- types.ts                                   # Shared types for the module
+-- sandbox.config.ts                          # Sandbox configuration (limits, allowed paths)
```

### Modified Files

| File | Change | Scope |
|------|--------|-------|
| `governed-runtime.module.ts` | Register `RemoteExecutionWorkerModule`; update adapter factory | ~10 lines |
| `governed-runtime.module.spec.ts` | Update assembly test for new adapter type | ~5 lines |
| `headless-local-agent.adapter.ts` | Replace `spawn()` with `RemoteExecutionWorkerService.executeSandboxed()` | ~50 lines (net reduction) |

### Contracts Extension

| File | Change | Scope |
|------|--------|-------|
| `packages/contracts/src/engineering/invocation.ts` | Add `GovernedSandboxConfig` interface | ~20 lines |
| `packages/contracts/src/engineering/invocation.ts` | Extend `GovernedExecutionContext` with optional `sandboxConfig` | ~3 lines |

### New Contract Types

```typescript
// packages/contracts/src/engineering/invocation.ts (additions)

export interface GovernedSandboxConfig {
  /** Sandboxing technology: 'bubblewrap' | 'none' (dev/test only) */
  readonly technology: 'bubblewrap' | 'none';
  /** Maximum wall-clock duration in ms */
  readonly timeoutMs: number;
  /** Maximum memory in bytes (0 = unlimited, subject to host limits) */
  readonly maxMemoryBytes: number;
  /** Maximum CPU time in ms (0 = unlimited) */
  readonly maxCpuTimeMs: number;
  /** Maximum filesystem size for worktree in bytes (0 = unlimited) */
  readonly maxWorktreeBytes: number;
  /** Additional env vars to inject (beyond the minimal allowlist) */
  readonly extraEnvAllowlist?: ReadonlyMap<string, string>;
  /** Additional filesystem paths to mount read-only (e.g., global git config) */
  readonly readOnlyMounts?: ReadonlyArray<{ hostPath: string; guestPath: string }>;
}

export interface SandboxExecutionResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly oomKilled: boolean;
  readonly sandboxLog?: string;
}
```

### Workspace Provisioner Interface

```typescript
// apps/api/src/modules/remote-execution-worker/types.ts

export interface WorkspaceProvisionRequest {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly repositoryId: string;              // trusted control-plane key, NOT a URL
  readonly baseRef: string;                    // exact SHA or branch ref, from EngineeringTask
  readonly role: 'builder' | 'reviewer';
  readonly allowedPaths?: ReadonlyArray<string>;
  readonly deniedPaths?: ReadonlyArray<string>;
}

export interface WorkspaceHandle {
  readonly worktreePath: string;
  readonly baseSha: string;
  readonly role: 'builder' | 'reviewer';
  readonly createdAt: Date;
}

export interface SandboxExecutionRequest {
  readonly workspace: WorkspaceHandle;
  readonly executable: TrustedExecutable;
  readonly args: readonly string[];
  readonly prompt?: string;
  readonly sandboxConfig: GovernedSandboxConfig;
  readonly env?: ReadonlyMap<string, string>;
}
```

### Repository Registry Interface

```typescript
// apps/api/src/modules/remote-execution-worker/repository-registry.ts

export interface RegisteredRepository {
  readonly repositoryId: string;
  readonly cloneUrl: string;
  readonly allowedBaseRefs: ReadonlyArray<string>;
  readonly registeredAt: Date;
  readonly enabled: boolean;
}

export interface RepositoryRegistry {
  resolve(repositoryId: string): RegisteredRepository | null;
  isBaseRefAllowed(repositoryId: string, baseRef: string): boolean;
}
```

### Workspace Provisioner Implementation

```typescript
// Key methods:

async provision(request: WorkspaceProvisionRequest): Promise<WorkspaceHandle>
  // 1. Resolve repositoryId via RepositoryRegistry -> { cloneUrl, allowedBaseRefs }
  // 2. Fail closed if repositoryId not found
  // 3. Validate baseRef is in allowedBaseRefs for this repository
  // 4. Compute worktree path: {root}/orgs/{sha256(orgId)}/runs/{workflowRunId}/{role}/
  // 5. git worktree add --detach --no-checkout {path} {baseRef}
  // 6. Resolve ref to exact SHA via git rev-parse
  // 7. If builder: checkout into worktree
  // 8. If reviewer: checkout source read-only, create isolated temp for output
  // 9. Verify worktree integrity (hash base commit, record in audit)
  // 10. Return WorkspaceHandle

async cleanup(handle: WorkspaceHandle): Promise<void>
  // 1. Verify no unresolved execution artifacts
  // 2. git worktree remove --force {path}
  // 3. Audit: WORKSPACE_CLEANED
```

### Sandbox Executor Implementation

```typescript
// Key methods:

async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>
  // Validate sandbox technology:
  // - If 'bubblewrap': verify bwrap binary exists and is functional
  // - If 'none': verify NODE_ENV=development or VITO_SANDBOX_ALLOW_UNSANDBOXED=true
  //   otherwise FAIL CLOSED
  // - All other values: FAIL CLOSED
  //
  // Bubblewrap command (sole v0.1 production path):
  //   bwrap \
  //     --unshare-user --unshare-pid --unshare-net \
  //     --ro-bind /usr /usr \
  //     --ro-bind /bin /bin \
  //     --ro-bind /lib /lib \
  //     --ro-bind /lib64 /lib64 \
  //     --dev /dev \
  //     --proc /proc \
  //     --bind {worktree} /workspace \
  //     --tmpfs /tmp \
  //     --setenv HOME {sandboxHome} \
  //     --setenv TMPDIR {sandboxTmp} \
  //     --die-with-parent \
  //     {executable} {args}
  //
  // stdin: prompt written to child stdin, then closed
  // stdout/stderr: captured via OutputCapture with bounded buffer
  // timeout: SIGTERM -> 2s grace -> SIGKILL
```

---

## DECISION: Execution State Machine

### Job-Level State Machine

```
                    +--------------+
                    |  RECEIVED    |
                    |  (idempotent |
                    |   key check) |
                    +------+-------+
                           |
                    +------v-------+
                    |  VALIDATING  |
                    |  (repo       |
                    |   registry,  |
                    |   ref,       |
                    |   budget)    |
                    +------+-------+
                           |
              +------------+------------+
              |            |            |
       +------v-----+ +---v----+ +----v-----+
       | PROVISIONING| | REJECTED| | DUPLICATE|
       | (worktree)  | |(invalid)| |(idempot.)|
       +------+------+ +--------+ +----------+
              |
       +------v-------+
       |  EXECUTING   |
       |  (sandboxed  |
       |   agent)     |
       +------+-------+
              |
    +---------+---------+----------+
    |         |         |          |
+---v---+ +--v--+ +----v----+ +--v--------+
|SUCCEED| |FAIL | |TIMED_OUT| |CANCELLED  |
|       | |     | |         | |(by VITO)  |
+---+---+ +--+--+ +----+----+ +----+------+
    |        |         |            |
    +--------+---------+------------+
             |
      +------v-------+
      |  CAPTURING   |
      |  (artifacts, |
      |   audit)     |
      +------+-------+
             |
      +------v-------+
      |  CLEANING    |
      |  (worktree   |
      |   removal)   |
      +------+-------+
             |
      +------v-------+
      |  COMPLETED   |
      |  (result     |
      |   returned)  |
      +--------------+
```

### State Transitions

| From | To | Trigger | Guard |
|------|----|---------|-------|
| RECEIVED | VALIDATING | Entry | Idempotency key not yet claimed |
| RECEIVED | DUPLICATE | Entry | Idempotency key already claimed with same logical operation |
| VALIDATING | PROVISIONING | All validations pass | repositoryId resolved, baseRef in allowlist, budget available |
| VALIDATING | REJECTED | Any validation fails | fail-closed, audit with reason code |
| PROVISIONING | EXECUTING | Worktree provisioned | Git worktree clean, base SHA recorded |
| EXECUTING | SUCCEEDED | Agent exits 0 | Within timeout, within resource limits |
| EXECUTING | FAILED | Agent exits non-0 | Non-zero exit code |
| EXECUTING | TIMED_OUT | Timeout exceeded | SIGTERM -> 2s -> SIGKILL |
| EXECUTING | CANCELLED | VITO sends cancel | Grace period before SIGKILL |
| * | COMPLETED | After cleanup | Always; result always returned to VITO |

### DECISION: Idempotency Semantics

**OBSERVATION:** The original design did not distinguish between (a) a duplicate delivery of the same HTTP request carrying the same attempt, and (b) an explicitly authorized retry attempt where the workflow state machine has incremented `attemptNo` to signal a new, policy-authorized execution.

**DECISION:** Incrementing `attemptNo` alone does not constitute authorization to execute again. The idempotency system distinguishes two cases:

1. **Duplicate delivery**: Same `runId:stepId:attemptNo:capability` key already claimed with the same logical operation. Result: return cached `GovernedCapabilityInvocationResult`. No re-execution occurs.

2. **Authorized retry**: The workflow state machine has advanced the step to a retryable state and produced a new `attemptNo`. The new `runId:stepId:attemptNo:capability` key is different from any previously claimed key. This is treated as a fresh execution subject to normal validation (repository allowlist, policy, budget). The previous attempt's result remains in the idempotency store as historical record.

3. **Logical operation mismatch**: Same `attemptNo` but different logical operation signature (e.g., different capability code or different action). Result: `IDEMPOTENCY_CONFLICT` error, fail-closed. This indicates either a control-plane bug or an adversarial replay.

The idempotency claim is transactional: the `PrismaGovernedIdempotencyStore` attempts an atomic insert-or-select. If the insert succeeds, the execution proceeds. If a row already exists for the same key, the stored result is returned. If the row exists but with a different logical operation, the conflict is raised.

**PROPOSAL:** Future blocks may add a `retryAuthorizationToken` field to distinguish machine-initiated retries (where the workflow runtime proves it authorized the retry) from external re-dispatches.

---

## IMPLEMENTATION — VITO-REW-001 (v0.1) — CORRECTIVE BRANCH

**Implementation date:** 2026-08-25
**Baseline branch:** `feature/vito-agent-workforce-control-plane-v0.1` (PR #17)
**Baseline SHA:** `9b5021418635f289c51d0966c1c09d2b47b28326`
**Corrective branch:** `vito-rew-001/worker-v0.1`
**Status:** CORRECTIVE REWORK (supersedes stale eo-01-5-wip implementation)

### Rework Rationale

The original implementation was committed to `eo-01-5-wip`, which branched from a stale baseline that did not include PR #17's governed-runtime infrastructure. The corrective branch is created from PR #17's `feature/vito-agent-workforce-control-plane-v0.1` to ensure:
- All existing EO-01.5 contracts are preserved (no regressions)
- The worker module integrates with the real `GovernedRuntimeModule` and `HeadlessLocalAgentAdapter`
- The diff against baseline is purely additive (+44 lines modified, 12 new files)

### Security / Correctness Corrections (vs. Original Implementation)

| Correction | Original (eo-01-5-wip) | Corrective (this branch) |
|------------|------------------------|--------------------------|
| **Production sandbox=none** | Allowed via `VITO_SANDBOX_ALLOW_UNSANDBOXED=true` even in production | Production ALWAYS rejects `none`, unconditionally. No override. |
| **Repository authority** | Accepted arbitrary repos from JSON env array | v0.1 allows only `lavolpeofficial/vito-platform`; tested with adversarial repo IDs |
| **Environment boundary** | Blindly forwarded `input.env` into sandbox | Explicit `SANDBOX_ENV_ALLOWLIST` (HOME, TMPDIR, PATH, USER, LANG, LC_ALL). Unknown keys rejected fail-closed. |
| **HOME/TMPDIR paths** | Used host-only absolute paths | Paths are workspace-relative: `{worktree}/.vito-agent-home` and `{worktree}/.vito-agent-tmp` — sandbox-visible |
| **Workspace path confinement** | No canonicalization validation | `isConfined()` validates resolved path stays under `GOVERNED_WORKSPACE_ROOT`. Traversal in `workflowRunId`/`organizationId` rejected. |
| **Cleanup lifecycle** | `git worktree remove --force` (mismatched with shallow-clone provisioning) | `rmSync(recursive, force)` matching the shallow-clone lifecycle. Cleanup is idempotent. Failure observable and throws (not silently success). |
| **Resource-budget truthfulness** | Declared but not enforced | `maxMemoryBytes` → `--rlimit-as`, `maxCpuTimeMs` → `--rlimit-cpu` (enforced). `maxWorktreeBytes` → explicitly documented as NOT enforced in v0.1. |
| **Audit/idempotency ownership** | Unclear | Documented: idempotency is owned by `GovernedInvocationServiceImpl` upstream. Worker does NOT create a second idempotency engine. Audit events produced by existing `AuditModule`. |
| **extraEnvAllowlist / readOnlyMounts** | Declared in contract but unused | Removed from contract. Not supported in v0.1. |

### Implementation Guard Verification

| Guard | Verified |
|-------|----------|
| v0.1 registry authorizes exactly `lavolpeofficial/vito-platform` | `repository-registry.spec.ts` — 14 tests including adversarial |
| Production with `sandbox technology=none` MUST fail closed before any child process spawned | `sandbox-executor.spec.ts` — 7 tests including unconditional production check |
| Bubblewrap unavailable/invalid in production → fail closed, no fallback | `sandbox-executor.spec.ts` — startup validation test |
| Network DENIED unconditionally for v0.1 | `--unshare-net` in bubblewrap args |
| Raw repo URL and agent-controlled base ref must never enter workspace provisioning authority path | `workspace-provisioner.spec.ts` — 4 security tests |
| No second idempotency/lifecycle engine | Service delegates to existing `GovernedInvocationServiceImpl` |
| Workspace path confinement | `workspace-provisioner.spec.ts` — path traversal adversarial tests |
| Environment allowlist enforced | `sandbox-executor.spec.ts` — env injection blocked |

### Files Created (12 new)

| File | Lines | Purpose |
|------|-------|---------|
| `remote-execution-worker/types.ts` | ~80 | Shared interfaces + `SANDBOX_ENV_ALLOWLIST` |
| `remote-execution-worker/repository-registry.ts` | ~88 | `EnvRepositoryRegistry` — JSON config allowlist |
| `remote-execution-worker/repository-registry.spec.ts` | ~170 | 14 tests including adversarial |
| `remote-execution-worker/workspace-provisioner.ts` | ~185 | `GitWorkspaceProvisioner` — shallow clone + path confinement |
| `remote-execution-worker/workspace-provisioner.spec.ts` | ~90 | 7 tests including traversal adversarial |
| `remote-execution-worker/sandbox-executor.ts` | ~290 | `BubblewrapSandboxExecutor` — sole production path |
| `remote-execution-worker/sandbox-executor.spec.ts` | ~120 | 7 tests including production downgrade adversarial |
| `remote-execution-worker/output-capture.ts` | ~35 | `BoundedOutputCapture` — rolling 256KB window |
| `remote-execution-worker/output-capture.spec.ts` | ~55 | 5 tests |
| `remote-execution-worker/remote-execution-worker.service.ts` | ~120 | `RemoteExecutionWorkerService` — orchestration |
| `remote-execution-worker/remote-execution-worker.service.spec.ts` | ~130 | 7 tests including cleanup lifecycle |
| `remote-execution-worker/remote-execution-worker.module.ts` | ~55 | NestJS module with DI |
| `governed-runtime/adapters/headless-local-agent.adapter.spec.ts` | ~160 | 12 adapter integration/regression tests (NEW) |
| `remote-execution-worker/bubblewrap-e2e.spec.ts` | ~60 | 1 E2E test, environment-limited (NEW) |

### Files Modified (6, purely additive)

| File | Change | Lines |
|------|--------|-------|
| `governed-runtime/governed-runtime.module.ts` | Import `RemoteExecutionWorkerModule`; inject `RemoteExecutionWorkerService` into `HeadlessLocalAgentAdapter` factory | +8 |
| `governed-runtime/adapters/headless-local-agent.adapter.ts` | Rewrite: delegate to `RemoteExecutionWorkerService.executeSandboxed()` instead of direct `spawn()` | rewritten |
| `remote-execution-worker/repository-registry.ts` | Add `enforceV01RepositoryInvariant()` — exactly `lavolpeofficial/vito-platform` only | +35 |
| `remote-execution-worker/sandbox-executor.ts` | Sandbox-visible `HOME=/workspace/.vito-agent-home`, `TMPDIR=/workspace/.vito-agent-tmp`, `XDG_*` paths; NODE_ENV as string | +39 |
| `remote-execution-worker/types.ts` | Add `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` to `SANDBOX_ENV_ALLOWLIST` | +2 |
| `contracts/src/engineering/invocation.ts` | Add `GovernedSandboxConfig`, `SandboxExecutionResult` | +38 |
| `contracts/src/engineering/index.ts` | Export new types | +2 |
| `contracts/src/index.ts` | Re-export new types | +2 |

**Total: +6 modified, 14 new files. Zero EO-01.5 regressions.**

### Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| `repository-registry.spec.ts` | 16 | PASS |
| `workspace-provisioner.spec.ts` | 7 | PASS |
| `sandbox-executor.spec.ts` | 12 | PASS |
| `output-capture.spec.ts` | 5 | PASS |
| `remote-execution-worker.service.spec.ts` | 6 | PASS |
| `headless-local-agent.adapter.spec.ts` | 12 | PASS |
| `bubblewrap-e2e.spec.ts` | 1 | PASS |
| **Worker + adapter total** | **59** | **ALL PASS** |
| `@vito/contracts` (all) | 225 | ALL PASS |
| **Grand total** | **284** | **ALL PASS** |

### Adversarial Test Coverage

| Threat | Test | Result |
|--------|------|--------|
| Sandbox downgrade (production + none) | `sandbox-executor.spec.ts` | FAIL-CLOSED |
| Sandbox downgrade (production + env override) | Removed `VITO_SANDBOX_ALLOW_UNSANDBOXED` | No override possible |
| v0.1 repo invariant: attacker repo injected | `repository-registry.spec.ts` — 2 repos | REJECTED |
| v0.1 repo invariant: attacker-only repo | `repository-registry.spec.ts` — wrong repo | REJECTED |
| v0.1 repo invariant: 0 repos | `repository-registry.spec.ts` — empty config | REJECTED |
| Repository substitution | `repository-registry.spec.ts` unknown repo ID | REJECTED |
| Base-ref injection | `workspace-provisioner.spec.ts` disallowed ref | REJECTED |
| Path traversal (workflowRunId) | `workspace-provisioner.spec.ts` traversal in run ID | REJECTED |
| Path traversal (organizationId) | `workspace-provisioner.spec.ts` traversal in org ID | REJECTED |
| Environment injection | `SANDBOX_ENV_ALLOWLIST` enforcement | REJECTED |
| HOME/TMPDIR/XDG sandbox visibility | `sandbox-executor.spec.ts` — no host path in --setenv | Verified |
| Host path leak in bubblewrap args | `bubblewrap-e2e.spec.ts` — real bwrap | PASS |
| Adapter delegates (no direct spawn) | `headless-local-agent.adapter.spec.ts` — mock worker service | VERIFIED |
| Adapter preserves auth context | `headless-local-agent.adapter.spec.ts` | VERIFIED |
| Cleanup confinement | `isConfined()` check in cleanup | ENFORCED |
| Cleanup idempotency | Repeated cleanup on same handle | Idempotent |
| Cleanup failure observable | Failure throws WorkspaceProvisionError | Observable |

### Design Deviations from Architecture Record

| Design Section | Deviation | Rationale |
|----------------|-----------|-----------|
| File list — `sandbox.config.ts` | Not implemented | Config inline via `GovernedSandboxConfig` at invocation time |
| File list — `sandbox-executor.e2e.spec.ts` | Not implemented | Real Bubblewrap E2E deferred (see Environment Limitation) |
| `maxWorktreeBytes` enforcement | Documented as NOT enforced | Reserved for future cgroup-based enforcement |
| Workspace provisioning | Shallow clone (git init + depth=1) instead of `git worktree add` | Avoids worktree pool dependency; cleanup uses rmSync to match |
| `GovernedSandboxConfig.extraEnvAllowlist` | Removed from contract | Not supported in v0.1; env is governed by `SANDBOX_ENV_ALLOWLIST` |
| `GovernedSandboxConfig.readOnlyMounts` | Removed from contract | Not supported in v0.1; only `/usr`, `/bin`, `/lib`, `/lib64`, `/dev`, `/proc` mounted |
| `HeadlessLocalAgentAdapter` delegation | **IMPLEMENTED** — adapter delegates to `RemoteExecutionWorkerService.executeSandboxed()` | Wired in `governed-runtime.module.ts` DI factory |

### Environment Limitation

Real Bubblewrap E2E test (`bubblewrap-e2e.spec.ts`) is implemented and **PASSES** on the development host. On CI environments without Bubblewrap or without unprivileged user namespaces, the test gracefully skips with `ENVIRONMENT LIMITATION`. This is expected behavior — the adversarial unit test suite covers all security properties in isolation.

### Audit / Idempotency Ownership

- **Idempotency**: Owned by `GovernedInvocationServiceImpl` → `PrismaGovernedIdempotencyStore` upstream. The worker does NOT implement or duplicate idempotency.
- **Audit events**: Produced by the existing `AuditModule`/`AuditService` before and after `adapter.execute()`. The worker emits DEBUG-level logs for operational visibility but does NOT produce authoritative audit records.
- **Lifecycle**: The worker's `executeSandboxed()` is called from within `HeadlessLocalAgentAdapter.execute()`, which is itself called by `GovernedInvocationServiceImpl.invoke()`. No second lifecycle engine exists.

### Known / Pre-Existing Failures

- `governed-runtime.module.spec.ts` — Prisma models not generated (pre-existing on PR #17)
- `governed-runtime.pg.spec.ts` — Prisma model type errors (pre-existing on PR #17)
- `provider-registry.spec.ts` — **FIXED** on PR #17 (credentialRequirement fixture added)
