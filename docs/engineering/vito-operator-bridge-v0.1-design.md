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
revision: 2
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
       -> @Roles(OWNER, ADMIN) check
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

### 3.2 v0.1 Decision: Existing User JWT via Service Account

**Option A (v0.1): Dedicated user with service-account semantics**

- Create a VITO `User` record with `role: ADMIN` (or `OWNER`) and a known `organizationId`
- Operator authenticates via `POST /auth/login` to obtain a JWT
- The JWT is stored in the bridge's server-side configuration (not in prompts, not in agent payloads)
- The bridge includes the JWT in the `Authorization` header for external-facing requests if needed, but for internal dispatch the `TenantContext` is already populated by `JwtAuthGuard`

This is the cleanest v0.1 approach because:
- Zero changes to `JwtAuthGuard`, `JwtStrategy`, `RolesGuard`, or `TenantContext`
- The JWT is a standard VITO user credential with existing revocation semantics (`tokenVersion`)
- `JwtStrategy.validate()` performs per-request DB verification (user exists, org active, token_version matches)

**Option B (deferred to v0.2): Dedicated service-credential guard**

A custom `ServiceCredentialGuard` that:
- Accepts an API-key-style credential (hashed, stored per-organization)
- Resolves to a synthetic `TenantContext` without requiring a full JWT
- Bypasses the Passport JWT strategy entirely

This is cleaner for machine-to-machine identity but requires a new credential issuance/storage system. **Deferred to v0.2.**

### 3.3 Security Properties (v0.1)

- JWT bound to a specific organization (`org_id` claim)
- Per-request DB verification ensures user and org remain active
- `tokenVersion` allows immediate revocation (increment `User.tokenVersion`)
- `@Roles(OWNER, ADMIN)` enforced by `RolesGuard`
- Bridge controller reads `organizationId` from `TenantContext` only -- never from request body
- No credential ever enters prompts, payloads, logs, or sandbox environment

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

  /** Governed patch (sensitive engineering payload -- see Section 11). */
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

  readonly createdAt: string;
  readonly updatedAt: string;
}
```

### 4.4 Synchronous Semantics (Corrected)

**v0.1: Fully synchronous execution with POST.**

The lifecycle of a single `POST /v1/operator/tasks` request:

1. **Persist `OperatorTask`** in `RECEIVED` status (before dispatch, so retry is idempotent)
2. **Invoke `AgentWorkforceService.dispatch()` synchronously** (await the full governed pipeline)
3. **Persist terminal result** in `OperatorTask` (SUCCEEDED/FAILED/POLICY_BLOCKED)
4. **Return `SubmitOperatorTaskResponse`** with terminal status

The governed execution runs **within the HTTP request lifecycle**. There is no background job queue, no decoupled worker, and no durable async execution in v0.1.

**Client disconnect during execution:**
- If the client disconnects (HTTP timeout, network failure) while `AgentWorkforceService.dispatch()` is running, the NestJS request lifecycle may be aborted.
- The governed invocation pipeline (`GovernedInvocationServiceImpl.invoke()`) will continue to completion within the Node.js event loop until the adapter returns or the governed timeout fires.
- The `OperatorTask` may or may not be updated to terminal status depending on whether the `finally` block in the controller executes.
- If the task remains in `DISPATCHING` or `RUNNING` status after client disconnect, it is a **stale in-flight task** -- not a durable background job.
- The client can poll via `GET /v1/operator/tasks/:taskId` and will see either the terminal result or a non-terminal status.
- **No automatic retry or resumption of stale tasks is provided in v0.1.** The client may resubmit with the same `requestId` (idempotent -- returns existing task if already terminal, or re-dispatches if still in RECEIVED).

**Durable background execution is deferred to v0.2** (requires a job queue such as BullMQ or a Postgres-backed outbox pattern).

---

## 5. Operator Task State Machine (Simplified)

### 5.1 States

```
RECEIVED
  -> DISPATCHING
       -> RUNNING
            -> RESULT_READY
                 -> HUMAN_GATE | COMPLETED | FAILED
```

### 5.2 State Definitions

| State | Description | Entry Condition | Persistence |
|-------|-------------|-----------------|-------------|
| `RECEIVED` | Task received and persisted; awaiting dispatch | HTTP request arrives; OperatorTask created | Persisted before dispatch |
| `DISPATCHING` | Submitted to `AgentWorkforceService.dispatch()`; awaiting governed pipeline | Service call initiated | Persisted before adapter.execute() |
| `RUNNING` | Governing execution pipeline is active (adapter executing in sandbox) | Adapter started | Updated by pipeline |
| `RESULT_READY` | Execution completed; terminal result available | Adapter returned terminal status | Persisted before HTTP response |
| `HUMAN_GATE` | Task policy-blocked; requires human approval | `evaluatePolicy()` returned non-ALLOW | Persisted as terminal-adjacent |
| `COMPLETED` | Task fully settled; result delivered to client | Client retrieved result | Terminal |
| `FAILED` | Task failed (terminal) | Any terminal error | Terminal |

### 5.3 What Is NOT a Persisted Task State

**Authentication and authorization are guard-layer decisions, not task lifecycle states.** `JwtAuthGuard` and `RolesGuard` execute before the controller handler and before any `OperatorTask` record is created. If auth fails, the request is rejected with 401/403 -- no task record is created, no audit entry is written for a non-existent task.

The states `AUTHENTICATED` and `AUTHORIZED` from v0.1 design revision 1 are removed. They are implicitly satisfied when a task record exists (task creation requires passing both guards).

### 5.4 Mapping to Existing Governed Invocation States

The bridge state machine is a **view** over existing internal states. It does **not** duplicate them:

| Bridge State | Internal State(s) |
|-------------|-------------------|
| `RECEIVED` | `OperatorTask.status = RECEIVED` (no internal state yet) |
| `DISPATCHING` | `GovernedOperationEnvelope.status = PENDING` |
| `RUNNING` | `AgentExecutionStatus.RUNNING` (adapter executing) |
| `RESULT_READY` | `AgentExecutionStatus.SUCCEEDED` or terminal error |
| `HUMAN_GATE` | `AgentExecutionStatus.POLICY_BLOCKED` + `PolicyReasonCode.RELEASE_GATE_NOT_APPROVED` |
| `COMPLETED` | `OperatorTask.status = COMPLETED` (result fully delivered) |
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

On successful completion, the task reaches `RESULT_READY` and may `AUTO_CONTINUE` to `COMPLETED` -- meaning the result is available for client retrieval.

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

The bridge's AUTO_CONTINUE behavior in v0.1 is simple:
- If `RESULT_READY` with `SUCCEEDED` status -> `COMPLETED` (result available for retrieval)
- If `RESULT_READY` with `POLICY_BLOCKED` -> `HUMAN_GATE` (human intervention required)
- If `FAILED` -> `FAILED` (terminal error)

No automated downstream actions (auto-merge, auto-deploy, etc.) are triggered by AUTO_CONTINUE in v0.1.

---

## 7. Threat Model

| # | Threat | Mitigation |
|---|--------|------------|
| T1 | **Forged external requests** | JWT authentication via `JwtAuthGuard`; per-request DB verification of user/org/token_version; signature verification |
| T2 | **Replay attacks** | `requestId` idempotency at bridge layer (tenant-scoped); existing `GovernedInvocationIdempotencyStore` prevents duplicate execution at invocation layer |
| T3 | **Cross-tenant request** | `organizationId` derived exclusively from JWT (`org_id` claim); `TenantContext.getOrThrow()` enforces; `ProviderRouterService` scoped to org; `requestId` uniqueness scoped to org |
| T4 | **Prompt attempting authority escalation** | Bridge translates intent only; no execution fields pass through; `evaluatePolicy()` (EO-01.4) is mandatory gate; `ExecutionProfileResolver` is trusted |
| T5 | **Provider/executable injection** | `ProviderRouterService` selects provider by capability; `TrustedLocalExecutableResolver` verifies binary; `RepositoryRegistry` validates repo; none controlled by operator |
| T6 | **Repository/ref injection** | `RepositoryRegistry` is a trusted server-side registry; `isBaseRefAllowed()` validates ref; operator never specifies repo URL or ref |
| T7 | **Oversized request/result** | Request: `MAX_PROMPT_BYTES` (512KB), `MAX_ARG_LENGTH` (4096), `MAX_DEFAULT_ARGS` (64); Result: `MAX_PATCH_BYTES` (2MB), `MAX_SAFE_TEXT_LENGTH` (2000) |
| T8 | **Result/patch exfiltration** | `redactSecretMaterial()` applied to all output; `sanitizeGovernedReferenceList()` filters non-gov:// refs; patch logged only as size; `workspaceDisposition: 'CLEANED'` |
| T9 | **Secret leakage** | `CredentialBroker` provides reference-only at adapter boundary; secrets never enter prompts, audit, or result; `redactTrustedSecretsDeep()` applied recursively |
| T10 | **Task-result enumeration** | taskId is UUID (unpredictable); queries scoped to authenticated `organizationId`; no bulk enumeration endpoint in v0.1 |
| T11 | **Duplicate dispatch** | `requestId` idempotency at bridge (tenant-scoped); `GovernedInvocationIdempotencyStore` at invocation level; `buildGovernedLogicalOperationKey()` prevents duplicate consequential actions |
| T12 | **Client disconnect/retry** | Task persists with terminal status if pipeline completes; `GET /v1/operator/tasks/:taskId` returns cached result; re-submission with same `requestId` returns existing task |
| T13 | **Compromised bridge credential** | Service account JWT has short expiry (default 15m); `tokenVersion` revocation; org-scoped; role-limited; credential never enters prompts/payloads/logs |
| T14 | **Patch body in audit logs** | Patch is classified as sensitive engineering payload (Section 11); audit records store only changed-file count and patch byte size, never the patch body |
| T15 | **Stale task confusion** | Tasks that remain in non-terminal status after client disconnect are explicitly documented as stale; no automatic retry/resumption; client must re-submit or poll |

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
| **New: `OperatorBridgeModule`** | **New module** | Thin translation layer |
| **New: `OperatorBridgeController`** | **New controller** | `/v1/operator/tasks` endpoints |
| **New: `OperatorBridgeService`** | **New service** | Intent -> dispatch translation, result normalization |
| **New: `OperatorTask` model** | **New Prisma model** | Persistent task state for external consumption |
| **New: `OperatorBridgeGuard`** | **New guard** | Operator-specific authorization checks (beyond JWT + roles) |

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
  operator-bridge.service.ts             -- Intent -> dispatch translation
  dto/
    submit-operator-task.dto.ts          -- Request validation DTO
  operator-bridge.guard.ts               -- Operator-specific authorization guard
  operator-bridge.service.spec.ts        -- Unit tests
  operator-bridge.controller.spec.ts     -- Controller tests

packages/contracts/src/engineering/
  operator-bridge.ts                     -- Shared types (OperatorTaskStatus)

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
| `packages/contracts/src/index.ts` | Add export for `OperatorTaskStatus` enum (if shared types are added to contracts package) | Shared type visibility across packages |

**No modifications to any existing service, controller, guard, or adapter.** The integration is purely additive: one new module, one new Prisma model, one new import in `AppModule`.

### 10.3 Prisma Schema Addition

```prisma
enum OperatorTaskStatus {
  RECEIVED
  DISPATCHING
  RUNNING
  RESULT_READY
  HUMAN_GATE
  COMPLETED
  FAILED
}

model OperatorTask {
  id                String   @id @default(uuid())
  organizationId    String
  userId            String
  requestId         String
  correlationId     String
  capabilityCode    String
  prompt            String   @db.Text
  assuranceLevel    String?
  status            OperatorTaskStatus @default(RECEIVED)

  // Execution budget
  maxDurationMs     Int?
  maxTokens         Int?
  maxCostMinorUnits Int?

  // Execution results (populated after completion)
  invocationId      String?
  executionId       String?
  routingDecisionId String?
  providerCode      String?
  providerName      String?
  stdout            String?  @db.Text
  stderr            String?  @db.Text
  changedFiles      Json?    // string[]
  patch             String?  @db.Text  // SENSITIVE: governed change-set
  errorReason       String?
  errorMessage      String?
  errorRetryable    Boolean?
  reviewRequired    Boolean  @default(false)
  workspaceDisposition String?

  // Timing
  startedAt         DateTime?
  completedAt       DateTime?
  durationMs        Int?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  // Relations
  organization      Organization @relation(fields: [organizationId], references: [id])

  // Tenant-scoped idempotency: same requestId + same org = idempotent
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

The `requestId` uniqueness constraint is **tenant-scoped**: `@@unique([organizationId, requestId])`.

| Scenario | Behavior |
|----------|----------|
| Same `requestId`, same `organization` | **Idempotent**: returns existing task/result. If task is in `RECEIVED` status (not yet dispatched), re-dispatches. If terminal, returns cached result. |
| Same `requestId`, different `organization` | **Independent**: two completely separate tasks in separate tenants. No collision. |
| Cross-tenant task lookup | **Rejected**: all queries filter by `organizationId` from JWT. No information leakage. A task from org A cannot be queried by a user from org B. |

### 10.5 Tests Required

| Test Type | Scope | Count (est.) |
|-----------|-------|--------------|
| Unit: `OperatorBridgeService` | Intent translation, result normalization, idempotency | 8-12 |
| Unit: `OperatorBridgeGuard` | Operator authorization policy | 4-6 |
| Unit: DTO validation | Request schema validation | 6-8 |
| Integration: Submit task E2E | Full flow: submit -> dispatch -> result | 3-4 |
| Integration: Idempotency E2E | Same requestId + same org = same result | 2-3 |
| Integration: Cross-tenant idempotency | Same requestId + different org = independent tasks | 2 |
| Integration: Cross-tenant rejection | Different org cannot access tasks | 2 |
| Integration: Budget enforcement | Budget limits enforced end-to-end | 2-3 |
| Integration: Patch not in audit logs | Audit records store size, not body | 1-2 |

---

## 11. Result Security

### 11.1 Patch Classification

**Patch (`OperatorTask.patch`) is classified as sensitive engineering payload.**

The governed change-set (`git diff --cached --binary`) may contain:
- Full source code of modified files
- New file contents (binary diffs)
- Structural information about the codebase

This is high-value information that must not be exposed broadly.

### 11.2 Security Controls

| Control | Implementation |
|---------|---------------|
| **Tenant-scoped authorization** | All `OperatorTask` queries filter by `organizationId` from JWT. No cross-tenant access. |
| **No patch body in audit/debug logs** | Audit records store `changedFiles.length` and `Buffer.byteLength(patch, 'utf8')` only. Never the patch body itself. The existing `AuditService.record()` stores metadata as JSON; the bridge service must not include `patch` in metadata. |
| **Bounded result size** | `MAX_PATCH_BYTES` (2MB) enforced by `change-set-capture.ts`. Oversized patches throw `CHANGESET_TOO_LARGE` before the result is persisted. |
| **Bounded stdout/stderr** | `MAX_OUTPUT_BYTES` (256KB) per stream; `MAX_SAFE_TEXT_LENGTH` (2000) for persisted summary. |
| **Workspace cleanup** | `workspaceDisposition: 'CLEANED'` -- ephemeral workspace is removed after every execution. No persistent code artifacts. |
| **Retention policy** | Deferred to v0.2. In v0.1, `OperatorTask` records persist indefinitely. A future deletion policy should purge completed/failed tasks after a configurable retention period. |

### 11.3 What the Operator Can See

The operator (via `GET /v1/operator/tasks/:taskId`) receives:
- Task status and metadata
- Changed files list (file paths only)
- Patch body (the governed change-set)
- Bounded stdout/stderr summaries
- Provider metadata (sanitized)
- Error information (sanitized)
- Timing information

The operator **cannot** see:
- Internal workflow run IDs
- Internal step run IDs
- Provider internal routing scores
- Execution policy details
- Credential references
- Other tenants' tasks
- Sandbox internal paths

---

## 12. Engineering Workflow Improvement

### 12.1 BASELINE_GATE

Reusable VITO engineering policy: **verify authoritative baseline before code changes.**

```
1. Checkout authoritative baseline branch/SHA
2. Run full test suite (pass = gate satisfied)
3. Run typecheck (pass = gate satisfied)
4. Run lint (pass = gate satisfied)
5. Record baseline SHA in engineering record
6. Only then: create feature branch and implement

Gate failure: STOP. Do not proceed with implementation.
```

**Current implementation:** The `main` branch tip (`cc02502`) is the authoritative baseline. The CI pipeline (`ci.yml`) enforces test + typecheck on every push.

### 12.2 AUTONOMY_GATE

Reusable VITO engineering policy: **autonomous continuation through reversible operations; stop only at explicit human-gate conditions or blocker.**

```
1. Run tests (pass = AUTO_CONTINUE; fail = STOP, fix)
2. Run typecheck (pass = AUTO_CONTINUE; fail = STOP, fix)
3. Run lint (pass = AUTO_CONTINUE; fail = STOP, fix)
4. Evaluate risk class:
   - AUTO operations: continue autonomously
   - HUMAN_GATE operations: STOP, notify operator
   - DEFERRED operations: STOP, document gap
5. If AUTO: commit, push, proceed to next step
6. If HUMAN_GATE: pause, present decision to operator
7. If DEFERRED: document the capability gap, do not implement

Default: CONTINUE. Escalation: EXCEPTION.
```

---

## 13. v0.1 Scope

### 13.1 In Scope

| Item | Status |
|------|--------|
| Secure operator API/facade (`/v1/operator/tasks`) | Design complete |
| Service account authentication (existing JWT stack) | Design complete |
| Submit task (intent-level only, synchronous) | Design complete |
| Get task status/result (tenant-scoped) | Design complete |
| Reuse `AgentWorkforceService.dispatch()` | Existing, unchanged |
| OpenCode as first configured provider | Existing `LOCAL_TOOL` adapter |
| Audit/correlation (full trail) | Existing `AuditService` |
| `OperatorTask` persistence (tenant-scoped idempotency) | Design complete |
| Bounded result contract (patch as sensitive payload) | Design complete |
| BASELINE_GATE / AUTONOMY_GATE policies | Design complete |
| Unit + integration tests | Design complete |

### 13.2 Explicitly Deferred (v0.2+)

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
| Dedicated service-credential guard | Existing JWT sufficient for v0.1 |
| MCP server integration | Deferred to v0.2 |
| ChatGPT connector/plugin | API contract compatible; specific integration deferred |
| Operator audit dashboard | Existing audit events queryable via API |
| Risk-class-based auto-continue policy engine | Manual human gate sufficient for v0.1 |
| Monthly engineering housekeeping scheduler | Deferred |
| Patch retention / deletion policy | Deferred to v0.2 |
| Cross-organization operator federation | Not in scope |

---

## 14. Migration Path Toward Provider-Neutral Coding Agents

### 14.1 Current State

The existing architecture is already provider-neutral:
- `ProviderRouterService` selects providers by capability, not by vendor
- `GovernedProviderAdapter` interface abstracts execution
- `HeadlessLocalAgentAdapter` / `RemoteExecutionWorker` are one implementation
- OpenCode is one configured provider (via `commandAlias` in provider metadata)

### 14.2 Operator Bridge Enables Provider Neutrality for External Clients

The bridge does **not** introduce a new provider model. It translates operator intent into the existing capability-based dispatch. This means:

1. **Adding a new provider** requires only: register in `ProviderRegistryService`, assign capabilities, configure adapter. Bridge automatically routes to it.
2. **External clients are provider-agnostic** -- they specify `capabilityCode`, not provider.
3. **Provider selection remains server-side** -- operators never see or control which provider executes.

### 14.3 Future: SCM Control Plane

When the SCM control plane is implemented (v0.2+):

```
Coding Provider -> governed change-set -> VITO SCM capability -> branch/commit/push
```

The coding sandbox retains `--unshare-net`. SCM operations are performed outside the sandbox by an authorized VITO capability that has network access and persistent git state. This preserves the security invariant: the coding provider never has direct SCM access.

---

## 15. Architecture Conflicts

### 15.1 Conflict Assessment

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

### 15.2 Architectural Invariant Preserved

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

## 16. Summary of Major Architecture Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Thin facade over existing pipeline | Reuse over duplication; existing pipeline is battle-tested |
| D2 | Service account via existing JWT auth | Zero auth stack changes; leverages existing revocation semantics |
| D3 | Synchronous dispatch with explicit disconnect semantics | Bounded execution times; honest about v0.1 durability guarantees |
| D4 | Intent-level request only | External clients never control execution parameters |
| D5 | `OperatorTask` as external state view | Decouples external interface from internal workflow state machine |
| D6 | No streaming in v0.1 | Complexity reduction; synchronous sufficient |
| D7 | No SCM operations in v0.1 (deferred control plane) | Sandbox denies network; workspace ephemeral; separate capability needed |
| D8 | Tenant-scoped `requestId` idempotency | `@@unique([organizationId, requestId])` for multi-tenant safety |
| D9 | Patch classified as sensitive engineering payload | Not in audit logs; tenant-scoped reads; bounded size |
| D10 | No durable background execution in v0.1 | Honest about Node.js request lifecycle guarantees |
| D11 | Provider-neutral capability codes | Bridge does not encode provider knowledge |
| D12 | Full audit trail for operator tasks | Accountability; leverages existing `AuditService` |

---

## 17. Deliverable Checklist

| Item | Status |
|------|--------|
| Architecture fit assessment | Complete (Section 1) |
| Trust boundaries | Complete (Section 2) |
| Reuse vs. new module decision | Complete (Section 9) |
| API/contracts proposal | Complete (Section 4) |
| Authentication decision | Complete (Section 3) |
| State machine | Complete (Section 5) |
| Autonomy/human-gate matrix | Complete (Section 6) |
| Threat model | Complete (Section 7) |
| Network/connectivity model | Complete (Section 8) |
| Files/modules proposed | Complete (Section 10) |
| Tests required | Complete (Section 10.5) |
| v0.1 scope | Complete (Section 13.1) |
| Deferred items | Complete (Section 13.2) |
| Migration path toward provider-neutral coding agents | Complete (Section 14) |
| Architecture conflicts | Complete (Section 15) |
| Result security | Complete (Section 11) |

---

**READY FOR SECOND OPERATOR BRIDGE ARCHITECTURE REVIEW: YES**
