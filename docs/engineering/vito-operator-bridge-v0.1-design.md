---
record_type: architecture-design
record_id: VITO-OB-001
title: "Operator Bridge v0.1"
system: vito-platform
subsystem: operator-bridge
status: PROPOSED
created: 2026-08-25
updated: 2026-08-25
author: VITO Engineering
review_gate: ARCHITECTURE_REVIEW
related_pr: null
related_branch: design/vito-operator-bridge-v0.1
supersedes: null
superseded_by: null
baseline:
  branch: main
  sha: "cc0250278b3265caa8ad4b789a1f9091255fdefe"
revision: 3
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
| OPERATOR BRIDGE GUARD         |  <-- OperatorBridgeGuard (scoped permissions)
|  - @OperatorScope('vito-bridge') |
|  - role >= MEMBER             |
|  - operator_scope validation  |
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
       -> TenantContext.set({ organizationId, userId, role, authenticationMethod: 'jwt' })
  -> RolesGuard (global APP_GUARD, request-scoped)
       -> @Roles(MEMBER, ADMIN, OWNER) check
  -> OperatorBridgeGuard (method-scoped)
       -> @OperatorScope('vito-bridge') check
       -> operator_scope claim validation
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

### 3.2 v0.1 Decision: Scoped Service Credential via Existing Auth Stack

**A compromised operator credential must not automatically become general VITO ADMIN authority.**

The existing auth system has four roles: `OWNER > ADMIN > MEMBER > VIEWER`. The operator service account must not receive `OWNER` or `ADMIN` roles, as those grant access to unrelated administrative surfaces (user management, source vault, audit query, digital employee management).

#### Chosen approach: Scoped service user + dedicated bridge guard

| Component | Decision | Rationale |
|-----------|----------|-----------|
| **Service account role** | `MEMBER` | Excludes OWNER/ADMIN surfaces (user mgmt, source vault, audit, digital employees). MEMBER can write tasks; bridge guard further restricts to bridge-only operations. |
| **JWT payload** | Standard `JwtPayload` (`sub`, `org_id`, `role`, `token_version`) | No auth stack changes. `role: 'MEMBER'` embedded in existing JWT structure. |
| **Operator scope claim** | Custom claim via `JwtStrategy`: extend `AuthenticatedUser` with `operatorScope?: string` | Resolved from `User.metadata` (JSON field) during `JwtStrategy.validate()`. Lightweight; no new table. |
| **Bridge guard** | `OperatorBridgeGuard` with `@OperatorScope('vito-bridge')` decorator | Validates `operatorScope === 'vito-bridge'` on `TenantContext`. Methods without the decorator pass through. |

#### What this protects against

| Threat | Mitigation |
|--------|------------|
| Compromised operator credential accesses user management | `MEMBER` role excluded from `@Roles(OWNER, ADMIN)` endpoints |
| Compromised operator credential queries other tenants | `TenantContext.organizationId` bound to JWT; cross-tenant queries rejected |
| Compromised operator credential accesses source vault | `@Roles(OWNER, ADMIN)` on source vault endpoints; `MEMBER` denied |
| Compromised operator credential modifies audit records | Audit endpoints are read-only and `@Roles(OWNER, ADMIN)` protected |
| Credential enters prompts/payloads/logs | Never; enforced by code convention (credential exists only in `Authorization` header, parsed once by Passport, stored in `TenantContext` as `organizationId`/`userId`/`role` only) |

#### Credential storage topology

```
External connector/client credential vault
  -> HTTPS Authorization header
  -> VITO ingress (JwtAuthGuard / Passport)
  -> Verified user/org from DB
  -> TenantContext populated (org, userId, role only)
  -> Bridge guard validates scope
```

**VITO must not store its own incoming Bearer token in OperatorBridge configuration.** The credential vault lives outside VITO (external client responsibility). VITO stores only the service account `User` record with `role: MEMBER` and `operatorScope: 'vito-bridge'` in `metadata`.

### 3.3 Why Not Other Options

| Option | Rejected Because |
|--------|-----------------|
| **General OWNER/ADMIN credential** | Exposes user management, source vault, audit, digital employee admin, and all other OWNER/ADMIN endpoints. A compromised credential becomes a full VITO admin. **BLOCKER** by review. |
| **Dedicated `OperatorServiceCredentialGuard` (new table, API-key hash)** | Cleanest long-term solution but requires a new credential issuance/storage/rotation system. Excessive scope for v0.1 where an existing `MEMBER` user with a scoped JWT suffices. Deferred to v0.2. |
| **OAuth2 client credentials flow** | Requires OAuth2 infrastructure (token endpoint, client registration). Overengineered for v0.1. Deferred. |
| **IP allowlist only** | Insufficient for machine-to-machine auth; no identity, no tenant binding, no revocation. |

### 3.4 Security Properties (v0.1)

- JWT bound to a specific organization (`org_id` claim) and role (`MEMBER`)
- Per-request DB verification ensures user and org remain active (`JwtStrategy.validate()`)
- `tokenVersion` allows immediate revocation (increment `User.tokenVersion`)
- `@Roles(MEMBER, ADMIN, OWNER)` enforced by `RolesGuard` -- OWNER/ADMIN endpoints unreachable with MEMBER credential
- `@OperatorScope('vito-bridge')` enforced by `OperatorBridgeGuard` -- only bridge endpoints reachable
- Bridge controller reads `organizationId` from `TenantContext` only -- never from request body
- Credential never enters prompts, payloads, logs, sandbox environment, or provider payload
- Service account `User` record is a standard VITO user with standard lifecycle (can be suspended/deleted)

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

  /** Bounded instruction/prompt (1-524288 chars). */
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

  /** Task status (terminal on success/failure). */
  readonly status: OperatorTaskStatus;

  /** Routing decision ID. */
  readonly routingDecisionId: string;
}

/** Full result from GET /v1/operator/tasks/:taskId */
interface OperatorTaskResult {
  readonly taskId: string;
  readonly requestId: string;
  readonly status: OperatorTaskStatus;
  readonly correlationId: string;

  /** Execution IDs for audit trail. */
  readonly invocationId?: string;
  readonly executionId?: string;

  /** Selected provider metadata (where disclosure is permitted). */
  readonly provider?: {
    readonly providerCode: string;
    readonly displayName: string;
  };

  readonly capabilityCode: string;

  /** Bounded stdout summary (truncated to MAX_SAFE_TEXT_LENGTH = 2000). */
  readonly stdout?: string;

  /** Bounded stderr summary (truncated to MAX_SAFE_TEXT_LENGTH = 2000). */
  readonly stderr?: string;

  /** Changed files list. */
  readonly changedFiles?: readonly string[];

  /** Governed patch (sensitive engineering payload -- see Section 12). */
  readonly patch?: string;

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

  /** Sensitive payload expiry (if applicable). */
  readonly sensitivePayloadExpiresAt?: string;

  readonly createdAt: string;
  readonly updatedAt: string;
}
```

### 4.4 Synchronous Semantics (Corrected)

**v0.1: Fully synchronous execution with POST.**

The lifecycle of a single `POST /v1/operator/tasks` request:

1. **Persist `OperatorTask`** in `RECEIVED` status (before dispatch, so retry is idempotent)
2. **Invoke `AgentWorkforceService.dispatch()` synchronously** (await the full governed pipeline)
3. **Persist terminal result** in `OperatorTask` (COMPLETED, HUMAN_GATE, or FAILED)
4. **Return `SubmitOperatorTaskResponse`** with terminal status

The governed execution runs **within the HTTP request lifecycle**. There is no background job queue, no decoupled worker, and no durable async execution in v0.1.

**Client disconnect during execution:**
- If the client disconnects (HTTP timeout, network failure) while `AgentWorkforceService.dispatch()` is running, the NestJS request lifecycle may be aborted.
- The governed invocation pipeline (`GovernedInvocationServiceImpl.invoke()`) will continue to completion within the Node.js event loop until the adapter returns or the governed timeout fires.
- The `OperatorTask` may or may not be updated to terminal status depending on whether the `finally` block in the controller executes.
- If the task remains in `RECEIVED` or `DISPATCHING` status after client disconnect, it is a **stale in-flight task** -- not a durable background job.
- The client can poll via `GET /v1/operator/tasks/:taskId` and will see either the terminal result or a non-terminal status.
- **No automatic retry or resumption of stale tasks is provided in v0.1.** The client may resubmit with the same `requestId` and same `requestFingerprint` (idempotent -- returns existing task if already terminal, or re-dispatches if still in RECEIVED).

**Durable background execution is deferred to v0.2** (requires a job queue such as BullMQ or a Postgres-backed outbox pattern).

---

## 5. Operator Task State Machine (Simplified)

### 5.1 States

```
RECEIVED
  -> DISPATCHING
       -> COMPLETED | HUMAN_GATE | FAILED
```

### 5.2 State Definitions

| State | Description | Entry Condition | Persistence |
|-------|-------------|-----------------|-------------|
| `RECEIVED` | Task received and persisted; idempotency resolved | HTTP request arrives; OperatorTask created (transactional) | Persisted before dispatch |
| `DISPATCHING` | Submitted to `AgentWorkforceService.dispatch()`; awaiting governed pipeline | Service call initiated | Persisted before `dispatch()` call |
| `COMPLETED` | Execution completed; result delivered to client | Dispatch returned terminal success | Terminal |
| `HUMAN_GATE` | Task policy-blocked; requires human approval | `evaluatePolicy()` returned non-ALLOW | Terminal |
| `FAILED` | Task failed (terminal) | Any terminal error from dispatch | Terminal |

### 5.3 Why No RUNNING or RESULT_READY State

For synchronous v0.1, there is **no runtime callback** that updates `OperatorTask` while the governed pipeline is executing. The bridge calls `AgentWorkforceService.dispatch()` synchronously and awaits the full result. When dispatch returns, the result is immediately terminal.

There is no intermediate `RUNNING` state to persist because:
- The governed pipeline's internal states (`AgentExecutionStatus.RUNNING`, etc.) are already tracked by the existing `GovernedExecutionRecord`
- The bridge has no callback mechanism to observe or update intermediate states
- Claiming a `RUNNING` state on `OperatorTask` would be dishonest -- the bridge cannot confirm execution is actively running

Similarly, `RESULT_READY` is collapsed into the terminal states (`COMPLETED`, `HUMAN_GATE`, `FAILED`) because the result is returned in the same HTTP response.

### 5.4 What Is NOT a Persisted Task State

**Authentication and authorization are guard-layer decisions, not task lifecycle states.** `JwtAuthGuard`, `RolesGuard`, and `OperatorBridgeGuard` execute before the controller handler and before any `OperatorTask` record is created. If auth fails, the request is rejected with 401/403 -- no task record is created, no audit entry is written for a non-existent task.

The states `AUTHENTICATED` and `AUTHORIZED` from v0.1 design revision 1 are removed. They are implicitly satisfied when a task record exists (task creation requires passing all guards).

### 5.5 Mapping to Existing Governed Invocation States

The bridge state machine is a **view** over existing internal states. It does **not** duplicate them:

| Bridge State | Internal State(s) |
|-------------|-------------------|
| `RECEIVED` | `OperatorTask.status = RECEIVED` (no internal state yet) |
| `DISPATCHING` | `GovernedOperationEnvelope.status = PENDING` |
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
| T7 | **Oversized request/result** | Request: `MAX_PROMPT_BYTES` (512KB), `MAX_ARG_LENGTH` (4096), `MAX_DEFAULT_ARGS` (64); Result: `MAX_PATCH_BYTES` (2MB), `MAX_SAFE_TEXT_LENGTH` (2000) |
| T8 | **Result/patch exfiltration** | `redactSecretMaterial()` applied to all output; `sanitizeGovernedReferenceList()` filters non-gov:// refs; patch logged only as size; `workspaceDisposition: 'CLEANED'` |
| T9 | **Secret leakage** | `CredentialBroker` provides reference-only at adapter boundary; secrets never enter prompts, audit, or result; `redactTrustedSecretsDeep()` applied recursively |
| T10 | **Task-result enumeration** | taskId is UUID (unpredictable); queries scoped to authenticated `organizationId`; no bulk enumeration endpoint in v0.1 |
| T11 | **Duplicate dispatch** | `requestId` + `requestFingerprint` idempotency at bridge (tenant-scoped); `GovernedInvocationIdempotencyStore` at invocation level; `buildGovernedLogicalOperationKey()` prevents duplicate consequential actions |
| T12 | **Client disconnect/retry** | Task persists with terminal status if pipeline completes; `GET /v1/operator/tasks/:taskId` returns cached result; re-submission with same `requestId` + same fingerprint returns existing task |
| T13 | **Compromised bridge credential** | Service account is `MEMBER` role; `@OperatorScope('vito-bridge')` restricts to bridge endpoints only; `tokenVersion` revocation; org-scoped; credential never enters prompts/payloads/logs |
| T14 | **Patch body in audit logs** | Patch is classified as sensitive engineering payload (Section 12); audit records store only changed-file count and patch byte size, never the patch body |
| T15 | **Stale task confusion** | Tasks that remain in non-terminal status after client disconnect are explicitly documented as stale; no automatic retry/resumption; client must re-submit or poll |
| T16 | **Idempotency fingerprint mismatch** | Same `requestId` + different `requestFingerprint` -> fail closed with `OPERATOR_IDEMPOTENCY_CONFLICT`; prevents semantically different requests from appearing idempotent |

---

## 8. Connectivity Model

### 8.1 How ChatGPT Actually Reaches This Bridge

| Layer | v0.1 (Development) | v0.2 (Staging) | v0.3 (Production) |
|-------|--------------------|----------------|--------------------|
| **VITO API** | `localhost:3000` | Internal service | Internal service |
| **Bridge endpoint** | `localhost:3000/v1/operator/*` | Same, behind reverse proxy | Same, behind reverse proxy |
| **Network** | Local only | Reverse proxy (nginx/Caddy) | HTTPS + mTLS or VPN |
| **ChatGPT access** | Not possible (localhost) | ChatGPT connector / custom plugin | OpenAI connector or MCP-style integration |

### 8.2 Development Path (Safest Incremental)

1. **Local dev** (`localhost` only): Bridge runs on same NestJS server; tested via curl/Postman; no external access
2. **Tunnel** (optional): `cloudflared tunnel` or `ngrok` for temporary external access; development only; never production
3. **Reverse proxy** (staging): HTTPS termination; rate limiting; IP allowlist
4. **Production**: Dedicated HTTPS endpoint; WAF; ChatGPT connector/plugin for programmatic access

### 8.3 Do Not Assume ChatGPT Can Call Localhost

ChatGPT's function-calling and plugin systems require a publicly reachable HTTPS endpoint. Localhost is unreachable from ChatGPT's runtime. The design must not assume direct localhost access.

### 8.4 ChatGPT Integration Options

| Option | Description | v0.1 |
|--------|-------------|------|
| **Custom GPT Action** | OpenAPI spec defining bridge endpoints; ChatGPT calls via Actions | Viable for demo |
| **MCP Server** | Model Context Protocol server exposing bridge as tool | Deferred |
| **OpenAI Connector** | Custom connector for ChatGPT Enterprise | Deferred |
| **Webhook callback** | Bridge posts results to ChatGPT webhook | Deferred |

**v0.1 recommendation:** Design the bridge API to be OpenAPI-compatible so it can be used as a Custom GPT Action. The API contract itself is ChatGPT-agnostic.

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
| `JwtAuthGuard` / `JwtStrategy` | **No change** | Existing JWT auth stack unchanged |
| `RolesGuard` | **No change** | Existing role enforcement unchanged |
| **New: `OperatorBridgeModule`** | **New module** | Thin translation layer |
| **New: `OperatorBridgeController`** | **New controller** | `/v1/operator/tasks` endpoints |
| **New: `OperatorBridgeService`** | **New service** | Intent -> dispatch translation, idempotency |
| **New: `OperatorBridgeGuard`** | **New guard** | `@OperatorScope('vito-bridge')` scoped authorization |
| **New: `@OperatorScope()` decorator** | **New decorator** | Method-level scope metadata |
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
apps/api/src/modules/operator-bridge/
  operator-bridge.module.ts              -- NestJS module definition
  operator-bridge.controller.ts          -- HTTP endpoints (POST /tasks, GET /tasks/:id)
  operator-bridge.service.ts             -- Intent -> dispatch translation, idempotency
  dto/
    submit-operator-task.dto.ts          -- Request validation DTO
  operator-bridge.guard.ts               -- OperatorBridgeGuard (scoped authorization)
  operator-bridge.scope.decorator.ts     -- @OperatorScope() decorator
  operator-bridge.service.spec.ts        -- Unit tests
  operator-bridge.controller.spec.ts     -- Controller tests
  idempotency.ts                         -- requestFingerprint computation

packages/contracts/src/engineering/
  operator-bridge.ts                     -- Shared types (OperatorTaskStatus, OperatorTaskError)

prisma/
  migrations/
    <timestamp>_add_operator_task/       -- OperatorTask table migration
```

### 10.2 Expected Modifications to Existing Files

The design goal is **minimal additive integration**. The following existing files require modification:

| File | Modification | Reason |
|------|-------------|--------|
| `prisma/schema.prisma` | Add `OperatorTask` model + relation to `Organization` | New persistence model for external task state |
| `apps/api/src/app.module.ts` | Add `OperatorBridgeModule` to `imports` array | Register new module in application composition |
| `packages/contracts/src/index.ts` | Add export for `OperatorTaskStatus` enum and `OperatorTaskError` | Shared type visibility across packages |

**No modifications to any existing service, controller, guard, or adapter.** The integration is purely additive: one new module, one new Prisma model, one new import in `AppModule`.

### 10.3 Prisma Schema Addition

```prisma
enum OperatorTaskStatus {
  RECEIVED
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
  capabilityCode      String
  prompt              String   @db.Text
  assuranceLevel      String?
  status              OperatorTaskStatus @default(RECEIVED)

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
  sensitivePayloadExpiresAt DateTime?

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
  @@map("operator_tasks")
}
```

Additionally, the `Organization` model in `schema.prisma` must add:

```prisma
model Organization {
  // ... existing fields ...
  operatorTasks OperatorTask[]
  // ... existing relations ...
}
```

### 10.4 Idempotency Semantics (Corrected)

#### Request Fingerprint

A **requestFingerprint** is a canonical logical-operation signature derived from the normalized request fields. It prevents semantically different requests from appearing idempotent when the same `requestId` is reused.

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
  const normalized = JSON.stringify({
    capabilityCode: input.capabilityCode.trim().toLowerCase(),
    prompt: input.prompt,  // raw prompt, no normalization (whitespace is significant)
    assuranceLevel: (input.assuranceLevel ?? 'standard').trim().toLowerCase(),
    budget: {
      maxDurationMs: input.budget?.maxDurationMs ?? null,
      maxTokens: input.budget?.maxTokens ?? null,
      maxCostMinorUnits: input.budget?.maxCostMinorUnits ?? null,
    },
  });
  return createHash('sha256').update(normalized).digest('hex');
}
```

The fingerprint is **persisted with `OperatorTask.requestFingerprint`** and used in the transactional create-or-resolve logic.

#### Transactional Create-or-Resolve

The idempotency check and task creation are performed in a **single PostgreSQL transaction** to prevent concurrent duplicate submissions from executing twice.

**Semantics:**

| Scenario | Behavior |
|----------|----------|
| Same `requestId` + same `organizationId` + same `requestFingerprint` | **Idempotent**: return existing task. If `RECEIVED`, re-dispatch. If terminal, return cached result. |
| Same `requestId` + same `organizationId` + **different** `requestFingerprint` | **Conflict**: fail closed with `OPERATOR_IDEMPOTENCY_CONFLICT`. The client has reused a `requestId` for a semantically different operation. |
| Same `requestId` + **different** `organizationId` | **Independent**: two completely separate tasks in separate tenants. No collision. |
| Cross-tenant task lookup | **Rejected**: all queries filter by `organizationId` from JWT. No information leakage. |

**Implementation pattern:**

```typescript
// Inside OperatorBridgeService.submitTask(), within a Prisma transaction:
async submitTask(request: SubmitOperatorTaskRequest, context: TenantContext) {
  const fingerprint = computeRequestFingerprint({
    capabilityCode: request.capabilityCode,
    prompt: request.prompt,
    assuranceLevel: request.assuranceLevel,
    budget: request.budget,
  });

  return this.prisma.$transaction(async (tx) => {
    // 1. Check for existing task with same requestId
    const existing = await tx.operatorTask.findUnique({
      where: {
        organizationId_requestId: {
          organizationId: context.organizationId,
          requestId: request.requestId,
        },
      },
    });

    if (existing) {
      // 2a. Fingerprint mismatch -> conflict
      if (existing.requestFingerprint !== fingerprint) {
        throw new OperatorIdempotencyConflictException(existing.taskId);
      }
      // 2b. Fingerprint match -> idempotent return
      return existing;
    }

    // 3. No existing task -> create and dispatch
    const task = await tx.operatorTask.create({
      data: {
        organizationId: context.organizationId,
        userId: context.userId,
        requestId: request.requestId,
        requestFingerprint: fingerprint,
        correlationId: uuid(),
        capabilityCode: request.capabilityCode,
        prompt: request.prompt,
        assuranceLevel: request.assuranceLevel,
        maxDurationMs: request.budget?.maxDurationMs,
        maxTokens: request.budget?.maxTokens,
        maxCostMinorUnits: request.budget?.maxCostMinorUnits,
        sensitivePayloadExpiresAt: this.computePayloadExpiry(),
      },
    });

    // 4. Dispatch synchronously (outside transaction)
    const result = await this.dispatch(task);

    // 5. Update task to terminal state
    await tx.operatorTask.update({
      where: { id: task.id },
      data: this.mapToTerminalUpdate(result),
    });

    return this.loadFinalTask(tx, task.id);
  });
}
```

**Concurrency protection:** The `@@unique([organizationId, requestId])` constraint ensures two concurrent submissions with the same `requestId` cannot both succeed. The second `create` call will throw a Prisma unique constraint violation, which is caught and resolved as an idempotent return (the first submission's task is returned).

### 10.5 Tests Required

| Test Type | Scope | Count (est.) |
|-----------|-------|--------------|
| Unit: `OperatorBridgeService` | Intent translation, result normalization | 6-8 |
| Unit: `computeRequestFingerprint()` | Deterministic fingerprint, normalization, collision resistance | 4-5 |
| Unit: `OperatorBridgeGuard` | Operator authorization policy | 3-4 |
| Unit: DTO validation | Request schema validation | 6-8 |
| Integration: Submit task E2E | Full flow: submit -> dispatch -> result | 3-4 |
| Integration: Idempotency E2E | Same requestId + same org + same fingerprint = same result | 2-3 |
| Integration: Idempotency conflict E2E | Same requestId + same org + different fingerprint = OPERATOR_IDEMPOTENCY_CONFLICT | 2 |
| Integration: Concurrency idempotency | Concurrent duplicate submissions (race condition) = only one task created | 2 |
| Integration: Cross-tenant idempotency | Same requestId + different org = independent tasks | 2 |
| Integration: Cross-tenant rejection | Different org cannot access tasks | 2 |
| Integration: Budget enforcement | Budget limits enforced end-to-end | 2-3 |
| Integration: Patch not in audit logs | Audit records store size, not body | 1-2 |
| Integration: Sensitive payload expiry | `sensitivePayloadExpiresAt` set on task creation | 1-2 |

### 10.6 Concurrency Idempotency Tests (Detailed)

These tests verify that concurrent duplicate submissions cannot execute twice.

**Test: Concurrent submission with same requestId**

```
Setup: Two parallel HTTP requests with identical requestId, same org, same payload
Expected:
  - Both requests receive the same taskId
  - Only ONE dispatch is executed
  - The second request returns the existing task (idempotent)
  - OperatorTask table contains exactly one row for this requestId
```

**Test: Concurrent submission with same requestId, different fingerprint**

```
Setup: Two parallel HTTP requests with identical requestId, same org, different payload
Expected:
  - First request creates task and dispatches
  - Second request receives OPERATOR_IDEMPOTENCY_CONFLICT error
  - OperatorTask table contains exactly one row (the first submission)
```

**Test: Concurrent submission, same requestId, different orgs**

```
Setup: Two parallel HTTP requests with identical requestId, different orgs
Expected:
  - Both requests create separate tasks (independent tenants)
  - Both dispatch independently
  - OperatorTask table contains two rows (one per org)
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

**None of these fields are stored in audit logs.** Audit records store only:
- `changedFiles.length` (count)
- `Buffer.byteLength(patch, 'utf8')` (patch size)
- `capabilityCode`, `correlationId`, timing metadata

### 12.2 Retention Policy (v0.1)

| Data Category | Retention | Mechanism |
|---------------|-----------|-----------|
| **Task metadata** (id, status, timing, correlationId, providerCode) | Indefinite (within v0.1 scope) | `OperatorTask` row persists |
| **Sensitive payloads** (prompt, patch, stdout, stderr) | Configurable expiry | `OperatorTask.sensitivePayloadExpiresAt` |
| **Audit event metadata** | Indefinite (existing `AuditEvent` retention) | Existing `AuditService` |

**`sensitivePayloadExpiresAt` computation:**
- Default: `createdAt + SENSITIVE_PAYLOAD_TTL_HOURS` (configurable via environment variable, default 72 hours)
- Set at task creation time (before dispatch)
- The cleanup mechanism is **deferred to v0.2** -- the field exists in v0.1 for data model readiness, but no scheduled job purges expired payloads until a cleanup worker is implemented

**When cleanup runs (v0.2):**
```sql
-- Scheduled job (BullMQ or pg-cron):
UPDATE operator_tasks
SET
  prompt = NULL,
  patch = NULL,
  stdout = NULL,
  stderr = NULL,
  sensitivePayloadExpiresAt = NULL
WHERE sensitivePayloadExpiresAt < NOW();
```

### 12.3 Why Not Indefinite Retention

- Sensitive payloads contain source code, file contents, and task specifications
- These are high-value targets for data exfiltration
- Bounded retention limits the blast radius of a credential compromise
- VITO engineering tenants should not accumulate unlimited source code artifacts
- The `sensitivePayloadExpiresAt` field ensures the data model supports deletion when the cleanup worker is implemented

### 12.4 Why Not a Separate Artifact Store

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

### 13.3 Separation Rationale

OB-002 is separated from OB-001 because:

1. **Credential handling is ChatGPT-specific**: OAuth2, API keys, or connector tokens are different from VITO's internal JWT auth
2. **Request mapping may evolve**: ChatGPT's function-calling schema may change; the mapping layer should be isolated
3. **Testing is integration-heavy**: Requires a ChatGPT sandbox environment; not unit-testable in isolation
4. **Deployment is separate**: ChatGPT connector requires a publicly reachable HTTPS endpoint; v0.1 is localhost-only

### 13.4 Dependency

OB-002 depends on OB-001 being implemented and tested. OB-001 must be implemented first.

**Do not implement OB-002 in OB-001.** The invariant `ChatGPT requests -> VITO authorizes -> Provider executes` is preserved across both blocks.

---

## 14. v0.1 Scope

### 14.1 In Scope

| Item | Status |
|------|--------|
| Secure operator API/facade (`/v1/operator/tasks`) | Design complete |
| Scoped service auth (MEMBER role + `@OperatorScope`) | Design complete |
| Submit task (intent-level only, synchronous) | Design complete |
| Get task status/result (tenant-scoped) | Design complete |
| Request fingerprint idempotency with conflict detection | Design complete |
| Transactional create-or-resolve | Design complete |
| Reuse `AgentWorkforceService.dispatch()` | Existing, unchanged |
| OpenCode as first configured provider | Existing `LOCAL_TOOL` adapter |
| Audit/correlation (full trail) | Existing `AuditService` |
| `OperatorTask` persistence (tenant-scoped idempotency) | Design complete |
| Sensitive payload retention with configurable expiry | Design complete |
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
| Artifact store (beyond inline patch) | Inline patch within 2MB limit sufficient for v0.1 |
| Auto-merge | Requires SCM capability (deferred) |
| Production deployment automation | Separate concern; not in bridge scope |
| OAuth2 client credentials flow | Service account JWT sufficient for v0.1 |
| Dedicated `OperatorServiceCredentialGuard` (new credential table) | Existing JWT sufficient for v0.1; scoped via `@OperatorScope` |
| MCP server integration | Deferred to VITO-OB-002 |
| ChatGPT connector/plugin | Deferred to VITO-OB-002 |
| Operator audit dashboard | Existing audit events queryable via API |
| Risk-class-based auto-continue policy engine | Manual human gate sufficient for v0.1 |
| Sensitive payload cleanup worker | `sensitivePayloadExpiresAt` field exists; cleanup scheduler deferred to v0.2 |
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
| `JwtAuthGuard` / `RolesGuard` | **None** | Bridge uses existing auth stack; adds operator-specific guard as additional layer |
| `ProviderRouterService` | **None** | Bridge does not bypass routing |
| `GovernedRuntimeService` | **None** | Bridge does not bypass governed runtime |
| `GovernedInvocationServiceImpl` | **None** | Bridge does not bypass invocation pipeline |
| `RemoteExecutionWorker` | **None** | Bridge does not bypass sandbox |
| `WorkflowRuntimeService` | **None** | Bridge does not use workflow runtime (v0.1) |
| Prisma schema | **Additive** | New `OperatorTask` model; relation added to `Organization` |
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
| D2 | Scoped service auth: MEMBER role + `@OperatorScope` | Prevents compromised operator credential from becoming general admin; excludes OWNER/ADMIN surfaces |
| D3 | Synchronous dispatch with explicit disconnect semantics | Bounded execution times; honest about v0.1 durability guarantees |
| D4 | Intent-level request only | External clients never control execution parameters |
| D5 | `OperatorTask` as external state view | Decouples external interface from internal workflow state machine |
| D6 | No streaming in v0.1 | Complexity reduction; synchronous sufficient |
| D7 | No SCM operations in v0.1 (deferred control plane) | Sandbox denies network; workspace ephemeral; separate capability needed |
| D8 | `requestId` + `requestFingerprint` idempotency | Prevents semantically different requests from appearing idempotent; transactional create-or-resolve |
| D9 | Patch classified as sensitive engineering payload | Not in audit logs; tenant-scoped reads; bounded size |
| D10 | No durable background execution in v0.1 | Honest about Node.js request lifecycle guarantees |
| D11 | Provider-neutral capability codes | Bridge does not encode provider knowledge |
| D12 | Full audit trail for operator tasks | Accountability; leverages existing `AuditService` |
| D13 | Sensitive payload retention with configurable expiry | `sensitivePayloadExpiresAt` field; cleanup deferred to v0.2 |
| D14 | VITO-OB-002 as separate follow-on block | ChatGPT integration isolated from bridge security design |

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
| Prisma schema (with fingerprint + expiry) | Complete (Section 10.3) |
| Idempotency semantics (with fingerprint) | Complete (Section 10.4) |
| Concurrency tests | Complete (Section 10.6) |
| Sensitive payload retention | Complete (Section 12) |
| Follow-on integration (VITO-OB-002) | Complete (Section 13) |
| Tests required | Complete (Section 10.5) |
| v0.1 scope | Complete (Section 14.1) |
| Deferred items | Complete (Section 14.2) |
| Migration path toward provider-neutral coding agents | Complete (Section 15) |
| Architecture conflicts | Complete (Section 16) |

---

**READY FOR FINAL OPERATOR BRIDGE ARCHITECTURE GATE: YES**
