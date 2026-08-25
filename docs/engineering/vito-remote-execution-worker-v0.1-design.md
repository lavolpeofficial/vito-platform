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

## DECISION: Minimal v0.1 Scope vs. Deferred Features

### v0.1 Scope (This Block)

| Feature | Rationale |
|---------|-----------|
| Workspace provisioning (git worktree per job) | Required for isolation |
| Bubblewrap sandbox execution (sole production implementation) | Production OS-level isolation |
| Bounded output capture | Required for audit + result return |
| Timeout enforcement | Required by execution budget |
| Memory/resource limits | Required to prevent resource exhaustion |
| Idempotent job execution | Required by failure recovery architecture |
| Job cancellation support | Required by governance contract |
| Audit event emission | Required by observability contract |
| Integration with existing `GovernedProviderAdapter` interface | No new abstraction needed |
| Repository registry with explicit allowlist | Required by sandbox permission matrix |
| Trusted repository/base-ref resolution (server-side only) | Prevents agent-controlled repo/ref injection |
| Network DENIED (unconditional in v0.1) | Simplifies sandbox, eliminates egress risk |
| Execution result return to VITO | Control plane needs structured result |

### Deferred to Next Blocks

| Feature | Block | Dependency |
|---------|-------|------------|
| Live log streaming | Should-have | WebSocket/SSE infrastructure |
| Multi-worker distribution | Should-have | Worker pool, queue system |
| Credential broker injection | Must-have | Durable credential store, secret rotation |
| Docker sandbox technology | Should-have | Container runtime, image management |
| Controlled network egress | Should-have | Network policy engine, provider endpoint registry |
| Separate builder/reviewer worktrees per AL-4 | Should-have | WorkflowStepRun -> dispatch binding |
| GPU resource scheduling | Nice-to-have | Multi-node worker pool |
| Dynamic sandbox policy | Nice-to-have | Runtime policy evaluation |
| Artifact store (full stdout/diff/test reports) | Must-have | Artifact persistence schema |
| HumanGateResolver (release approval) | Must-have | Durable HumanGate persistence |
| WorkflowStepRun -> AgentWorkforce dispatch binding | Must-have | Workflow runtime integration |
| n8n webhook workflow package | Must-have | n8n workflow definition |
| Provider health probes for local agents | Should-have | Health check mechanism |
| Cost/token budget enforcement per execution | Should-have | Usage metering |
| Retry authorization token | Should-have | Workflow runtime integration |

---

## Tests Required

### Unit Tests: RepositoryRegistry

| # | Test | Assertion |
|---|------|-----------|
| RR-01 | resolve returns registered repository | `resolve('vito-platform')` returns `{ cloneUrl, allowedBaseRefs }` |
| RR-02 | resolve returns null for unknown repositoryId | `resolve('unknown')` returns `null` |
| RR-03 | isBaseRefAllowed accepts registered ref | `isBaseRefAllowed('vito-platform', 'main')` returns `true` |
| RR-04 | isBaseRefAllowed rejects unregistered ref | `isBaseRefAllowed('vito-platform', 'attacker-branch')` returns `false` |
| RR-05 | disabled repository cannot be resolved | Disabled entry returns `null` |

### Unit Tests: WorkspaceProvisioner

| # | Test | Assertion |
|---|------|-----------|
| WP-01 | provision creates worktree at expected path | `workspaceHandle.worktreePath` matches `{root}/orgs/{hash}/runs/{runId}/{role}/` |
| WP-02 | provision rejects repository not in registry | `REPOSITORY_NOT_ALLOWED` error, no git operation |
| WP-03 | provision rejects base ref not in allowlist | `BASE_REF_NOT_ALLOWED` error, no git operation |
| WP-04 | provision resolves ref to exact SHA | `workspaceHandle.baseSha` is valid 40-char hex SHA |
| WP-05 | reviewer worktree source is read-only | `chmod` attempt on source files fails |
| WP-06 | builder worktree allows writes within allowed paths | `writeFile` succeeds inside allowed paths |
| WP-07 | builder worktree denies writes outside allowed paths | `writeFile` fails outside allowed paths |
| WP-08 | cleanup removes worktree | Directory no longer exists after cleanup |
| WP-09 | cleanup rejects if unresolved artifacts exist | Cleanup blocked if artifacts not durably stored |
| WP-10 | cleanup audits WORKSPACE_CLEANED event | AuditService.create called with correct event |
| WP-11 | repository substitution rejected | Different repositoryId than EngineeringTask -> rejected |
| WP-12 | base-ref injection rejected | Ref not in allowedBaseRefs -> rejected |

### Unit Tests: SandboxExecutor

| # | Test | Assertion |
|---|------|-----------|
| SE-01 | execute runs agent in isolated namespace | Process runs, exits, returns result |
| SE-02 | execute captures stdout within bounds | `result.stdout.length <= MAX_CAPTURE_BYTES` |
| SE-03 | execute captures stderr within bounds | `result.stderr.length <= MAX_CAPTURE_BYTES` |
| SE-04 | execute enforces timeout | Agent exceeding timeout gets SIGTERM then SIGKILL, `result.timedOut === true` |
| SE-05 | execute detects OOM | `result.oomKilled === true` when memory limit exceeded |
| SE-06 | execute does not inherit host env | Agent cannot read VITO database credentials |
| SE-07 | execute provides only allowlisted env vars | `HOME`, `TMPDIR`, `PATH` present; no VITO server vars |
| SE-08 | execute fails for executable outside trusted root | `TRUSTED_EXECUTABLE_REQUIRED` error |
| SE-09 | execute with unshare-net blocks all network | Agent cannot reach any external endpoint |
| SE-10 | execute records integrity hash in result | `result.integrityHash` matches `TrustedExecutable.integrityHash` |
| SE-11 | 'none' technology rejected in production | `NODE_ENV=production` + `technology=none` -> `SANDBOX_DOWNGRADE_DENIED` |
| SE-12 | 'none' technology accepted in development | `NODE_ENV=development` + `technology=none` -> execution proceeds |
| SE-13 | missing Bubblewrap binary fails closed | `bwrap` not found -> `SANDBOX_UNAVAILABLE` error, no execution |

### Unit Tests: OutputCapture

| # | Test | Assertion |
|---|------|-----------|
| OC-01 | captures full output under limit | Complete output preserved |
| OC-02 | rolling window truncates old data | Only last N bytes preserved when over limit |
| OC-03 | handles binary data without crash | No exception on non-UTF8 chunks |
| OC-04 | handles rapid write bursts | No data loss under concurrent writes |

### Unit Tests: RemoteExecutionWorkerService

| # | Test | Assertion |
|---|------|-----------|
| RE-01 | executeSandboxed orchestrates full lifecycle | provision -> execute -> capture -> cleanup -> result |
| RE-02 | fails closed on repo not in registry | `REPOSITORY_NOT_ALLOWED` error, no execution |
| RE-03 | fails closed on unknown executable | `EXECUTABLE_NOT_TRUSTED` error |
| RE-04 | idempotent dispatch returns cached result | Second call with same key returns identical result |
| RE-05 | logical operation mismatch fails closed | `IDEMPOTENCY_CONFLICT` error |
| RE-06 | cancellation terminates agent | `CANCELLED` status, SIGKILL sent |
| RE-07 | timeout produces TIMED_OUT with audit | `TIMED_OUT` status, audit event emitted |
| RE-08 | execution failure produces FAILED with audit | `FAILED` status, non-zero exit code recorded |
| RE-09 | successful execution produces SUCCEEDED with audit | `SUCCEEDED` status, artifacts referenced |
| RE-10 | cleanup always runs even on failure | Worktree removed in all terminal states |

### Integration Tests

| # | Test | Assertion |
|---|------|-----------|
| IT-01 | full dispatch through `AgentWorkforceService` -> worker -> sandboxed execution | End-to-end: dispatch -> routed -> provisioned -> executed -> result |
| IT-02 | sandbox isolation prevents workspace escape | Agent process cannot read files outside worktree |
| IT-03 | sandbox isolation prevents network access | Agent cannot reach external URLs (network unshared) |
| IT-04 | sandbox timeout enforcement | Long-running agent killed within timeout |
| IT-05 | idempotency across VITO API restart | Same idempotency key returns cached result |
| IT-06 | cancellation via VITO API | Cancel signal terminates running agent |

### Security Tests (Mandatory Before Production)

| # | Test | Assertion |
|---|------|-----------|
| ST-01 | path traversal outside worktree rejected | `../../etc/passwd` access fails |
| ST-02 | denied path wins over broader allowed path | Denied path matches reject even if parent is allowed |
| ST-03 | commit attempt rejected before release gate | Git commit inside sandbox fails |
| ST-04 | push attempt rejected before release gate | Git push inside sandbox fails |
| ST-05 | secrets path read rejected | `/etc/shadow` or VITO secrets path access fails |
| ST-06 | unrestricted HOME read rejected | Agent HOME does not expose host user files |
| ST-07 | missing/unknown policy fails closed | Unknown provider type -> `EXECUTABLE_NOT_TRUSTED` |
| ST-08 | timeout enforced | Agent killed within configured timeout |
| ST-09 | policy decision written to audit chain | Every policy outcome produces audit event |
| ST-10 | environment does not leak VITO secrets | Agent process env contains zero VITO server variables |
| ST-11 | binary integrity hash is verifiable | Hash at resolution matches hash at execution |
| ST-12 | worktree isolation prevents cross-tenant access | Agent cannot access sibling org directories |
| ST-13 | sandbox downgrade blocked in production | `VITO_SANDBOX_TECHNOLOGY=none` + production -> FAIL CLOSED |
| ST-14 | repository substitution rejected | Agent cannot provision workspace for unregistered repository |
| ST-15 | base-ref injection rejected | Agent cannot provision workspace at unregistered ref |
| ST-16 | attempt-number replay returns cached result | Re-dispatch with completed attemptNo -> cached, no re-execution |
| ST-17 | environment allowlist enforced | Agent process env contains only allowlisted keys |
| ST-18 | network fully denied | Agent cannot establish any outbound connection |

---

## Architectural Conflicts with PR #17

### No Blocking Conflicts

All conflicts are minor and resolvable:

| Area | Conflict | Severity | Resolution |
|------|----------|----------|------------|
| Adapter implementation | PR #17's `HeadlessLocalAgentAdapter` uses bare `spawn()` | Medium | Replace `spawn()` call with `RemoteExecutionWorkerService.executeSandboxed()` |
| Module wiring | PR #17 registers adapter in `GovernedRuntimeModule` | Low | Add `RemoteExecutionWorkerModule` as import; update adapter factory |
| Logger removal | PR #17 removes `Logger` from `GovernedRuntimeService` | Low | Re-add `Logger` for debugging; non-structural |
| German JSDoc removal | PR #17 removes German documentation comments | Low | Accept; no structural impact |
| `governedInputPayload` extension | PR #17 adds `governedInputPayload` and `executionBudget` to `TrustedGovernedWorkspaceFileOperation` | None | Worker reuses this extension |
| Environment variable config | PR #17 uses `VITO_TRUSTED_LOCAL_EXECUTABLES` and `VITO_TRUSTED_AGENT_LAUNCHER_ROOT` | None | Worker reuses same env vars; adds `VITO_SANDBOX_TECHNOLOGY` |

---

## Configuration

```bash
# Existing (from PR #17)
export GOVERNED_WORKSPACE_ROOT=/srv/vito/workspaces
export VITO_TRUSTED_AGENT_LAUNCHER_ROOT=/usr/local/lib/vito-agent-launchers
export VITO_TRUSTED_LOCAL_EXECUTABLES='{"opencode":"/usr/local/lib/vito-agent-launchers/opencode"}'

# New for Remote Execution Worker
export VITO_SANDBOX_TECHNOLOGY=bubblewrap        # 'bubblewrap' (production) | 'none' (dev/test only)
export VITO_SANDBOX_DEFAULT_TIMEOUT_MS=300000    # 5 minutes default
export VITO_SANDBOX_MAX_MEMORY_BYTES=2147483648  # 2GB default
export VITO_SANDBOX_MAX_CPU_TIME_MS=600000       # 10 minutes default
export VITO_SANDBOX_MAX_OUTPUT_BYTES=262144      # 256KB stdout/stderr cap

# Only for development/testing — NEVER set in production
# export VITO_SANDBOX_ALLOW_UNSANDBOXED=true

# Trusted repository registry (for workspace provisioning)
# Format: JSON array of { repositoryId, cloneUrl, allowedBaseRefs }
export VITO_REPOSITORY_REGISTRY='[
  {
    "repositoryId": "vito-platform",
    "cloneUrl": "git@github.com:lavolpeofficial/vito-platform.git",
    "allowedBaseRefs": ["main", "develop"]
  }
]'
```

---

## Summary

The Remote Execution Worker is the **production isolation boundary** that PR #17's `HeadlessLocalAgentAdapter` explicitly deferred. It slots into the existing `GovernedProviderAdapter` interface without changing any upstream contract, dispatch surface, or trust chain.

1. **Reuses** PR #17's `AgentWorkforceService`, `TrustedLocalExecutableResolver`, `GovernedInvocationService`, provider routing, policy evaluation, audit, and idempotency
2. **Replaces** bare `spawn()` with Bubblewrap-sandboxed execution (sole v0.1 production path)
3. **Adds** git worktree-based workspace provisioning with per-run isolation
4. **Enforces** repository registry with explicit allowlist, trusted base-ref resolution, network denied, resource limits, and output capture
5. **Preserves** all existing VITO invariants: Capability != Provider, fail-closed, audit chain, idempotency
6. **Defers** credential broker, artifact store, HumanGateResolver, Docker technology, network egress, live streaming, multi-worker distribution to subsequent blocks

This is a documentation-only architecture review checkpoint. No implementation code was modified. No implementation approval is implied.
