---
record_type: architecture-design
record_id: VITO-OB-001
title: "Operator Bridge v0.1"
system: vito-platform
subsystem: operator-bridge
status: PROPOSED
created: 2026-08-25
updated: 2026-08-26
author: VITO Engineering
review_gate: ARCHITECTURE_REVIEW
related_pr: null
related_branch: design/vito-operator-bridge-v0.1
supersedes: null
superseded_by: null
baseline:
  branch: main
  sha: "cc0250278b3265caa8ad4b789a1f9091255fdefe"
revision: 4
---

# VITO Operator Bridge v0.1 -- Engineering Record

This is a documentation-only architecture design record.
No implementation code was modified. No implementation approval is implied.

---

## 1. Architecture Fit Assessment

### 1.1 Current State

The authoritative runtime path on `main` (baseline `cc02502`) is:

```
AgentWorkforceController.dispatch()
  -> TenantContext.getOrThrow()          (JWT-derived organizationId)
  -> AgentWorkforceService.dispatch()
       -> ProviderRouterService.route()  (capability-based deterministic routing)
       -> GovernedRuntimeService.executeWorkspaceFileOperation()
            -> GovernedInvocationServiceImpl.invoke()
                 -> ExecutionProfileResolver (trusted, non-authoritative hint)
                 -> ExecutionPolicyResolver  (trusted policy source)
                 -> evaluatePolicy()         (EO-01.4 mandatory gate)
                 -> IdempotencyStore.claim() (Phase 3H duplicate boundary)
                 -> HeadlessLocalAgentAdapter -> RemoteExecutionWorker
                      -> BubblewrapSandboxExecutor (--unshare-net, --unshare-pid, --unshare-user)
                      -> change-set capture (git diff --cached --binary)
                      -> workspace cleanup (rmSync worktree)
```

Key architectural properties already present:

| Property | Status | Location |
|----------|--------|----------|
| Tenant isolation | **Implemented** | `TenantContext` (request-scoped, JWT-derived `organizationId`) |
| Capability-based routing | **Implemented** | `ProviderRouterService.route()` (EO-01.3) |
| Execution policy | **Implemented** | `evaluatePolicy()` in `@vito/contracts` (EO-01.4) |
| Governed invocation | **Implemented** | `GovernedInvocationServiceImpl` |
| Idempotency | **Implemented** | `PrismaGovernedIdempotencyStore` (Phase 3H) |
| Credential injection | **Implemented** | `CredentialBroker` interface, injected at adapter boundary only |
| Audit trail | **Implemented** | `AuditService.record()` at every decision point |
| Sandboxing | **Implemented** | `BubblewrapSandboxExecutor` via `RemoteExecutionWorker` |
| Role-based access | **Implemented** | `@Roles(OWNER, ADMIN)` on dispatch endpoint |
| JWT authentication | **Implemented** | `JwtAuthGuard` (global), `JwtStrategy` (DB-verified per request) |

### 1.2 Sandbox Execution Reality (VITO-REW-001)

The Bubblewrap sandbox enforces (verified in `sandbox-executor.ts:155-167`):

- `--unshare-user` -- user namespace isolation
- `--unshare-pid` -- PID namespace isolation
- **`--unshare-net`** -- **network namespace isolation (no network access)**
- Read-only binds for `/usr`, `/bin`, `/lib`, `/lib64`
- Bind mount of ephemeral workspace to `/workspace`
- tmpfs at `/tmp`
- `--die-with-parent` -- process dies with parent

The workspace is **ephemeral**: `GitWorkspaceProvisioner.cleanup()` calls `rmSync(handle.worktreePath, { recursive: true, force: true })` after every execution. The only durable output is the `GovernedResultSettling` (changed files list + binary patch), captured before cleanup.

**There is no git push, branch creation, or commit capability within the sandbox or RemoteExecutionWorker.** The worker returns a governed change-set (diff) for external application by a separate SCM control plane.

### 1.3 Critical Observation: Existing Endpoint Is Nearly Reusable

The existing `POST /agent-workforce/dispatch` endpoint already provides:

- Intent-level input only (capabilityCode + prompt, never executable path)
- Server-side provider resolution
- Server-side trusted execution authority
- Full audit trail

**The current endpoint requires `workflowRunId` and `workflowStepRunId`** -- these are workflow-runtime-specific identifiers that an external operator client does not naturally provide. This is the primary reason a thin facade is warranted rather than direct reuse of the raw dispatch endpoint.

**Decision: Create a thin Operator Bridge facade that:**
1. Accepts operator-level intent (no workflow context required)
2. Creates an `OperatorTask` record
3. Derives `workflowRunId`/`workflowStepRunId` server-side
4. Delegates to the existing `AgentWorkforceService.dispatch()`
5. Returns a bounded result contract suitable for external consumption

This avoids duplicating the execution pipeline while providing an appropriate external interface.

---

## 2. Trust Boundaries

### 2.1 Trust Model

```
External Operator (ChatGPT / future clients)
  |
  | HTTPS (authenticated)
  v
+-------------------------------+
| VITO Ingress Auth             |  <-- JwtAuthGuard (global APP_GUARD)
|  - JWT verification           |
|  - DB user/org/token-version  |
|  - TenantContext resolution   |
+-------------------------------+
  |
  v
+-------------------------------+
| GLOBAL MACHINE-SCOPE GUARD    |  <-- ScopedMachineIdentityGuard (APP_GUARD)
|  - deny scoped identities by default |
|  - @MachineScope('vito-bridge') opt-in |
|  - exact DB-derived scope match |
+-------------------------------+
  |
  v
+-------------------------------+
| OPERATOR BRIDGE FACADE        |  <-- NEW: thin translation layer
|  - Operator authorization     |     (same NestJS process, internal call)
|  - OperatorTask creation      |
|  - workflow context derivation|
|  - Intent -> dispatch translate|
+-------------------------------+
  |
  | Internal service call (same process, no HTTP hop)
  v
AgentWorkforceService.dispatch()  <-- EXISTING, UNCHANGED
  |
  v
ProviderRouterService -> GovernedRuntimeService -> GovernedInvocation
  -> RemoteExecutionWorker -> Bubblewrap Sandbox (no network)
  -> governed change-set capture -> workspace cleanup
```

### 2.2 What the External Client MUST NOT Control

The following are **never** passed through from the external client to the execution path:

| Forbidden Field | Why | Who Decides Server-Side |
|----------------|-----|------------------------|
| Executable path | Path injection / binary substitution | `TrustedLocalExecutableResolver` |
| Shell command | Command injection | `AgentWorkforceService` (derives from provider metadata `commandAlias`) |
| Provider ID | Provider spoofing / bypass routing | `ProviderRouterService.route()` |
| Repository URL | Repository injection | `RepositoryRegistry` (trusted registry) |
| Base ref | Ref injection / branch manipulation | `RepositoryRegistry.isBaseRefAllowed()` |
| Sandbox technology | Sandbox escape | `GovernedSandboxConfig` (hardcoded `bubblewrap` in prod) |
| Environment variables | Privilege escalation | `buildGovernedExecutionEnvironment()` (allowlist-only) |
| Filesystem path | Path traversal | `WorkingDirectoryResolver` (trusted, org-scoped) |
| Credentials/secrets | Secret leakage | `CredentialBroker` (injected at adapter boundary only) |
| Execution profile | Authorization bypass | `ExecutionProfileResolver` (trusted, non-authoritative hint) |
| Execution policy | Authorization bypass | `ExecutionPolicyResolver` (trusted, injected) |
| Human gate bindings | Authorization bypass | `HumanGateResolver` (trusted, context-bound) |

### 2.3 What the External Client Provides

The external client provides **intent-level fields only**:

- Request ID (for idempotency and correlation)
- Capability code (what capability is needed)
- Bounded instruction/prompt (the task description)
- Optional governed budget hints (maxDurationMs, maxTokens, maxCostMinorUnits)
- Optional assurance level

All execution authority is derived server-side from:
- Operator identity (JWT -> TenantContext)
- Provider registry (deterministic routing)
- Execution policy (EO-01.4)
- Trusted resolvers (executable, workspace, profile)

---

## 3. Authentication Model

### 3.1 Actual Topology

The Operator Bridge is **inside the same VITO NestJS application process**. There is no internal HTTP call, no second Bearer-token hop, and no self-call. The actual request flow is:

```
External operator credential (JWT Bearer token)
  -> JwtAuthGuard (global APP_GUARD, request-scoped)
       -> Passport JwtStrategy.validate()
             -> DB-verified: user exists, org matches, status ACTIVE, token_version matches
             -> DB-derived User.isMachineIdentity/machineScope copied to request.user
        -> TenantContext.set({ organizationId, userId, role, authenticationMethod: 'jwt' })
  -> ScopedMachineIdentityGuard (global APP_GUARD)
       -> unscoped human identity: pass through unchanged
       -> scoped identity: require exact @MachineScope(...) metadata; otherwise 403
  -> RolesGuard (global APP_GUARD, request-scoped)
       -> @Roles(MEMBER, ADMIN, OWNER) check
  -> @MachineScope('vito-bridge') on both bridge routes
  -> OperatorBridgeController.dispatch()
       -> reads TenantContext.getOrThrow() for organizationId
       -> OperatorBridgeService.submitTask()
             -> internal call to AgentWorkforceService.dispatch()
```

The long-lived credential (JWT) exists **only at the external authentication boundary**. It never enters:
- Task prompts or payloads
- Audit or debug logs (only `actorType` and `userId` are logged)
- Sandbox environment
- Provider execution context

### 3.2 v0.1 Decision: Globally Restricted Machine Identity via Existing Auth Stack

**A compromised operator credential must not automatically become general VITO ADMIN authority.**

The existing auth system has four roles: `OWNER > ADMIN > MEMBER > VIEWER`. The operator service account must not receive `OWNER` or `ADMIN` roles, as those grant access to unrelated administrative surfaces (user management, source vault, audit query, digital employee management).

#### Chosen approach: Scoped service user + global fail-closed machine-scope guard

| Component | Decision | Rationale |
|-----------|----------|-----------|
| **Service account role** | `MEMBER` | Excludes OWNER/ADMIN surfaces; the global machine-scope guard further restricts the identity to bridge-only operations. |
| **JWT payload** | Standard `JwtPayload` (`sub`, `org_id`, `role`, `token_version`) | The scope is deliberately not copied into the token, so DB changes revoke or change scope on the next request. |
| **Machine identity source** | `User.isMachineIdentity` (default `false`) plus nullable `User.machineScope`; bridge account uses `true` + `vito-bridge` | The stable discriminator prevents clearing a scope from silently converting a machine account into an unrestricted human MEMBER. |
| **Authenticated principal** | `JwtStrategy` returns both DB fields on `AuthenticatedUser` / `request.user` | Classification and scope are re-read from the database on every authenticated request. They are not added to `TenantContext`, which remains tenant/RBAC context only. |
| **Global scope guard** | `ScopedMachineIdentityGuard` registered as `APP_GUARD` after `JwtAuthGuard` and before `RolesGuard` | A machine identity is denied unless the route has an exact matching `@MachineScope(...)`. Missing, empty, unknown, or mismatched values fail closed. Inconsistent human+scope data also fails closed. |
| **Bridge route policy** | Both bridge methods use `@MachineScope('vito-bridge')` and `@Roles(MEMBER)` | Only the intended machine scope reaches the bridge; role and scope are conjunctive. An unscoped human MEMBER does not satisfy the machine-only bridge policy. |

#### Global authorization invariant

> **An authenticated identity carrying any machine scope is denied from every endpoint unless that endpoint explicitly accepts that exact scope.**

This is a global authorization invariant, not a bridge-controller convention. Existing endpoints without `@MachineScope(...)` remain available to ordinary unscoped humans under their current JWT and role rules, but are denied to all machine-scoped identities. In v0.1, the only opt-in endpoints are:

```
POST /v1/operator/tasks
GET  /v1/operator/tasks/:taskId
```

| Principal state | Route metadata | Guard result |
|-----------------|----------------|--------------|
| Human (`isMachineIdentity=false`, scope null) | No machine scope | Pass through to existing RolesGuard behavior |
| Human | `@MachineScope(...)` | Deny; bridge routes are machine-only |
| Machine + exact non-empty scope | Matching `@MachineScope(...)` | Pass through to RolesGuard |
| Machine + null/empty/unknown/mismatched scope | Any route | Deny |
| Machine + valid scope | No metadata | Deny |
| Inconsistent human + non-null scope | Any route | Deny fail-closed |

`JwtAuthGuard` must also authenticate a presented Bearer token on `@Public()` routes before allowing the public route to proceed. Anonymous public access remains unchanged; a request that presents a machine credential remains subject to the global scope guard and cannot bypass it by targeting a public route. Invalid presented credentials fail authentication rather than degrading to anonymous access.

#### What this protects against

| Threat | Mitigation |
|--------|------------|
| Compromised operator credential accesses any unrelated endpoint | Global `ScopedMachineIdentityGuard` denies every route without exact `@MachineScope('vito-bridge')`, including unrelated MEMBER and public routes |
| Compromised operator credential queries other tenants | `TenantContext.organizationId` bound to JWT; cross-tenant queries rejected |
| Compromised operator credential accesses source vault | `@Roles(OWNER, ADMIN)` on source vault endpoints; `MEMBER` denied |
| Compromised operator credential modifies audit records | Audit endpoints are read-only and `@Roles(OWNER, ADMIN)` protected |
| Credential enters prompts/payloads/logs | Never; the credential exists only in the `Authorization` header and Passport boundary; only identity attributes are retained on `request.user` and tenant attributes in `TenantContext` |

#### Credential storage topology

```
External connector/client credential vault
  -> HTTPS Authorization header
  -> VITO ingress (JwtAuthGuard / Passport)
  -> Verified user/org from DB
  -> request.user populated (org, userId, role, DB-derived machine classification/scope)
  -> TenantContext populated (org, userId, role only)
  -> Global machine-scope guard validates exact route opt-in
```

**VITO must not store its own incoming Bearer token in OperatorBridge configuration.** The credential vault lives outside VITO (external client responsibility). VITO stores only the service account `User` record with `role: MEMBER`, `isMachineIdentity: true`, and `machineScope: 'vito-bridge'`. Machine classification is not cleared during revocation; suspension/deletion or `tokenVersion` invalidation revokes the account, while a null scope on a machine identity denies all endpoint access.

### 3.3 Why Not Other Options

| Option | Rejected Because |
|--------|-----------------|
| **General OWNER/ADMIN credential** | Exposes user management, source vault, audit, digital employee admin, and all other OWNER/ADMIN endpoints. A compromised credential becomes a full VITO admin. **BLOCKER** by review. |
| **Method-scoped bridge-only guard** | Insufficient: the same scoped MEMBER identity could call unrelated MEMBER endpoints because undecorated methods would pass through. |
| **Dedicated `OperatorServiceCredentialGuard` (new table, API-key hash)** | Cleanest long-term credential system but excessive for v0.1; the global scope restriction supplies least privilege while preserving the existing JWT lifecycle. Deferred to v0.2. |
| **OAuth2 client credentials flow** | Requires OAuth2 infrastructure (token endpoint, client registration). Overengineered for v0.1. Deferred. |
| **IP allowlist only** | Insufficient for machine-to-machine auth; no identity, no tenant binding, no revocation. |

### 3.4 Security Properties (v0.1)

- JWT bound to a specific organization (`org_id` claim) and role (`MEMBER`)
- Per-request DB verification ensures user and org remain active (`JwtStrategy.validate()`)
- Per-request DB resolution of machine classification and scope makes authorization changes effective on the next request
- `tokenVersion` allows immediate revocation (increment `User.tokenVersion`)
- `ScopedMachineIdentityGuard` is global and default-deny for every machine-scoped principal
- `@MachineScope('vito-bridge')` appears only on the two bridge routes in v0.1
- `@Roles(MEMBER)` is evaluated in addition to the machine scope
- Bridge controller reads `organizationId` from `TenantContext` only -- never from request body
- Credential never enters prompts, payloads, logs, sandbox environment, or provider payload
- Service account `User` record is a standard VITO user with standard lifecycle (can be suspended/deleted)
- Ordinary users with `isMachineIdentity = false` and `machineScope = null` continue through the existing JWT/Roles authorization behavior unchanged

---

## 4. Transport/Interface

### 4.1 Protocol Design

The bridge exposes a provider-neutral HTTP API. No ChatGPT-specific semantics.

**Core operations:**

```
POST   /v1/operator/tasks          -- Submit a new governed task (synchronous)
GET    /v1/operator/tasks/:taskId  -- Retrieve persisted task status/result
```

### 4.2 Request Contract: `SubmitOperatorTask`

```typescript
interface SubmitOperatorTaskRequest {
  /** Client-generated request ID for idempotency (UUID). */
  readonly requestId: string;

  /** Capability code identifying the needed capability. */
  readonly capabilityCode: string;

  /** Bounded instruction/prompt (1-524288 UTF-8 bytes). */
  readonly prompt: string;

  /** Optional assurance level. */
  readonly assuranceLevel?: string;

  /** Optional governed execution budget. */
  readonly budget?: {
    readonly maxDurationMs?: number;     // 1000-3600000
    readonly maxTokens?: number;         // 1-10000000
    readonly maxCostMinorUnits?: number; // 0-100000000
  };
}
```

**What this request deliberately excludes:**
- `workflowRunId` / `workflowStepRunId` -- derived server-side
- `providerId` -- determined by `ProviderRouterService`
- `requestedAction` -- determined by `AgentWorkforceService` (always `RUN_COMMAND`)
- `command` / `executable` -- derived from provider metadata
- `repositoryId` / `baseRef` -- resolved by `RepositoryRegistry`
- `environment` -- allowlisted by `buildGovernedExecutionEnvironment()`
- `executionProfile` -- resolved by trusted `ExecutionProfileResolver`

### 4.3 Response Contract

```typescript
/** Synchronous response from POST /v1/operator/tasks */
interface SubmitOperatorTaskResponse {
  /** Server-assigned task ID (UUID). */
  readonly taskId: string;

  /** Client-provided request ID (echoed for correlation). */
  readonly requestId: string;

  /** Correlation ID for audit trail. */
  readonly correlationId: string;

  /** Terminal for the owner; may be DISPATCHING for an idempotent in-flight return. */
  readonly status: OperatorTaskStatus;

  /** Routing decision ID, absent until routing has produced one. */
  readonly routingDecisionId: string | null;
}

/** Full result from GET /v1/operator/tasks/:taskId */
interface OperatorTaskResult {
  readonly taskId: string;
  readonly requestId: string;
  readonly status: OperatorTaskStatus;
  readonly correlationId: string;

  /** Stable bridge-generated correlation identities required by dispatch. */
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;

  /** Execution IDs for audit trail. */
  readonly invocationId?: string;
  readonly executionId?: string;

  /** Selected provider metadata (where disclosure is permitted). */
  readonly provider?: {
    readonly providerCode: string;
    readonly displayName: string;
  };

  readonly capabilityCode: string;

  /** Original prompt while the sensitive payload is retained. */
  readonly prompt: string | null;

  /** Bounded stdout summary (truncated to MAX_SAFE_TEXT_LENGTH = 2000). */
  readonly stdout: string | null;

  /** Bounded stderr summary (truncated to MAX_SAFE_TEXT_LENGTH = 2000). */
  readonly stderr: string | null;

  /** Changed files list. */
  readonly changedFiles?: readonly string[];

  /** Exact authoritative governed patch (integrity-bearing sensitive payload -- see Section 12). */
  readonly patch: string | null;

  /** Typed error if failed. */
  readonly error?: {
    readonly reason: string;
    readonly message: string;
    readonly retryable: boolean;
  };

  /** Timing metadata. */
  readonly timing?: {
    readonly startedAt?: string;  // ISO 8601
    readonly completedAt?: string;
    readonly durationMs?: number;
  };

  /** Workspace disposition. */
  readonly workspaceDisposition?: 'CLEANED';

  /** Whether human review is required. */
  readonly reviewRequired: boolean;

  /** True only while sensitive fields remain available in storage. */
  readonly sensitivePayloadAvailable: boolean;

  /** Configured expiry; retained after deletion as audit metadata. */
  readonly sensitivePayloadExpiresAt: string;

  /** Actual deletion time, null until the payload is physically cleared. */
  readonly sensitivePayloadDeletedAt: string | null;

  readonly createdAt: string;
  readonly updatedAt: string;
}
```

### 4.4 Synchronous Semantics (Corrected)

**v0.1: Synchronous owner execution with idempotent in-flight returns.**

The lifecycle of a single `POST /v1/operator/tasks` request:

1. Compute the canonical request fingerprint before opening a transaction and resolve the authenticated `(organizationId, requestId)` key.
2. **Transaction A:** atomically resolve or create the task directly in dispatch-owned `DISPATCHING` state, then commit.
3. If this request did not acquire ownership, return the existing terminal or `DISPATCHING` task without calling dispatch.
4. **Outside every database transaction, only the owner invokes `AgentWorkforceService.dispatch()` synchronously.**
5. **Transaction B:** persist the mapped terminal result (`COMPLETED`, `HUMAN_GATE`, or `FAILED`) and commit.
6. Return the persisted terminal response. A duplicate request may instead return the existing `DISPATCHING` response immediately.

The governed execution runs **within the dispatch owner's HTTP request lifecycle**, but with no Prisma transaction open. There is no background job queue, no decoupled worker, and no durable async execution in v0.1.

**Client disconnect during execution:**
- If the client disconnects (HTTP timeout, network failure) while `AgentWorkforceService.dispatch()` is running, the NestJS request lifecycle may be aborted.
- The governed invocation pipeline (`GovernedInvocationServiceImpl.invoke()`) will continue to completion within the Node.js event loop until the adapter returns or the governed timeout fires.
- The service attempts Transaction B after dispatch returns even if the client disconnects, but process termination or interruption can prevent terminal persistence.
- If the task remains in `DISPATCHING`, it is a **stale in-flight task** -- not a durable background job.
- The client can poll via `GET /v1/operator/tasks/:taskId` and will see either the terminal result or a non-terminal status.
- **No automatic retry, reclaim, resumption, or redispatch of stale tasks is provided in v0.1.** Re-submission with the same `requestId` and fingerprint returns the existing `DISPATCHING` task. A caller that intentionally wants a new logical execution must submit a new `requestId`.

#### Crash/interruption trade-off

v0.1 deliberately prefers a stale `DISPATCHING` task over accidental double execution. A crash after Transaction A may leave a task permanently `DISPATCHING`, whether dispatch had not started, was interrupted, or completed without Transaction B. Duplicate callers cannot distinguish those cases safely and therefore **MUST NOT redispatch**. Automatic lease expiry, abandoned-task recovery, and reclaim are deferred to v0.2 together with durable background execution.

**Durable background execution is deferred to v0.2** (requires a job queue such as BullMQ or a Postgres-backed outbox pattern).

---

## 5. Operator Task State Machine and Dispatch Ownership

### 5.1 States

```
DISPATCHING
  -> COMPLETED | HUMAN_GATE | FAILED
```

### 5.2 State Definitions

| State | Description | Entry Condition | Persistence |
|-------|-------------|-----------------|-------------|
| `DISPATCHING` | Dispatch ownership has been durably claimed; execution may be pending, active, interrupted, or stale | Transaction A creates the task and commits | Persisted before `dispatch()`; never reclaimable in v0.1 |
| `COMPLETED` | Execution completed; result delivered to client | Dispatch returned terminal success | Terminal |
| `HUMAN_GATE` | Task policy-blocked; requires human approval | `evaluatePolicy()` returned non-ALLOW | Terminal |
| `FAILED` | Task failed (terminal) | Any terminal error from dispatch | Terminal |

### 5.3 Why No RUNNING or RESULT_READY State

For synchronous v0.1, there is **no runtime callback** that updates `OperatorTask` while the governed pipeline is executing. The bridge calls `AgentWorkforceService.dispatch()` synchronously and awaits the full result. When dispatch returns, the result is immediately terminal.

There is no `RECEIVED` or `RUNNING` state to persist because:
- Creation directly as `DISPATCHING` makes the unique row itself the dispatch-ownership claim; there is no persisted pre-claim state that duplicate callers could redispatch
- The governed pipeline's internal states (`AgentExecutionStatus.RUNNING`, etc.) are already tracked by the existing `GovernedExecutionRecord`
- The bridge has no callback mechanism to observe or update intermediate states
- `DISPATCHING` means ownership was claimed, not that execution is confirmed active

Similarly, `RESULT_READY` is collapsed into the terminal states (`COMPLETED`, `HUMAN_GATE`, `FAILED`) because the result is returned in the same HTTP response.

### 5.4 What Is NOT a Persisted Task State

**Authentication and authorization are guard-layer decisions, not task lifecycle states.** `JwtAuthGuard`, `ScopedMachineIdentityGuard`, and `RolesGuard` execute before the controller handler and before any `OperatorTask` record is created. If auth fails, the request is rejected with 401/403 -- no task record is created, no audit entry is written for a non-existent task.

The states `AUTHENTICATED` and `AUTHORIZED` from v0.1 design revision 1 are removed. They are implicitly satisfied when a task record exists (task creation requires passing all guards).

### 5.5 Mapping to Existing Governed Invocation States

The bridge state machine is a **view** over existing internal states. It does **not** duplicate them:

| Bridge State | Internal State(s) |
|-------------|-------------------|
| `DISPATCHING` | Bridge ownership claim committed; an internal envelope may not exist yet |
| `COMPLETED` | `AgentExecutionStatus.SUCCEEDED` + `OperatorTask.status = COMPLETED` |
| `HUMAN_GATE` | `AgentExecutionStatus.POLICY_BLOCKED` + `PolicyReasonCode.RELEASE_GATE_NOT_APPROVED` |
| `FAILED` | `AgentExecutionStatus.FAILED` or `TIMED_OUT` or other terminal error |

The bridge state machine exists solely to present a simplified external view. It is **not** a second execution engine.

---

## 6. Autonomy Policy (Corrected)

### 6.1 Operating Principle

**Default = autonomous continuation; human escalation = exception.**

### 6.2 Sandbox Reality Check

The coding sandbox (Bubblewrap) provides:
- **Network: DENIED** (`--unshare-net`)
- **Workspace: EPHEMERAL** (cleaned after every execution)
- **Output: GOVERNED CHANGE-SET** (diff/patch captured before cleanup)

There is **no durable SCM apply, commit, or push capability** within the sandbox or RemoteExecutionWorker. The worker returns a governed change-set (binary diff) for external application by a separate SCM control plane.

### 6.3 v0.1 Autonomy Classification

#### AUTO (Autonomous Continuation -- Implemented in v0.1)

These operations execute within the governed sandbox and produce reversible results:

| Operation | Justification |
|-----------|---------------|
| Repository analysis (read/analyze) | Read-only, no side effects |
| Isolated workspace creation | Transient, cleaned after execution |
| Code edits inside governed sandbox | Ephemeral workspace; diff is the only output |
| Tests / build / typecheck | Read-only side effects (no persistent mutation) |
| Governed change-set capture | `git diff --cached --binary` -- no push, no commit |
| Review / rework cycles | All within ephemeral workspace |

On successful completion, the task reaches `COMPLETED` -- meaning the result is available for client retrieval.

#### DEFERRED SCM CONTROL-PLANE CAPABILITY (Not Implemented in v0.1)

These operations require a **separate VITO SCM capability** that does not yet exist:

| Operation | Why Deferred |
|-----------|-------------|
| Branch creation | Requires persistent git checkout; sandbox workspace is ephemeral |
| Patch application into persistent checkout | No persistent checkout exists; worker returns diff only |
| Git commit | Requires persistent git state |
| Git push | Requires network access (sandbox denies `--unshare-net`) |

**Future architecture:** `Coding Provider -> governed change-set -> VITO SCM capability -> branch/commit/push`

This preserves the trust boundary: the coding sandbox never has network access, and SCM operations are performed by a dedicated, authorized VITO capability outside the sandbox.

**Do not give the coding sandbox network access merely to enable push.** The `--unshare-net` policy is a fundamental security property of the sandbox design.

#### HUMAN GATE (Requires Explicit Approval)

| Operation | Justification |
|-----------|---------------|
| Merge to protected/main branch | Irreversible without force-push; requires SCM capability (deferred) |
| Production deployment | Potentially irreversible external side effect (deferred) |
| Credential / secret changes | Security-critical; potential blast radius (deferred) |
| Destructive data operations | Data loss risk (deferred) |
| External communications | Reputational/legal risk (deferred) |
| Purchases / cost commitments | Financial commitment (deferred) |
| Material security-policy changes | Security posture impact (deferred) |

### 6.4 v0.1 Scope Limitation

In v0.1, there is **no dedicated risk-class policy engine**. The `evaluatePolicy()` function (EO-01.4) governs execution at the adapter level (which actions are allowed for which execution profiles). The autonomy classification above is a **design-time document** that guides what capabilities are implemented.

The bridge's autonomy behavior in v0.1 is simple:
- If dispatch returns with `SUCCEEDED` status -> `COMPLETED` (result available for retrieval)
- If dispatch returns with `POLICY_BLOCKED` -> `HUMAN_GATE` (human intervention required)
- If dispatch returns with any error -> `FAILED` (terminal error)

No automated downstream actions (auto-merge, auto-deploy, etc.) are triggered in v0.1.

---

## 7. Threat Model

| # | Threat | Mitigation |
|---|--------|------------|
| T1 | **Forged external requests** | JWT authentication via `JwtAuthGuard`; per-request DB verification of user/org/token_version; signature verification |
| T2 | **Replay attacks** | `requestId` + `requestFingerprint` idempotency at bridge layer (tenant-scoped); existing `GovernedInvocationIdempotencyStore` prevents duplicate execution at invocation layer |
| T3 | **Cross-tenant request** | `organizationId` derived exclusively from JWT (`org_id` claim); `TenantContext.getOrThrow()` enforces; `ProviderRouterService` scoped to org; `requestId` uniqueness scoped to org |
| T4 | **Prompt attempting authority escalation** | Bridge translates intent only; no execution fields pass through; `evaluatePolicy()` (EO-01.4) is mandatory gate; `ExecutionProfileResolver` is trusted |
| T5 | **Provider/executable injection** | `ProviderRouterService` selects provider by capability; `TrustedLocalExecutableResolver` verifies binary; `RepositoryRegistry` validates repo; none controlled by operator |
| T6 | **Repository/ref injection** | `RepositoryRegistry` is a trusted server-side registry; `isBaseRefAllowed()` validates ref; operator never specifies repo URL or ref |
| T7 | **Oversized request/result** | Request: `MAX_PROMPT_BYTES` (512KB), `MAX_ARG_LENGTH` (4096), `MAX_DEFAULT_ARGS` (64); Result: upstream `MAX_PATCH_BYTES` (2MB) fail-closed change-set capture, bridge `MAX_SAFE_TEXT_LENGTH` (2000) for log-safe text |
| T8 | **Result/patch exfiltration** | Prompt, stdout, stderr, and error/log-safe text use appropriate bounding/redaction policies; the authoritative patch is never rewritten and is protected by exact machine authorization, tenant isolation, retention deletion, blocked public production exposure, and audit/debug metadata that records size/count only |
| T9 | **Secret leakage** | `CredentialBroker` and governed-runtime credential-reference protections remain applicable upstream; patches can contain sensitive source or secret-like text, so the bridge preserves patch integrity and relies on strict access, isolation, no-body logging, bounded upstream capture, and deletion rather than silently mutating the artifact |
| T10 | **Task-result enumeration** | taskId is UUID (unpredictable); queries scoped to authenticated `organizationId`; no bulk enumeration endpoint in v0.1 |
| T11 | **Duplicate dispatch** | Transaction A creates one tenant-scoped unique row directly as `DISPATCHING`; only the successful creator owns dispatch; unique-race losers re-read and never dispatch; existing governed invocation idempotency remains defense in depth |
| T12 | **Client disconnect/retry** | Same-key retries return the existing terminal or `DISPATCHING` task; stale ownership is never reclaimed in v0.1, preferring possible non-execution over accidental double execution |
| T13 | **Compromised bridge credential** | Global `ScopedMachineIdentityGuard` denies the scoped MEMBER from every endpoint except exact `@MachineScope('vito-bridge')` opt-ins; tokenVersion revocation; org scoping; credential never enters payloads/logs |
| T14 | **Patch body in audit logs** | Patch is classified as sensitive engineering payload (Section 12); audit records store only changed-file count and patch byte size, never the patch body |
| T15 | **Stale task confusion** | `DISPATCHING` means ownership claimed, not confirmed liveness; no automatic retry, reclaim, or resumption; same-key submission only returns the row; a new logical attempt requires a new requestId |
| T16 | **Idempotency fingerprint mismatch** | Same `requestId` + different `requestFingerprint` -> fail closed with `OPERATOR_IDEMPOTENCY_CONFLICT`; prevents semantically different requests from appearing idempotent |
| T17 | **Machine identity reaches unrelated MEMBER/public endpoint** | Every authenticated non-null machine scope is globally default-denied; route metadata must explicitly require the exact scope; presented Bearer tokens on public routes are authenticated before authorization |
| T18 | **Expired sensitive payload retained** | Purgeable columns are nullable and actual deletion is represented explicitly; public production exposure is prohibited until a deployed cleanup mechanism physically enforces expiry |

---

## 8. Connectivity Model

### 8.1 How ChatGPT Actually Reaches This Bridge

| Layer | v0.1 (Development) | v0.2 (Staging) | v0.3 (Production) |
|-------|--------------------|----------------|--------------------|
| **VITO API** | `localhost:3000` | Internal service only | Public exposure blocked until retention gate passes |
| **Bridge endpoint** | `localhost:3000/v1/operator/*` | Same, on trusted/internal network only | Eligible for HTTPS ingress only after cleanup is deployed and verified |
| **Network** | Local only | Private network; temporary development tunnel only | HTTPS + mTLS or VPN after gate |
| **ChatGPT access** | Not possible (localhost) | Deferred to OB-002; development tunnel only | Deferred to OB-002 and retention gate |

### 8.2 Development Path (Safest Incremental)

1. **Local dev** (`localhost` only): Bridge runs on same NestJS server; tested via curl/Postman; no external access
2. **Tunnel** (optional): `cloudflared tunnel` or `ngrok` for temporary external access; development only; never production
3. **Internal staging**: Private reverse proxy; HTTPS termination; rate limiting; IP allowlist; no public ingress
4. **Public production**: **FORBIDDEN in v0.1.** Eligibility requires an implemented, deployed, tested, and monitored payload-cleanup mechanism that physically clears expired sensitive fields

### 8.3 Do Not Assume ChatGPT Can Call Localhost

ChatGPT's function-calling and plugin systems require a publicly reachable HTTPS endpoint. Localhost is unreachable from ChatGPT's runtime. The design must not assume direct localhost access.

### 8.4 ChatGPT Integration Options

| Option | Description | v0.1 |
|--------|-------------|------|
| **Custom GPT Action** | OpenAPI spec defining bridge endpoints; ChatGPT calls via Actions | Viable for demo |
| **MCP Server** | Model Context Protocol server exposing bridge as tool | Deferred |
| **OpenAI Connector** | Custom connector for ChatGPT Enterprise | Deferred |
| **Webhook callback** | Bridge posts results to ChatGPT webhook | Deferred |

**v0.1 recommendation:** Keep the bridge API OpenAPI-compatible and ChatGPT-agnostic. Actual public ChatGPT connectivity remains the explicit VITO-OB-002 follow-on and cannot be enabled until the sensitive-payload cleanup deployment gate passes.

---

## 9. Architecture Decision: Reuse vs. New Module

### 9.1 Decision: Thin Facade, Full Pipeline Reuse

| Component | Action | Rationale |
|-----------|--------|-----------|
| `AgentWorkforceController` | **No change** | Existing dispatch endpoint remains for internal workflow-runtime callers |
| `AgentWorkforceService` | **No change** | Core dispatch logic remains untouched |
| `ProviderRouterService` | **No change** | Deterministic routing remains the authority |
| `GovernedRuntimeService` | **No change** | Workspace file operations remain governed |
| `GovernedInvocationServiceImpl` | **No change** | Invocation pipeline, policy, idempotency all preserved |
| `RemoteExecutionWorker` | **No change** | Sandbox execution remains bounded |
| `JwtStrategy` / authenticated principal | **Minimal change** | Read DB-backed machine classification and scope into `request.user`; JWT claims remain unchanged |
| `JwtAuthGuard` | **Minimal change** | Authenticate a presented Bearer token even on public routes so machine scope cannot bypass global authorization |
| `RolesGuard` | **No policy change** | Existing role enforcement remains and runs after machine-scope authorization |
| **New: global `ScopedMachineIdentityGuard`** | **New global guard** | Default-deny every machine-scoped identity except exact route opt-ins |
| **New: `@MachineScope()` decorator** | **New decorator** | Declares the exact machine scope required by a route |
| **New: `OperatorBridgeModule`** | **New module** | Thin translation layer |
| **New: `OperatorBridgeController`** | **New controller** | `/v1/operator/tasks` endpoints |
| **New: `OperatorBridgeService`** | **New service** | Intent -> dispatch translation, idempotency |
| **New: `OperatorTask` model** | **New Prisma model** | Persistent task state for external consumption |

### 9.2 Why Not Reuse `/agent-workforce/dispatch` Directly

The existing endpoint requires `workflowRunId` and `workflowStepRunId` -- workflow-runtime-specific concepts that an external operator does not naturally provide. Forcing an operator to create `WorkflowRun` + `WorkflowStepRun` before dispatching would:
1. Leak internal orchestration details to external clients
2. Require the operator to manage VITO's internal state machine
3. Create a tight coupling between the external interface and the workflow engine

The bridge facade absorbs this complexity: it creates the necessary internal records from operator-level intent.

---

## 10. Proposed Files and Modules

### 10.1 New Files

```
apps/api/src/common/
  decorators/
    machine-scope.decorator.ts            -- @MachineScope() exact-scope metadata
  guards/
    scoped-machine-identity.guard.ts      -- global default-deny machine authorization
    scoped-machine-identity.guard.spec.ts -- global guard policy tests

apps/api/src/modules/operator-bridge/
  operator-bridge.module.ts              -- NestJS module definition
  operator-bridge.controller.ts          -- HTTP endpoints (POST /tasks, GET /tasks/:id)
  operator-bridge.service.ts             -- Transaction A/dispatch/Transaction B orchestration
  operator-bridge.config.ts              -- TTL parsing and v0.1 public-exposure gate
  operator-bridge.config.spec.ts         -- configuration and exposure-gate tests
  dto/
    submit-operator-task.dto.ts          -- Request validation DTO
    submit-operator-task.dto.spec.ts     -- Request validation tests
  operator-bridge.service.spec.ts        -- Unit tests
  operator-bridge.controller.spec.ts     -- Controller tests
  operator-bridge.pg.spec.ts             -- PostgreSQL transaction/race/purge integration tests
  idempotency.ts                         -- requestFingerprint computation
  idempotency.spec.ts                    -- canonical fingerprint tests

packages/contracts/src/engineering/
  operator-bridge.ts                     -- Shared types (OperatorTaskStatus, OperatorTaskError)

prisma/
  migrations/
    20260826000000_add_operator_bridge/
      migration.sql                      -- stable machine identity/scope + OperatorTask schema
```

### 10.2 Expected Modifications to Existing Files

The design goal is **minimal additive integration**. The following existing files require modification:

| File | Modification | Reason |
|------|-------------|--------|
| `.env.example` | Document `SENSITIVE_PAYLOAD_TTL_HOURS` and `OPERATOR_BRIDGE_EXPOSURE=internal` | Make retention intent and the v0.1 non-public deployment mode explicit |
| `prisma/schema.prisma` | Add `User.isMachineIdentity`, `User.machineScope`, `OperatorTask`, and `Organization.operatorTasks` | Stable global machine classification and external task persistence |
| `apps/api/src/app.module.ts` | Add `OperatorBridgeModule` to `imports` array | Register new module in application composition |
| `apps/api/src/common/auth/authenticated-user.interface.ts` | Add `isMachineIdentity` and `machineScope` | Carry DB-derived machine classification and scope on `request.user` |
| `apps/api/src/modules/auth/strategies/jwt.strategy.ts` | Return the current DB machine classification and scope | Authorization changes take effect per request without new JWT claims |
| `apps/api/src/modules/auth/guards/jwt-auth.guard.ts` | Authenticate presented Bearer credentials on `@Public()` routes | Prevent scoped credentials from bypassing the global scope guard via public endpoints |
| `apps/api/src/modules/auth/auth.module.ts` | Register `ScopedMachineIdentityGuard` globally between JWT and roles guards | Enforce machine-scope default denial across all modules |
| `apps/api/test/app.e2e-spec.ts` | Add matching/wrong scope, unrelated MEMBER endpoint, public-route Bearer, and ordinary MEMBER regressions | Prove the global invariant through the composed application |
| `apps/api/package.json` | Add mandatory `test:operator-bridge:pg` script | Make real PostgreSQL ownership/race tests an explicit implementation-gate command |
| `packages/contracts/src/engineering/index.ts` | Export Operator Bridge contracts from the established engineering barrel | Preserve existing package export structure |
| `packages/contracts/src/index.ts` | Add export for `OperatorTaskStatus` enum and `OperatorTaskError` | Shared type visibility across packages |

No existing execution service, provider router, governed runtime, adapter, worker, or controller is modified. `AgentWorkforceService.dispatch()` remains the unchanged execution entry point. The authorization changes above are required because bridge-only method guard composition cannot enforce the machine restriction globally.

### 10.3 Prisma Schema Addition

```prisma
enum OperatorTaskStatus {
  DISPATCHING
  COMPLETED
  HUMAN_GATE
  FAILED
}

model OperatorTask {
  id                  String   @id @default(uuid())
  organizationId      String
  userId              String
  requestId           String
  requestFingerprint  String
  correlationId       String
  workflowRunId       String
  workflowStepRunId   String
  capabilityCode      String
  prompt              String?  @db.Text  // required on create; nullable only for retention cleanup
  assuranceLevel      String?
  status              OperatorTaskStatus // explicitly created as DISPATCHING

  // Execution budget
  maxDurationMs       Int?
  maxTokens           Int?
  maxCostMinorUnits   Int?

  // Execution results (populated after completion)
  invocationId        String?
  executionId         String?
  routingDecisionId   String?
  providerCode        String?
  providerName        String?
  stdout              String?  @db.Text
  stderr              String?  @db.Text
  changedFiles        Json?    // string[]
  patch               String?  @db.Text  // SENSITIVE: governed change-set
  errorReason         String?
  errorMessage        String?
  errorRetryable      Boolean?
  reviewRequired      Boolean  @default(false)
  workspaceDisposition String?

  // Timing
  startedAt           DateTime?
  completedAt         DateTime?
  durationMs          Int?

  // Sensitive payload retention
  sensitivePayloadAvailable Boolean  @default(true)
  sensitivePayloadExpiresAt DateTime
  sensitivePayloadDeletedAt DateTime?

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  // Relations
  organization        Organization @relation(fields: [organizationId], references: [id])

  // Tenant-scoped idempotency: same requestId + same fingerprint = idempotent
  // same requestId + different fingerprint = conflict
  // same requestId + different org = independent valid tasks
  @@unique([organizationId, requestId])
  @@index([organizationId, status])
  @@index([organizationId, correlationId])
  @@index([sensitivePayloadAvailable, sensitivePayloadExpiresAt])
  @@map("operator_tasks")
}
```

Additionally, `User` receives a stable machine discriminator plus exact nullable scope, and `Organization` receives the task relation:

```prisma
model User {
  // ... existing fields ...
  isMachineIdentity Boolean @default(false)
  machineScope      String?
  // ... existing fields ...
}

model Organization {
  // ... existing fields ...
  operatorTasks OperatorTask[]
  // ... existing relations ...
}
```

The migration adds a database check that prohibits `isMachineIdentity = false` with a non-null scope. A machine identity may have a null scope, but the global guard then denies every endpoint; this supports fail-closed de-scoping without converting the account to a human. Only `isMachineIdentity = true` with exact `machineScope = 'vito-bridge'` can satisfy the two v0.1 bridge route decorators. Both fields are immutable through the existing user API and are not emitted in ordinary user responses. Provisioning sets them through an authorized operational database process; revocation suspends/deletes the user or increments `tokenVersion`, and never flips `isMachineIdentity` to false.

### 10.4 Idempotency Semantics (Corrected)

#### Request Fingerprint

A **requestFingerprint** is a canonical logical-operation signature derived from the exact validated fields that will be persisted and dispatched. It prevents semantically different requests from appearing idempotent when the same `requestId` is reused. Validation does not silently case-fold or trim capability and assurance values; if normalization is ever introduced, the same canonical object must drive fingerprinting, persistence, and dispatch.

**Fingerprint computation** (`idempotency.ts`):

```typescript
import { createHash } from 'crypto';

interface FingerprintInput {
  readonly capabilityCode: string;
  readonly prompt: string;
  readonly assuranceLevel?: string;
  readonly budget?: {
    readonly maxDurationMs?: number;
    readonly maxTokens?: number;
    readonly maxCostMinorUnits?: number;
  };
}

function computeRequestFingerprint(input: FingerprintInput): string {
  const canonical = JSON.stringify({
    capabilityCode: input.capabilityCode,
    prompt: input.prompt,  // raw prompt, no normalization (whitespace is significant)
    assuranceLevel: input.assuranceLevel ?? null,
    budget: {
      maxDurationMs: input.budget?.maxDurationMs ?? null,
      maxTokens: input.budget?.maxTokens ?? null,
      maxCostMinorUnits: input.budget?.maxCostMinorUnits ?? null,
    },
  });
  return createHash('sha256').update(canonical).digest('hex');
}
```

The fingerprint is **persisted with `OperatorTask.requestFingerprint`** and used in the transactional create-or-resolve logic.

#### Transaction A: Atomic Claim/Create

The canonical fingerprint is computed **before** opening a transaction. Transaction A contains database operations only and commits before any agent code runs.

**Semantics:**

| Scenario | Behavior |
|----------|----------|
| Existing same tenant/request key + different fingerprint | Fail closed with `OPERATOR_IDEMPOTENCY_CONFLICT`; never dispatch |
| Existing same tenant/request key + terminal state | Return the cached result; never dispatch |
| Existing same tenant/request key + `DISPATCHING` | Return the existing in-flight/stale task; **never redispatch or reclaim** |
| Absent same tenant/request key | Create directly as `DISPATCHING`; successful creator acquires dispatch ownership |
| Same `requestId` + different `organizationId` | Independent tenant-scoped claims and executions |
| Cross-tenant task lookup | Reject because every query includes the JWT-derived `organizationId` |

The `@@unique([organizationId, requestId])` constraint is the ownership arbiter. An initial read is not sufficient because two transactions can both observe absence. If creation loses with Prisma `P2002`, that failed transaction is over; the loser re-reads the committed row using the normal Prisma client, verifies the fingerprint, and returns it. The loser **MUST NOT execute dispatch**. If the post-race row cannot be read, the request fails closed with an internal persistence error; it does not guess ownership.

#### Dispatch: Outside Every Transaction

Only a request whose committed Transaction A result has `ownsDispatch: true` may call `AgentWorkforceService.dispatch()`. No Prisma transaction object is passed to dispatch, and no transaction callback or interactive transaction remains open while the coding agent executes.

#### Transaction B: Terminal Persistence

Dispatch success, policy block, timeout, and thrown errors are mapped to one terminal update. A separate short Transaction B conditionally updates the owned `DISPATCHING` row and returns its persisted state. If Transaction B fails, the API returns a persistence failure and does not claim that a terminal result is durable; the row can remain stale `DISPATCHING` and is not redispatched in v0.1.

When a future cleanup worker can overlap a long execution, Transaction B must not repopulate payload fields already deleted or expired. It always persists non-sensitive status/correlation/execution metadata. If the payload is still available and unexpired, it persists result payloads normally. If cleanup already ran or expiry passed during execution, Transaction B atomically nulls all four sensitive fields, sets `sensitivePayloadAvailable = false`, and sets `sensitivePayloadDeletedAt` if not already present. This prevents a produced-but-discarded result from being misrepresented as merely "not produced."

**Implementation pattern:**

```typescript
async submitTask(request: SubmitOperatorTaskRequest, context: TenantContext) {
  // Canonicalization and tenant/request-key resolution happen before Transaction A.
  const fingerprint = computeRequestFingerprint(request);
  const key = {
    organizationId: context.organizationId,
    requestId: request.requestId,
  };
  const newTaskIdentity = {
    id: uuid(),
    correlationId: uuid(),
    workflowRunId: uuid(),
    workflowStepRunId: uuid(),
  };

  let claim: { task: OperatorTask; ownsDispatch: boolean };
  try {
    claim = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.operatorTask.findUnique({
        where: { organizationId_requestId: key },
      });

      if (existing) {
        return this.resolveExisting(existing, fingerprint); // conflict or ownsDispatch: false
      }

      const task = await tx.operatorTask.create({
        data: {
          ...key,
          ...newTaskIdentity,
          userId: context.userId,
          requestFingerprint: fingerprint,
          capabilityCode: request.capabilityCode,
          prompt: request.prompt,
          assuranceLevel: request.assuranceLevel,
          status: 'DISPATCHING',
          maxDurationMs: request.budget?.maxDurationMs,
          maxTokens: request.budget?.maxTokens,
          maxCostMinorUnits: request.budget?.maxCostMinorUnits,
          sensitivePayloadAvailable: true,
          sensitivePayloadExpiresAt: this.computePayloadExpiry(),
        },
      });
      return { task, ownsDispatch: true };
    }); // Transaction A commits here.
  } catch (error) {
    if (!isOperatorRequestKeyConflict(error)) throw error;

    // The losing transaction has rolled back. Re-read; never dispatch from this path.
    const existing = await this.prisma.operatorTask.findUnique({
      where: { organizationId_requestId: key },
    });
    if (!existing) throw new OperatorClaimPersistenceException();
    claim = this.resolveExisting(existing, fingerprint); // always ownsDispatch: false
  }

  if (!claim.ownsDispatch) return this.toResponse(claim.task);

  // No database transaction is open while the governed agent pipeline executes.
  let terminal: TerminalOperatorTaskUpdate;
  try {
    const result = await this.agentWorkforceService.dispatch(
      this.toAgentDispatchRequest(claim.task),
    );
    terminal = this.mapDispatchResult(result);
  } catch (error) {
    terminal = this.mapDispatchFailure(error);
  }

  return this.prisma.$transaction(async (tx) => {
    // Transaction B: persist terminal state and either retain or atomically clear payload.
    return this.persistTerminalResult(tx, claim.task.id, terminal);
  });
}
```

`resolveExisting()` compares the fingerprint before considering state. A match always returns `ownsDispatch: false`, whether status is terminal or `DISPATCHING`; no code path turns an existing row into dispatch ownership. The design therefore provides an at-most-one bridge dispatch claim, not automatic recovery.

`isOperatorRequestKeyConflict()` accepts only Prisma `P2002` whose target is the `(organizationId, requestId)` unique constraint. UUID collisions or any other database error propagate and never enter the race-loser return path.

`workflowRunId` and `workflowStepRunId` are bridge-generated UUID correlation identities persisted in Transaction A and passed unchanged to the existing `AgentWorkforceService.dispatch()` signature. They do not create or imply `WorkflowRun` / `WorkflowStepRun` records: the governed persistence models use these values as correlation fields rather than foreign keys. Persisting them ensures retries and audit queries observe stable identifiers without involving `WorkflowRuntimeService`.

### 10.5 Tests Required

| File | Required coverage |
|------|-------------------|
| `apps/api/src/common/guards/scoped-machine-identity.guard.spec.ts` | Human passes an ordinary route; exact machine scope passes an opted-in route; machine on an undecorated route fails; machine with null/wrong/empty/unknown scope fails; inconsistent human+scope fails; human on a machine-required route fails |
| `apps/api/src/modules/operator-bridge/idempotency.spec.ts` | Stable canonical fingerprint; case/whitespace significance; omitted versus explicit assurance; budget/default distinctions; same canonical object persisted/dispatched |
| `apps/api/src/modules/operator-bridge/dto/submit-operator-task.dto.spec.ts` | UUID, exact UTF-8 byte limit, capability, assurance, and budget validation |
| `apps/api/src/modules/operator-bridge/operator-bridge.service.spec.ts` | Intent translation with stable persisted workflow IDs; Transaction A commit before dispatch; no transaction client reaches dispatch; existing terminal and existing `DISPATCHING` never dispatch; all dispatch outcomes enter Transaction B; thrown dispatch error maps to FAILED; Transaction B failure is surfaced without a false terminal response; authoritative patch round-trips byte-for-byte while remaining absent from bridge audit events |
| `apps/api/src/modules/operator-bridge/operator-bridge.controller.spec.ts` | Tenant context use, POST owner/duplicate response shapes, tenant-scoped GET, purged GET representation |
| `apps/api/src/modules/operator-bridge/operator-bridge.pg.spec.ts` | Real PostgreSQL unique races, one owner/one dispatch, different-fingerprint conflict, cross-tenant independence, authoritative patch byte-for-byte persistence without audit-body leakage, Transaction B before/after expiry, cleanup overlap, and atomic payload clearing semantics |
| `apps/api/src/modules/operator-bridge/operator-bridge.config.spec.ts` | TTL parsing; internal/local mode allowed; `OPERATOR_BRIDGE_EXPOSURE=public` rejected in v0.1, including production |
| `apps/api/test/app.e2e-spec.ts` | Composed auth and API behavior: `vito-bridge` machine allowed on both bridge routes; same identity denied on unrelated `POST /tasks`; ordinary MEMBER retains existing `/tasks` behavior; machine with null/wrong scope denied from bridge; scoped Bearer denied on unrelated public route; cross-tenant GET rejected; suspension/token-version revokes machine access without reclassifying it as human |

The test double around Prisma must expose transaction lifetime so the service test can assert that `AgentWorkforceService.dispatch()` begins only after Transaction A has resolved and no transaction callback is active. A simple call-order assertion without transaction-lifetime tracking is insufficient.

The implementation gate runs `OPERATOR_BRIDGE_TEST_DATABASE_URL=<isolated-postgres-url> pnpm --filter @vito/api test:operator-bridge:pg`. The script applies migrations to an isolated database, runs `operator-bridge.pg.spec.ts` serially, and fails rather than skips when the URL is absent. This is intentionally separate from unit tests so the ownership proof cannot silently pass without PostgreSQL.

### 10.6 Concurrency Idempotency Tests (Detailed)

These PostgreSQL-backed tests verify that concurrent duplicate submissions cannot execute twice and that a race loser cannot accidentally inherit ownership.

**Test: Concurrent submission with same requestId**

```
Setup: Two parallel HTTP requests with identical requestId, same org, same payload
Expected:
  - Both requests receive the same taskId
  - Only ONE dispatch is executed
  - Exactly one Transaction A result owns dispatch
  - The unique-constraint loser re-reads the row after its failed transaction
  - The loser returns the existing DISPATCHING or terminal task without dispatch
  - OperatorTask table contains exactly one row for this requestId
```

**Test: Concurrent submission with same requestId, different fingerprint**

```
Setup: Two parallel HTTP requests with identical requestId, same org, different payload
Expected:
  - Exactly one payload wins the unique claim and is dispatched once
  - The loser re-reads the winner and receives OPERATOR_IDEMPOTENCY_CONFLICT
  - The loser never dispatches
  - OperatorTask table contains exactly one row
```

**Test: Concurrent submission, same requestId, different orgs**

```
Setup: Two parallel HTTP requests with identical requestId, different orgs
Expected:
  - Both requests create separate tasks (independent tenants)
  - Both dispatch independently
  - OperatorTask table contains two rows (one per org)
```

**Test: Existing or stale DISPATCHING task**

```
Setup: Pre-create a matching DISPATCHING row, including one older than normal execution time
Expected:
  - Submission returns that taskId and DISPATCHING state
  - dispatch() is never called
  - No status, owner, lease, or timestamp is mutated to reclaim the task
```

**Test: Sensitive payload deletion semantics**

```
Setup: Create expired and unexpired rows, including null result fields that were never produced
Expected:
  - Before deletion, sensitivePayloadAvailable=true; a null output means "not produced"
  - Cleanup simulation atomically nulls prompt, patch, stdout, and stderr only on expired rows
  - Cleared rows set sensitivePayloadAvailable=false and sensitivePayloadDeletedAt
  - Transaction B that observes expiry clears all four fields and records deletion instead of storing produced result payloads
  - Transaction B overlapping an already-completed cleanup preserves the unavailable state and never repopulates payloads
  - sensitivePayloadExpiresAt and durable idempotency/audit metadata survive
  - GET after deletion returns all four fields as null plus sensitivePayloadAvailable=false
  - Repeating cleanup is idempotent; unexpired rows remain unchanged
```

---

## 11. Autonomy Policy (Corrected)

*(This section has been merged into Section 6 for clarity. Section 11 in revision 2 is superseded.)*

---

## 12. Sensitive Payload Retention

### 12.1 Classification

The following fields are classified as **sensitive engineering payloads**:

| Field | Content | Sensitivity |
|-------|---------|-------------|
| `OperatorTask.prompt` | Operator instruction/prompt | Contains task specification; may include business logic details |
| `OperatorTask.patch` | Governed change-set (binary diff) | Full source code of modified files; structural codebase information |
| `OperatorTask.stdout` | Execution stdout | May contain file contents, test output, code excerpts |
| `OperatorTask.stderr` | Execution stderr | May contain error messages with code context |

The authoritative governed patch is also integrity-bearing. The Operator Bridge stores it
byte-for-byte as returned by the upstream governed execution pipeline and **MUST NOT**
pattern-redact, truncate, normalize, or otherwise rewrite it. The upstream governed runtime's
exact credential-reference protections remain applicable where provided, including at the
adapter boundary, but they do not establish that arbitrary source changes are secret-free. A
patch may therefore contain sensitive source material or strings that resemble or contain
credentials.

Prompt, stdout, stderr, and error/log-safe text may use appropriate field-specific redaction and
bounding policies because they are not the authoritative change-set. The compensating controls
for the unmodified patch are exact machine authorization, tenant-isolated retrieval, omission of
the patch body from audit and debug logs, bounded and fail-closed upstream change-set capture,
retention deletion, and the prohibition on public production exposure in Section 12.4. Future
secret-content scanning may reject or flag a patch, or produce a separately labelled
non-authoritative preview, but it may never silently mutate the authoritative artifact.

**None of these fields are stored in audit logs.** Audit records store only:
- `changedFiles.length` (count)
- `Buffer.byteLength(patch, 'utf8')` (patch size)
- `capabilityCode`, `correlationId`, timing metadata

All four database columns are nullable even though `prompt` is required in the POST DTO. Nullability is required so physical payload deletion is executable without deleting the durable task row.

### 12.2 Retention Policy (v0.1)

| Data Category | Retention | Mechanism |
|---------------|-----------|-----------|
| **Durable task metadata** (`requestId`, `requestFingerprint`, `capabilityCode`, status, correlation/workflow/execution/routing/timing metadata) | Indefinite (within v0.1 scope) | Survives sensitive-payload deletion in the `OperatorTask` row |
| **Sensitive payloads** (`prompt`, `patch`, `stdout`, `stderr`) | Configurable expiry | Nullable columns + expiry + actual availability/deletion markers; physical cleanup required to enforce |
| **Audit event metadata** | Indefinite (existing `AuditEvent` retention) | Existing `AuditService` |

**`sensitivePayloadExpiresAt` computation:**
- Default: `createdAt + SENSITIVE_PAYLOAD_TTL_HOURS` (configurable via environment variable, default 72 hours)
- Set at task creation time (before dispatch)
- It records policy intent only. **Expiry by itself is not deletion and is not enforced retention.**
- The scheduled cleanup mechanism is deferred to v0.2; therefore v0.1 is restricted to internal/local development exposure

**When cleanup runs (v0.2):**
```sql
-- Scheduled job (BullMQ or pg-cron):
UPDATE operator_tasks
SET
  prompt = NULL,
  patch = NULL,
  stdout = NULL,
  stderr = NULL,
  "sensitivePayloadAvailable" = FALSE,
  "sensitivePayloadDeletedAt" = NOW()
WHERE "sensitivePayloadAvailable" = TRUE
  AND "sensitivePayloadExpiresAt" <= NOW();
```

The cleanup update clears all four fields and flips availability in one database statement. It deliberately preserves `sensitivePayloadExpiresAt` as policy/audit evidence. Cleanup is idempotent because already-unavailable rows no longer match. The v0.2 worker must define and monitor its sweep interval and maximum deletion latency before the production gate can pass.

### 12.3 GET Semantics Before and After Deletion

`GET /v1/operator/tasks/:taskId` reports actual storage state, not a value inferred solely from the clock:

| State | Response semantics |
|-------|--------------------|
| Payload retained | `sensitivePayloadAvailable: true`; `prompt` is present; any null `patch`/`stdout`/`stderr` means that output was not produced |
| Expired but cleanup not yet run | Still reports actual retained state; this condition is permitted only in internal/local v0.1 and demonstrates why expiry alone is not enforcement |
| Payload physically deleted | `sensitivePayloadAvailable: false`; `prompt`, `patch`, `stdout`, and `stderr` are all `null`; `sensitivePayloadDeletedAt` is populated |

`sensitivePayloadExpiresAt` remains visible after deletion. Consumers must use `sensitivePayloadAvailable`, not null output fields or wall-clock comparison, to distinguish deletion from an output that was never produced.

### 12.4 Public Production Exposure Gate

> **External/public production exposure of the Operator Bridge is forbidden until an actual payload-cleanup mechanism enforces configured expiry.**

For v0.1, `OPERATOR_BRIDGE_EXPOSURE` must remain `internal`; module configuration rejects `public` mode. Local and trusted internal development may proceed without the scheduled cleanup worker. This prohibition cannot be waived merely because `sensitivePayloadExpiresAt` is populated.

The gate may pass only when all of the following are true:

1. A cleanup worker or database scheduler is implemented and deployed.
2. It atomically clears all four sensitive columns and records actual deletion.
3. Expired/unexpired, retry/idempotency, and Transaction B race tests pass against PostgreSQL.
4. Scheduling health, last-success time, deletion count, failures, and maximum deletion latency are monitored and alerted.
5. The deployment/release review explicitly authorizes `OPERATOR_BRIDGE_EXPOSURE=public`.

The scheduled worker remains deferred to v0.2. VITO-OB-002 and any ChatGPT connector inherit this gate and cannot create public production exposure before it passes.

### 12.5 Why Not Indefinite Retention

- Sensitive payloads contain source code, file contents, and task specifications
- These are high-value targets for data exfiltration
- Bounded retention limits the blast radius of a credential compromise
- VITO engineering tenants should not accumulate unlimited source code artifacts
- Nullable columns plus explicit deletion metadata make cleanup executable without destroying idempotency or audit evidence

### 12.6 Why Not a Separate Artifact Store

For v0.1, the inline patch approach (within 2MB `MAX_PATCH_BYTES`) is sufficient:
- Simplifies the architecture (no S3/GCS dependency)
- The patch is already bounded by `GovernedResultSettling`
- A separate artifact store adds operational complexity (bucket policies, lifecycle rules, access patterns) disproportionate to v0.1 volume
- Deferred to v0.2 if patch volumes grow beyond inline viability

---

## 13. Follow-On Integration: VITO-OB-002

### 13.1 Definition

Operator Bridge v0.1 (VITO-OB-001) exposes the secure provider-neutral API. This alone does **not** allow ChatGPT to invoke VITO. A separate engineering block is required:

**VITO-OB-002 -- ChatGPT <-> VITO Tool/Connector Integration**

### 13.2 Scope (VITO-OB-002)

| Responsibility | In Scope |
|----------------|----------|
| Expose Operator Bridge as an authorized ChatGPT-callable tool | Yes |
| Credential handling for ChatGPT connector | Yes |
| Request/result mapping (ChatGPT function call -> `SubmitOperatorTask` / result -> ChatGPT response) | Yes |
| OpenAPI spec for Custom GPT Action | Yes |
| MCP server for programmatic tool access | Yes (stretch) |
| No new execution authority | **Invariant** -- ChatGPT still requests, VITO still authorizes, provider still executes |
| Public production exposure | **Blocked** until the Section 12.4 cleanup gate passes |

### 13.3 Separation Rationale

OB-002 is separated from OB-001 because:

1. **Credential handling is ChatGPT-specific**: OAuth2, API keys, or connector tokens are different from VITO's internal JWT auth
2. **Request mapping may evolve**: ChatGPT's function-calling schema may change; the mapping layer should be isolated
3. **Testing is integration-heavy**: Requires a ChatGPT sandbox environment; not unit-testable in isolation
4. **Deployment is separate**: ChatGPT connector requires a publicly reachable HTTPS endpoint; v0.1 is localhost-only

### 13.4 Dependency

OB-002 depends on OB-001 being implemented and tested. OB-001 must be implemented first. OB-002 development may use local/internal environments, but its public production deployment additionally depends on the sensitive-payload cleanup gate.

**Do not implement OB-002 in OB-001.** The invariant `ChatGPT requests -> VITO authorizes -> Provider executes` is preserved across both blocks.

---

## 14. v0.1 Scope

### 14.1 In Scope

| Item | Status |
|------|--------|
| Secure operator API/facade (`/v1/operator/tasks`) | Design complete |
| Globally restricted machine auth (MEMBER + DB scope + global guard) | Design complete |
| Submit task (intent-level only, synchronous) | Design complete |
| Get task status/result (tenant-scoped) | Design complete |
| Request fingerprint idempotency with conflict detection | Design complete |
| Short Transaction A claim + transaction-free dispatch + short Transaction B | Design complete |
| Reuse `AgentWorkforceService.dispatch()` | Existing, unchanged |
| OpenCode as first configured provider | Existing `LOCAL_TOOL` adapter |
| Audit/correlation (full trail) | Existing `AuditService` |
| `OperatorTask` persistence (tenant-scoped idempotency) | Design complete |
| Nullable sensitive payloads, actual-deletion indicator, and configurable expiry | Design complete for internal/local v0.1 |
| Public production exposure | Prohibited until cleanup gate passes |
| BASELINE_GATE / AUTONOMY_GATE policies | Design complete |
| Unit + integration tests (including concurrency) | Design complete |
| VITO-OB-002 follow-on recorded | Design complete |

### 14.2 Explicitly Deferred (v0.2+)

| Item | Rationale |
|------|-----------|
| Branch creation / commit / push (SCM control plane) | Requires persistent git state + network; sandbox denies both; separate VITO capability needed |
| Patch application into persistent checkout | No persistent checkout exists in v0.1 |
| Streaming / WebSocket | Adds complexity; synchronous sufficient for v0.1 |
| Multi-worker scheduler / durable background execution | Requires job queue; synchronous sufficient for v0.1 budget limits |
| Stale `DISPATCHING` recovery/reclaim | Cannot safely distinguish pre-dispatch crash from completed execution; v0.1 never redispatches an existing claim |
| Artifact store (beyond inline patch) | Inline patch within 2MB limit sufficient for v0.1 |
| Auto-merge | Requires SCM capability (deferred) |
| Production deployment automation | Separate concern; not in bridge scope |
| OAuth2 client credentials flow | Service account JWT sufficient for v0.1 |
| Dedicated service-credential table/guard | Existing JWT lifecycle plus global DB-backed machine scope is sufficient for v0.1 |
| MCP server integration | Deferred to VITO-OB-002 |
| ChatGPT connector/plugin | Deferred to VITO-OB-002 |
| Operator audit dashboard | Existing audit events queryable via API |
| Risk-class-based auto-continue policy engine | Manual human gate sufficient for v0.1 |
| Sensitive payload cleanup worker | Deferred to v0.2; until deployed and monitored, public production exposure remains forbidden |
| Cross-organization operator federation | Not in scope |

---

## 15. Migration Path Toward Provider-Neutral Coding Agents

### 15.1 Current State

The existing architecture is already provider-neutral:
- `ProviderRouterService` selects providers by capability, not by vendor
- `GovernedProviderAdapter` interface abstracts execution
- `HeadlessLocalAgentAdapter` / `RemoteExecutionWorker` are one implementation
- OpenCode is one configured provider (via `commandAlias` in provider metadata)

### 15.2 Operator Bridge Enables Provider Neutrality for External Clients

The bridge does **not** introduce a new provider model. It translates operator intent into the existing capability-based dispatch. This means:

1. **Adding a new provider** requires only: register in `ProviderRegistryService`, assign capabilities, configure adapter. Bridge automatically routes to it.
2. **External clients are provider-agnostic** -- they specify `capabilityCode`, not provider.
3. **Provider selection remains server-side** -- operators never see or control which provider executes.

### 15.3 Future: SCM Control Plane

When the SCM control plane is implemented (v0.2+):

```
Coding Provider -> governed change-set -> VITO SCM capability -> branch/commit/push
```

The coding sandbox retains `--unshare-net`. SCM operations are performed outside the sandbox by an authorized VITO capability that has network access and persistent git state. This preserves the security invariant: the coding provider never has direct SCM access.

---

## 16. Architecture Conflicts

### 16.1 Conflict Assessment

| Area | Conflict? | Resolution |
|------|-----------|------------|
| `AgentWorkforceController` | **None** | Bridge creates a parallel endpoint; existing endpoint unchanged |
| `AgentWorkforceService` | **None** | Bridge delegates to existing service; no internal changes |
| `TenantContext` | **None** | Bridge uses existing JWT-derived tenant context |
| `JwtAuthGuard` | **Minimal composition change** | Presented Bearer tokens on public routes must authenticate so machine authorization cannot be bypassed |
| `JwtStrategy` / `AuthenticatedUser` | **Minimal additive change** | Current DB machine classification and scope are carried on `request.user`; JWT claims and TenantContext remain unchanged |
| `RolesGuard` | **None** | Existing role policy remains and composes after machine-scope authorization |
| Global authorization | **Additive but cross-cutting** | New `ScopedMachineIdentityGuard` is an `APP_GUARD`; ordinary unscoped humans are unaffected |
| `ProviderRouterService` | **None** | Bridge does not bypass routing |
| `GovernedRuntimeService` | **None** | Bridge does not bypass governed runtime |
| `GovernedInvocationServiceImpl` | **None** | Bridge does not bypass invocation pipeline |
| `RemoteExecutionWorker` | **None** | Bridge does not bypass sandbox |
| `WorkflowRuntimeService` | **None** | Bridge does not use workflow runtime (v0.1) |
| Prisma schema | **Additive** | Stable machine discriminator/scope, new `OperatorTask`, and `Organization.operatorTasks` relation |
| AppModule | **Additive** | New import only |
| Contracts barrel | **Additive** | New export only (if shared types used) |

### 16.2 Architectural Invariant Preserved

> **Operator/ChatGPT requests work. VITO authorizes work. Provider executes work.**
> **The external bridge must never become a second control plane.**

The bridge is a thin translation layer:
- It does not decide which provider executes
- It does not decide the execution profile
- It does not decide the execution policy
- It does not resolve executables
- It does not inject credentials
- It does not manage sandboxes
- It does not evaluate idempotency (it adds its own layer, but does not replace the existing one)
- It does not perform SCM operations (deferred to separate capability)

All authorization and execution authority remains in the existing governed runtime stack.

---

## 17. Summary of Major Architecture Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Thin facade over existing pipeline | Reuse over duplication; existing pipeline is battle-tested |
| D2 | Global DB-backed machine-scope guard + MEMBER role | Machine identities fail closed on every route except exact opt-ins; ordinary human RBAC remains unchanged |
| D3 | Synchronous owner dispatch outside database transactions | Transaction A commits ownership first; Transaction B persists terminal state; no transaction spans agent execution |
| D4 | Intent-level request only | External clients never control execution parameters |
| D5 | `OperatorTask` as external state view | Decouples external interface from internal workflow state machine |
| D6 | No streaming in v0.1 | Complexity reduction; synchronous sufficient |
| D7 | No SCM operations in v0.1 (deferred control plane) | Sandbox denies network; workspace ephemeral; separate capability needed |
| D8 | Unique `DISPATCHING` claim + request fingerprint | Exactly one request owns dispatch; race losers re-read and never dispatch; stale tasks are not reclaimed in v0.1 |
| D9 | Patch classified as sensitive engineering payload | Not in audit logs; tenant-scoped reads; bounded size |
| D10 | No durable background execution in v0.1 | Honest about Node.js request lifecycle guarantees |
| D11 | Provider-neutral capability codes | Bridge does not encode provider knowledge |
| D12 | Full audit trail for operator tasks | Accountability; leverages existing `AuditService` |
| D13 | Executable sensitive-payload deletion model | Four nullable fields, explicit actual-availability/deletion metadata, and durable idempotency/audit metadata |
| D14 | Public production exposure blocked in v0.1 | Expiry metadata alone is not enforcement; cleanup worker remains deferred to v0.2 |
| D15 | VITO-OB-002 as separate follow-on block | ChatGPT integration adds no execution authority and inherits the production retention gate |

---

## 18. Deliverable Checklist

| Item | Status |
|------|--------|
| Architecture fit assessment | Complete (Section 1) |
| Trust boundaries | Complete (Section 2) |
| Authentication / least-privilege machine auth | Complete (Section 3) |
| Reuse vs. new module decision | Complete (Section 9) |
| API/contracts proposal | Complete (Section 4) |
| State machine (simplified) | Complete (Section 5) |
| Autonomy/human-gate matrix | Complete (Section 6) |
| Threat model | Complete (Section 7) |
| Network/connectivity model | Complete (Section 8) |
| Files/modules proposed | Complete (Section 10) |
| Prisma schema (nullable payload + fingerprint + deletion metadata) | Complete (Section 10.3) |
| Transactional dispatch ownership and idempotency | Complete (Section 10.4) |
| Concurrency tests | Complete (Section 10.6) |
| Sensitive payload retention | Complete (Section 12) |
| Public production exposure constraint | Complete (Section 12.4) |
| Follow-on integration (VITO-OB-002) | Complete (Section 13) |
| Tests required | Complete (Section 10.5) |
| v0.1 scope | Complete (Section 14.1) |
| Deferred items | Complete (Section 14.2) |
| Migration path toward provider-neutral coding agents | Complete (Section 15) |
| Architecture conflicts | Complete (Section 16) |

---

**READY FOR IMPLEMENTATION GATE: YES**

**PUBLIC PRODUCTION EXPOSURE GATE: NO -- blocked until payload cleanup is implemented, deployed, tested, and monitored.**
