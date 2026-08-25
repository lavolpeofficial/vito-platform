# VITO Remote Execution Worker v0.1 — Architecture & Design Document

Status: Design / review ONLY — no implementation performed.
Date: 2026-08-25
Mode: Read-only inspection + design.
Baseline: `main` + `origin/feature/vito-agent-workforce-control-plane-v0.1` (PR #17)

---

## 1. Architecture Fit Assessment

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

**PR #17's `HeadlessLocalAgentAdapter`** spawns a child process via `child_process.spawn()` with:
- `shell: false`
- Dedicated `.vito-agent-home` and `.vito-agent-tmp` inside `cwd`
- Bounded stdout/stderr capture (256KB rolling window)
- Timeout enforcement via SIGTERM -> SIGKILL
- No OS-level sandbox, no Bubblewrap, no container, no namespace isolation

**The gap**: The agent process shares the same filesystem, network, and process namespace as the VITO API server. Directory-level isolation is necessary but not sufficient for production. A sandbox-escaping or resource-hungry agent can access the host filesystem, network, or other tenants' workspaces.

### Where the Worker Fits

The Remote Execution Worker is the **next block** from PR #17's "Must-have" list:

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

---

## 2. Trust Boundaries

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
|  | SandboxExecutor                                        |   |
|  | - Bubblewrap / Docker / namespace isolation             |   |
|  | - Dedicated process namespace                           |   |
|  | - Restricted filesystem mount                           |   |
|  | - Controlled network namespace                          |   |
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
- Git worktree created from exact governed base-ref/SHA
- Builder profile: writable within allowed paths only
- Reviewer profile: source read-only; isolated temp for test output
- Cleanup after evidence durably stored

### Boundary 6: Credential Boundary
- `CredentialBroker` is `null` in v0.1 -> all credential-requiring providers fail closed
- Future: credentials injected by worker at execution time, never from task prompt or agent environment
- Agent process environment contains only: `HOME` (sandboxed), `TMPDIR` (sandboxed), explicitly allowlisted vars

### Boundary 7: Output/Network Boundary
- stdout/stderr bounded to configurable max (default 256KB rolling window or hard cap)
- Network namespace controlled by sandbox runtime (Bubblewrap: `--unshare-net` or Docker network policy)
- Default: no network unless explicitly allowlisted for provider API access

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

## 3. Proposed Files & Modules

### 3.1 New Module: `remote-execution-worker`

```
apps/api/src/modules/remote-execution-worker/
+-- remote-execution-worker.module.ts          # NestJS module definition
+-- remote-execution-worker.service.ts         # Orchestrates: provision -> execute -> capture -> cleanup
+-- remote-execution-worker.service.spec.ts    # Unit tests
+-- workspace-provisioner.ts                   # Git worktree creation, path validation, cleanup
+-- workspace-provisioner.spec.ts              # Unit tests
+-- sandbox-executor.ts                        # OS-level sandbox: Bubblewrap/Docker/namespace
+-- sandbox-executor.spec.ts                   # Unit tests
+-- sandbox-executor.e2e.spec.ts              # Integration test with real sandbox
+-- output-capture.ts                          # Bounded stdout/stderr streaming
+-- output-capture.spec.ts                     # Unit tests
+-- types.ts                                   # Shared types for the module
+-- sandbox.config.ts                          # Sandbox configuration (limits, allowed paths)
```

### 3.2 Modified Files

| File | Change | Scope |
|------|--------|-------|
| `governed-runtime.module.ts` | Register `RemoteExecutionWorkerModule`; update adapter factory | ~10 lines |
| `governed-runtime.module.spec.ts` | Update assembly test for new adapter type | ~5 lines |
| `headless-local-agent.adapter.ts` | Replace `spawn()` with `RemoteExecutionWorkerService.executeSandboxed()` | ~50 lines (net reduction) |

### 3.3 Contracts Extension

| File | Change | Scope |
|------|--------|-------|
| `packages/contracts/src/engineering/invocation.ts` | Add `GovernedSandboxConfig` interface | ~20 lines |
| `packages/contracts/src/engineering/invocation.ts` | Extend `GovernedExecutionContext` with optional `sandboxConfig` | ~3 lines |

### 3.4 New Contract Types

```typescript
// packages/contracts/src/engineering/invocation.ts (additions)

export interface GovernedSandboxConfig {
  /** Sandboxing technology: 'bubblewrap' | 'docker' | 'none' (dev only) */
  readonly technology: 'bubblewrap' | 'docker' | 'none';
  /** Maximum wall-clock duration in ms */
  readonly timeoutMs: number;
  /** Maximum memory in bytes (0 = unlimited, subject to host limits) */
  readonly maxMemoryBytes: number;
  /** Maximum CPU time in ms (0 = unlimited) */
  readonly maxCpuTimeMs: number;
  /** Maximum filesystem size for worktree in bytes (0 = unlimited) */
  readonly maxWorktreeBytes: number;
  /** Whether to unshare network namespace */
  readonly unshareNetwork: boolean;
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

### 3.5 Workspace Provisioner Interface

```typescript
// apps/api/src/modules/remote-execution-worker/types.ts

export interface WorkspaceProvisionRequest {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly repositoryUrl: string;
  readonly baseRef: string;                    // exact SHA or branch ref
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

### 3.6 Workspace Provisioner Implementation

```typescript
// Key methods:

async provision(request: WorkspaceProvisionRequest): Promise<WorkspaceHandle>
  // 1. Compute worktree path: {root}/orgs/{sha256(orgId)}/runs/{workflowRunId}/{role}/
  // 2. Validate repositoryUrl is on explicit allowlist
  // 3. Validate baseRef is a valid git ref (SHA or branch name)
  // 4. git worktree add --detach --no-checkout {path} {baseRef}
  // 5. If builder: checkout into worktree
  // 6. If reviewer: checkout source read-only, create isolated temp for output
  // 7. Verify worktree integrity (hash base commit, record in audit)
  // 8. Return WorkspaceHandle

async cleanup(handle: WorkspaceHandle): Promise<void>
  // 1. Verify no unresolved execution artifacts
  // 2. git worktree remove --force {path}
  // 3. Audit: WORKSPACE_CLEANED
```

### 3.7 Sandbox Executor Interface

```typescript
// Key methods:

async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>
  // Dispatch to configured sandbox technology:
  //
  // - 'bubblewrap':
  //   bwrap --unshare-user --unshare-pid --unshare-net \
  //     --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib \
  //     --dev /dev --proc /proc \
  //     --bind {worktree} /workspace \
  //     --tmpfs {tmpdir} \
  //     --setenv HOME {sandboxHome} \
  //     --die-with-parent \
  //     {executable} {args}
  //
  // - 'docker':
  //   docker run --rm --read-only --network=none \
  //     --memory={maxMemory} --cpus={maxCpu} \
  //     -v {worktree}:/workspace:rw \
  //     --entrypoint {executable} {image} {args}
  //
  // - 'none':
  //   direct spawn() for development/testing only
```

---

## 4. Execution State Machine

### 4.1 Job-Level State Machine

```
                    +--------------+
                    |  RECEIVED    |
                    |  (idempotent |
                    |   key check) |
                    +------+-------+
                           |
                    +------v-------+
                    |  VALIDATING  |
                    |  (repo allow |
                    |   list, ref, |
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

### 4.2 State Transitions

| From | To | Trigger | Guard |
|------|----|---------|-------|
| RECEIVED | VALIDATING | Entry | Idempotency key not yet claimed |
| RECEIVED | DUPLICATE | Entry | Idempotency key already claimed with same logical operation |
| VALIDATING | PROVISIONING | All validations pass | repo allowlisted, ref valid, budget available |
| VALIDATING | REJECTED | Any validation fails | fail-closed, audit with reason code |
| PROVISIONING | EXECUTING | Worktree provisioned | Git worktree clean, base SHA recorded |
| EXECUTING | SUCCEEDED | Agent exits 0 | Within timeout, within resource limits |
| EXECUTING | FAILED | Agent exits non-0 | Non-zero exit code |
| EXECUTING | TIMED_OUT | Timeout exceeded | SIGTERM -> 2s -> SIGKILL |
| EXECUTING | CANCELLED | VITO sends cancel | Grace period before SIGKILL |
| * | COMPLETED | After cleanup | Always; result always returned to VITO |

### 4.3 Idempotency Key

```
{workflowRunId}:{workflowStepRunId}:{attemptNo}:{capabilityCode}
```

- Same key + same logical operation = return cached result
- Same key + different logical operation = fail-closed (policy violation)
- Key stored via existing `PrismaGovernedIdempotencyStore`
- Idempotency claim is transactional with execution start

---

## 5. Threat Model

### 5.1 Threat: Agent Escapes Workspace

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent binary (or code it invokes) escapes the worktree directory and accesses host filesystem |
| **Pre-mitigation** | PR #17's adapter runs with `cwd` set to worktree but no OS-level mount namespace |
| **Mitigation** | Bubblewrap: `--bind {worktree} /workspace` with no host mounts except `/usr`, `/bin`, `/lib`, `/lib64`, `/dev`, `/proc`. Docker: `--read-only` + explicit volume mount only for worktree. |
| **Residual risk** | If Bubblewrap itself has a vulnerability; Docker daemon escape |
| **Detection** | Filesystem access audit, seccomp traces, Docker audit logs |
| **Response** | Worker terminates agent, marks job FAILED, alerts operator |

### 5.2 Threat: Agent Accesses Other Tenants' Workspaces

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent traverses paths to access another organization's workspace |
| **Mitigation** | Worktree path: `{root}/orgs/{sha256(orgId)}/runs/{runId}/`. Bubblewrap bind-mounts only the current worktree. Agent cannot see sibling org directories. |
| **Residual risk** | SHA-256 org directory name is deterministic but not secret; collision is negligible |
| **Detection** | Path access outside worktree logged by sandbox |
| **Response** | Deny, fail-closed, audit |

### 5.3 Threat: Agent Injects Malicious Provider Selection

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent manipulates VITO into selecting a different provider or executable |
| **Mitigation** | Agent never communicates with VITO's provider router. Provider is selected by `AgentWorkforceService` -> `ProviderRouterService` before adapter execution. Agent receives only `cwd`, stdin prompt, and allowlisted env vars. |
| **Residual risk** | None at v0.1 scope |
| **Detection** | N/A |
| **Response** | N/A |

### 5.4 Threat: Agent Reads Credentials From Environment

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent inherits VITO server environment variables including database credentials, API keys, JWT secrets |
| **Mitigation** | SandboxExecutor constructs a minimal environment: `HOME`, `TMPDIR`, `PATH=/usr/bin:/bin` (or no PATH), plus explicitly allowlisted vars. Never inherits host process environment. |
| **Residual risk** | If Bubblewrap/Docker config is misconfigured |
| **Detection** | Environment audit in sandbox config |
| **Response** | Fail-closed if env contains unexpected keys |

### 5.5 Threat: Agent Consumes Unbounded Resources

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent runs indefinitely, consuming CPU, memory, disk, or network |
| **Mitigation** | Wall-clock timeout (from `executionBudget.maxDurationMs`), memory limit (`--rlimit-as` in Bubblewrap, `--memory` in Docker), disk limit (worktree size check), network isolation (`--unshare-net` in Bubblewrap, `--network=none` in Docker) |
| **Residual risk** | Fork bomb within allowed process count |
| **Detection** | Resource monitor, OOM kill detection |
| **Response** | SIGTERM -> SIGKILL, job marked TIMED_OUT or FAILED |

### 5.6 Threat: Agent Modifies Protected Git Branches

| Attribute | Value |
|-----------|-------|
| **Threat** | Agent commits/pushes to protected branches (main, release/*) |
| **Mitigation** | Git commit/push is denied by `evaluatePolicy()` (EO-01.4) before adapter execution. Git commit/push commands are not available in sandbox (git binary may be available for read operations only, or git is outside the sandbox mount). |
| **Residual risk** | None in v0.1; commit/push requires HumanGate + release adapter |
| **Detection** | Audit trail shows any git mutation attempt |
| **Response** | Policy denies, audit records violation |

### 5.7 Threat: Agent Replays Stale/Duplicate Execution

| Attribute | Value |
|-----------|-------|
| **Threat** | Same job dispatched twice, creating duplicate side effects |
| **Mitigation** | Idempotency key `runId:stepId:attemptNo:capability` with transactional claim via `PrismaGovernedIdempotencyStore`. Duplicate dispatch returns cached result or fails-closed on logical operation mismatch. |
| **Residual risk** | If DB transaction fails after idempotency claim |
| **Detection** | Idempotency store audit |
| **Response** | Envelope marked FAILED, retried as new attempt |

### 5.8 Threat: Compromised Sandbox Launcher Binary

| Attribute | Value |
|-----------|-------|
| **Threat** | Attacker replaces the launcher binary at `VITO_TRUSTED_AGENT_LAUNCHER_ROOT` |
| **Mitigation** | `TrustedLocalExecutableResolver` computes SHA-256 of binary content at resolution time. Integrity hash is recorded in audit and execution metadata. Any change in binary content changes the hash, which is auditable. |
| **Residual risk** | Binary replaced between resolution and execution (TOCTOU) |
| **Detection** | Integrity hash comparison at resolution vs. execution |
| **Response** | Hash mismatch -> fail-closed |

---

## 6. Minimal v0.1 Scope vs. Deferred Features

### 6.1 v0.1 Scope (This Block)

| Feature | Rationale |
|---------|-----------|
| Workspace provisioning (git worktree per job) | Required for isolation |
| Bubblewrap sandbox execution | Production OS-level isolation |
| Docker fallback (configurable) | Deployment flexibility |
| Bounded output capture | Required for audit + result return |
| Timeout enforcement | Required by execution budget |
| Memory/resource limits | Required to prevent resource exhaustion |
| Idempotent job execution | Required by failure recovery architecture |
| Job cancellation support | Required by governance contract |
| Audit event emission | Required by observability contract |
| Integration with existing `GovernedProviderAdapter` interface | No new abstraction needed |
| Repository + base-ref allowlist | Required by sandbox permission matrix |
| Execution result return to VITO | Control plane needs structured result |

### 6.2 Deferred to Next Blocks

| Feature | Block | Dependency |
|---------|-------|------------|
| Live log streaming | Should-have | WebSocket/SSE infrastructure |
| Multi-worker distribution | Should-have | Worker pool, queue system |
| Credential broker injection | Must-have | Durable credential store, secret rotation |
| Separate builder/reviewer worktrees per AL-4 | Should-have | WorkflowStepRun -> dispatch binding |
| GPU resource scheduling | Nice-to-have | Multi-node worker pool |
| Dynamic sandbox policy | Nice-to-have | Runtime policy evaluation |
| Artifact store (full stdout/diff/test reports) | Must-have | Artifact persistence schema |
| HumanGateResolver (release approval) | Must-have | Durable HumanGate persistence |
| WorkflowStepRun -> AgentWorkforce dispatch binding | Must-have | Workflow runtime integration |
| n8n webhook workflow package | Must-have | n8n workflow definition |
| Provider health probes for local agents | Should-have | Health check mechanism |
| Cost/token budget enforcement per execution | Should-have | Usage metering |

---

## 7. Tests Required

### 7.1 Unit Tests: WorkspaceProvisioner

| # | Test | Assertion |
|---|------|-----------|
| WP-01 | provision creates worktree at expected path | `workspaceHandle.worktreePath` matches `{root}/orgs/{hash}/runs/{runId}/{role}/` |
| WP-02 | provision rejects repository not on allowlist | Throws/rejects with `REPOSITORY_NOT_ALLOWED` |
| WP-03 | provision rejects invalid base ref | Throws/rejects with `INVALID_BASE_REF` |
| WP-04 | provision records base SHA in handle | `workspaceHandle.baseSha` is valid 40-char hex SHA |
| WP-05 | reviewer worktree source is read-only | `chmod` attempt on source files fails |
| WP-06 | builder worktree allows writes within allowed paths | `writeFile` succeeds inside allowed paths |
| WP-07 | builder worktree denies writes outside allowed paths | `writeFile` fails outside allowed paths |
| WP-08 | cleanup removes worktree | Directory no longer exists after cleanup |
| WP-09 | cleanup rejects if unresolved artifacts exist | Cleanup blocked if artifacts not durably stored |
| WP-10 | cleanup audits WORKSPACE_CLEANED event | AuditService.create called with correct event |

### 7.2 Unit Tests: SandboxExecutor

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
| SE-09 | execute with `--unshare-net` blocks network | Agent cannot reach external endpoints |
| SE-10 | execute records integrity hash in result | `result.integrityHash` matches `TrustedExecutable.integrityHash` |

### 7.3 Unit Tests: OutputCapture

| # | Test | Assertion |
|---|------|-----------|
| OC-01 | captures full output under limit | Complete output preserved |
| OC-02 | rolling window truncates old data | Only last N bytes preserved when over limit |
| OC-03 | handles binary data without crash | No exception on non-UTF8 chunks |
| OC-04 | handles rapid write bursts | No data loss under concurrent writes |

### 7.4 Unit Tests: RemoteExecutionWorkerService

| # | Test | Assertion |
|---|------|-----------|
| RE-01 | executeSandboxed orchestrates full lifecycle | provision -> execute -> capture -> cleanup -> result |
| RE-02 | fails closed on repo not in allowlist | `REPOSITORY_NOT_ALLOWED` error, no execution |
| RE-03 | fails closed on unknown executable | `EXECUTABLE_NOT_TRUSTED` error |
| RE-04 | idempotent dispatch returns cached result | Second call with same key returns identical result |
| RE-05 | idempotent dispatch with different logical op fails closed | `IDEMPOTENCY_CONFLICT` error |
| RE-06 | cancellation terminates agent | `CANCELLED` status, SIGKILL sent |
| RE-07 | timeout produces TIMED_OUT with audit | `TIMED_OUT` status, audit event emitted |
| RE-08 | execution failure produces FAILED with audit | `FAILED` status, non-zero exit code recorded |
| RE-09 | successful execution produces SUCCEEDED with audit | `SUCCEEDED` status, artifacts referenced |
| RE-10 | cleanup always runs even on failure | Worktree removed in all terminal states |

### 7.5 Integration Tests

| # | Test | Assertion |
|---|------|-----------|
| IT-01 | full dispatch through `AgentWorkforceService` -> worker -> sandboxed execution | End-to-end: dispatch -> routed -> provisioned -> executed -> result |
| IT-02 | sandbox isolation prevents workspace escape | Agent process cannot read files outside worktree |
| IT-03 | sandbox isolation prevents network access | Agent cannot reach external URLs when network unshared |
| IT-04 | sandbox timeout enforcement | Long-running agent killed within timeout |
| IT-05 | idempotency across VITO API restart | Same idempotency key returns cached result |
| IT-06 | cancellation via VITO API | Cancel signal terminates running agent |

### 7.6 Security Tests (Mandatory Before Production)

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

---

## 8. Architectural Conflicts with PR #17

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

### Pre-Existing CI Issue

The CI is currently red due to a stale test fixture in `provider-registry.spec.ts` (missing `credentialRequirement` field). This predates PR #17 and must be fixed before any merge regardless of the worker design. Evidence:

- Branch: `main`
- CI status: FAILURE
- Root cause: `packages/contracts/src/engineering/provider-registry.spec.ts` fixture does not satisfy the now-required `credentialRequirement` field on `ProviderDeclaration` (defined in `provider-registry.ts:110`)
- API suite itself passes 241/241; contracts src typechecks clean
- The freeze doc's validation table never ran the contracts suite or CI

---

## 9. Configuration

```bash
# Existing (from PR #17)
export GOVERNED_WORKSPACE_ROOT=/srv/vito/workspaces
export VITO_TRUSTED_AGENT_LAUNCHER_ROOT=/usr/local/lib/vito-agent-launchers
export VITO_TRUSTED_LOCAL_EXECUTABLES='{"opencode":"/usr/local/lib/vito-agent-launchers/opencode"}'

# New for Remote Execution Worker
export VITO_SANDBOX_TECHNOLOGY=bubblewrap        # 'bubblewrap' | 'docker' | 'none' (dev only)
export VITO_SANDBOX_DEFAULT_TIMEOUT_MS=300000    # 5 minutes default
export VITO_SANDBOX_MAX_MEMORY_BYTES=2147483648  # 2GB default
export VITO_SANDBOX_MAX_CPU_TIME_MS=600000       # 10 minutes default
export VITO_SANDBOX_UNSHARE_NETWORK=true          # true = no network in sandbox
export VITO_SANDBOX_MAX_OUTPUT_BYTES=262144      # 256KB stdout/stderr cap

# Repository allowlist (for workspace provisioning)
export VITO_WORKSPACE_ALLOWED_REPOS='["github.com/lavolpeofficial/*"]'
export VITO_WORKSPACE_BASE_REFS='["main","develop"]'
```

---

## 10. Summary

The Remote Execution Worker is the **production isolation boundary** that PR #17's `HeadlessLocalAgentAdapter` explicitly deferred. It slots into the existing `GovernedProviderAdapter` interface without changing any upstream contract, dispatch surface, or trust chain. The design:

1. **Reuses** PR #17's `AgentWorkforceService`, `TrustedLocalExecutableResolver`, `GovernedInvocationService`, provider routing, policy evaluation, audit, and idempotency
2. **Replaces** bare `spawn()` with OS-level sandboxed execution (Bubblewrap or Docker)
3. **Adds** git worktree-based workspace provisioning with per-run isolation
4. **Enforces** resource limits, network isolation, and output capture
5. **Preserves** all existing VITO invariants: Capability != Provider, fail-closed, audit chain, idempotency
6. **Defers** credential broker, artifact store, HumanGateResolver, live streaming, multi-worker distribution to subsequent blocks

No implementation, commit, or push until approved.
