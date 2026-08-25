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
related_branch: null
supersedes: null
superseded_by: null
baseline:
  branch: main
  sha: "cc0250278b3265caa8ad4b789a1f9091255fdefe"
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
                 -> HeadlessLocalAgentAdapter / RemoteExecutionWorker
                      -> Bubblewrap sandbox
                      -> change-set capture
                      -> workspace cleanup
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

### 1.2 Critical Observation: Existing Endpoint Is Nearly Reusable

The existing `POST /agent-workforce/dispatch` endpoint already provides:

- Intent-level input only (capabilityCode + prompt, never executable path)
- Server-side provider resolution
- Server-side trusted execution authority
- Full audit trail

**The current endpoint requires `workflowRunId` and `workflowStepRunId`** -- these are workflow-runtime-specific identifiers that an external operator client does not naturally provide. This is the primary reason a thin facade is warranted rather than direct reuse of the raw dispatch endpoint.

**Decision: Create a thin Operator Bridge facade that:**
1. Accepts operator-level intent (no workflow context required)
2. Creates or references an `OperatorTask` record
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
| OPERATOR BRIDGE FACADE        |  <-- NEW: thin translation layer
|  - Authenticate operator      |
|  - Resolve operator identity  |
|  - Validate operator policy   |
|  - Create OperatorTask        |
|  - Derive workflow context    |
|  - Translate intent -> dispatch|
+-------------------------------+
  |
  | Internal service call (same process)
  v
AgentWorkforceService.dispatch()  <-- EXISTING, UNCHANGED
  |
  v
ProviderRouterService -> GovernedRuntimeService -> GovernedInvocation
  -> Adapter -> Sandbox -> Result
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

- Task request ID (for idempotency and correlation)
- Capability code (what capability is needed)
- Bounded instruction/prompt (the task description)
- Optional governed budget hints (maxDurationMs, maxTokens, maxCostMinorUnits)
- Optional assurance level

All execution authority is derived server-side from:
- Operator identity (JWT / service account)
- Tenant context (organizationId from JWT)
- Provider registry (deterministic routing)
- Execution policy (EO-01.4)
- Trusted resolvers (executable, workspace, profile)

---

## 3. Authentication Model

### 3.1 Current Authentication Stack

```
JwtAuthGuard (global, APP_GUARD)
  -> Passport JwtStrategy.validate()
       -> DB-verified: user exists, org matches, status ACTIVE, token_version matches
  -> TenantContext.set({ organizationId, userId, role, authenticationMethod: 'jwt' })
```

The dispatch endpoint additionally requires `@Roles(UserRole.OWNER, UserRole.ADMIN)`.

### 3.2 Options Analysis

| Option | Description | v0.1 Suitability | Migration Path |
|--------|-------------|-------------------|----------------|
| **A. Service account** | Dedicated API credential for operator identity; maps to a VITO user with OWNER/ADMIN role; JWT issued by VITO auth | **Recommended** | Service account creates JWT via existing auth flow; bridge sees standard JWT; no code changes to auth |
| **B. Short-lived signed token** | OAuth-style client credentials; separate token endpoint | Deferred | Requires new token issuance endpoint; more complex |
| **C. Local-only development bridge** | Insecure header fallback, localhost only | Dev only | Cannot migrate to production; blocks design |

### 3.3 Recommendation: Option A (Service Account)

**v0.1 approach:**

1. Operator (ChatGPT) is represented by a dedicated VITO user with `OWNER` or `ADMIN` role
2. Service account authenticates via standard VITO login flow, obtaining a JWT
3. The JWT is stored server-side (in the bridge configuration, not in agent prompts)
4. The bridge uses the JWT for all subsequent dispatch calls
5. `JwtAuthGuard` sees a standard Bearer token; no auth code changes needed

**Security properties:**
- JWT is never placed in prompts or agent payloads
- JWT is bound to a specific organization (via `org_id` claim)
- Token versioning allows immediate revocation
- Per-request DB verification ensures user/org remain active
- Role check (`OWNER`/`ADMIN`) enforced by existing `RolesGuard`

**Migration path to v0.2:**
- Add OAuth2 client credentials flow for ChatGPT connector
- Add short-lived token exchange endpoint
- Bridge transparently upgrades from static JWT to token-exchanged JWT

---

## 4. Transport/Interface

### 4.1 Protocol Design

The bridge exposes a provider-neutral HTTP API. No ChatGPT-specific semantics.

**Core operations:**

```
POST   /v1/operator/tasks          -- Submit a new governed task
GET    /v1/operator/tasks/:taskId  -- Get task status and result
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
    readonly maxDurationMs?: number;   // 1000-3600000
    readonly maxTokens?: number;       // 1-10000000
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

### 4.3 Response Contract: `OperatorTaskResult`

```typescript
interface SubmitOperatorTaskResponse {
  /** Server-assigned task ID (UUID). */
  readonly taskId: string;

  /** Client-provided request ID (echoed for correlation). */
  readonly requestId: string;

  /** Correlation ID for audit trail. */
  readonly correlationId: string;

  /** Task status. */
  readonly status: OperatorTaskStatus;

  /** Routing decision ID. */
  readonly routingDecisionId: string;
}

interface OperatorTaskResult {
  /** Task ID. */
  readonly taskId: string;

  /** Current status. */
  readonly status: OperatorTaskStatus;

  /** Correlation ID. */
  readonly correlationId: string;

  /** Execution IDs for audit trail. */
  readonly invocationId?: string;
  readonly executionId?: string;

  /** Selected provider metadata (where disclosure is permitted). */
  readonly provider?: {
    readonly providerCode: string;
    readonly displayName: string;
  };

  /** Capability code used. */
  readonly capabilityCode: string;

  /** Bounded stdout summary (truncated to MAX_SAFE_TEXT_LENGTH). */
  readonly stdout?: string;

  /** Bounded stderr summary (truncated to MAX_SAFE_TEXT_LENGTH). */
  readonly stderr?: string;

  /** Changed files list. */
  readonly changedFiles?: readonly string[];

  /** Governed patch/change-set (within policy size limits). */
  readonly patch?: string;

  /** Typed error if failed. */
  readonly error?: {
    readonly reason: string;
    readonly message: string;
    readonly retryable: boolean;
  };

  /** Timing and usage metadata. */
  readonly timing?: {
    readonly startedAt?: string;  // ISO 8601
    readonly completedAt?: string;
    readonly durationMs?: number;
  };

  /** Workspace disposition. */
  readonly workspaceDisposition?: 'CLEANED';

  /** Whether human review is required. */
  readonly reviewRequired: boolean;

  /** Timestamps. */
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

### 4.4 Synchronous vs. Asynchronous

**v0.1: Synchronous dispatch is sufficient.**

Rationale:
- OpenCode execution via Bubblewrap sandbox is bounded by `maxDurationMs` (default 30s, max 3600s)
- ChatGPT's function-calling interface expects a response within its timeout
- No multi-worker scheduling needed in v0.1
- The existing `GovernedInvocationServiceImpl.invoke()` is already synchronous (awaitable)
- Streaming/WebSocket adds significant complexity with no v0.1 benefit

The `POST /v1/operator/tasks` endpoint awaits the full governed execution pipeline and returns the complete result. If execution exceeds the HTTP timeout, the task is still persisted with status `RUNNING` or a terminal status, and the client can poll via `GET /v1/operator/tasks/:taskId`.

### 4.5 Future v0.2 Asynchronous Extension

If v0.2 requires longer-running tasks:
- Add `POST /v1/operator/tasks` returns immediately with `status: QUEUED`
- Add `GET /v1/operator/tasks/:taskId` polls status
- Add `WebSocket /v1/operator/tasks/:taskId/stream` for live updates
- Bridge creates `WorkflowRun` + `WorkflowStepRun` and polls completion

---

## 5. Operator Task State Machine

### 5.1 States

```
RECEIVED
  -> AUTHENTICATED
       -> AUTHORIZED
            -> DISPATCHED
                 -> RUNNING
                      -> RESULT_READY
                           -> AUTO_CONTINUE
                           -> HUMAN_GATE
                           -> COMPLETED
                           -> FAILED
```

### 5.2 State Definitions

| State | Description | Entry Condition |
|-------|-------------|-----------------|
| `RECEIVED` | Task received by bridge, awaiting auth | HTTP request arrives |
| `AUTHENTICATED` | Operator identity verified (JWT valid) | `JwtAuthGuard` passes |
| `AUTHORIZED` | Operator authorized for capability (role check + tenant) | `RolesGuard` passes |
| `DISPATCHED` | Task submitted to `AgentWorkforceService.dispatch()` | Service call initiated |
| `RUNNING` | Governing execution pipeline is active | `GovernedRuntimeService` invoked |
| `RESULT_READY` | Execution completed, result available | Adapter returned terminal status |
| `AUTO_CONTINUE` | Task completed; no human gate required; safe to continue | Result SUCCEEDED, no policy block |
| `HUMAN_GATE` | Task requires human approval before continuation | Policy decision or risk class requires it |
| `COMPLETED` | Task fully settled; result delivered to client | Client acknowledged or auto-continued |
| `FAILED` | Task failed (terminal) | Any terminal error state |

### 5.3 Relationship to Existing State Machines

This state machine describes **only the external operator interaction layer**. It does **not** duplicate:
- `AgentExecutionStatus` (invocation lifecycle: QUEUED -> STARTING -> RUNNING -> SUCCEEDED/FAILED/TIMED_OUT)
- `WorkflowRunStatus` (workflow orchestration: CREATED -> RUNNING -> BLOCKED/COMPLETED/FAILED)
- `GovernedInvocationClaimState` (idempotency: IN_PROGRESS -> COMPLETED/TIMED_OUT_UNKNOWN/FAILED_UNKNOWN)

The bridge state machine is a **view** over these existing states, translated for external consumption.

---

## 6. Autonomy Policy

### 6.1 Operating Principle

**Default = autonomous continuation; human escalation = exception.**

Tasks proceed automatically through reversible operations. Human intervention is required only at explicitly defined gates.

### 6.2 Risk Classes and Human Gates

#### AUTO (Autonomous Continuation)

| Operation | Justification |
|-----------|---------------|
| Read/analyze repository | Read-only, no side effects |
| Create isolated workspace | Transient, cleaned after execution |
| Run tests / build / typecheck | Read-only side effects (no mutation) |
| Edit within authorized repo (feature branch) | Reversible via branch deletion |
| Create feature branch | Reversible, no protected branch impact |
| Commit to feature branch | Local, no remote side effect until push |
| Push feature branch | Remote but non-protected, reversible |
| Documentation / review / rework | Low-risk, reviewable |

#### HUMAN GATE (Requires Explicit Approval)

| Operation | Justification |
|-----------|---------------|
| Merge to protected/main branch | Irreversible without force-push; affects production code |
| Production deployment | Potentially irreversible external side effect |
| Credential / secret changes | Security-critical; potential blast radius |
| Destructive data operations | Data loss risk |
| External communications | Reputational/legal risk |
| Purchases / cost commitments | Financial commitment |
| Material security-policy changes | Security posture impact |

### 6.3 State Mapping

```
AUTO_CONTINUE -> automatically proceed to next task or deliver result
HUMAN_GATE    -> pause; notify operator; await explicit human approval
COMPLETED     -> terminal; no further action
FAILED        -> terminal; error delivered to operator
```

### 6.4 v0.1 Scope

- Auto-continue is the default for all `RESULT_READY` states
- Human gate is triggered by `evaluatePolicy()` returning policy-blocked states (existing EO-01.4)
- No auto-merge in v0.1 (architecture supports it; not implemented)
- No production deployment automation in v0.1

### 6.5 Deferred v0.2+ Auto-Merge

The architecture must support future policy-driven auto-merge for explicitly low-risk classes:
- Feature branch -> main merge after all checks pass
- Configurable risk thresholds per organization
- Audit trail for auto-merge decisions
- Rollback capability

---

## 7. Threat Model

| # | Threat | Mitigation |
|---|--------|------------|
| T1 | **Forged external requests** | JWT authentication via `JwtAuthGuard`; per-request DB verification of user/org/token_version; signature verification |
| T2 | **Replay attacks** | `requestId` idempotency at bridge layer; existing `GovernedInvocationIdempotencyStore` prevents duplicate execution at invocation layer |
| T3 | **Cross-tenant request** | `organizationId` derived exclusively from JWT (`org_id` claim); `TenantContext.getOrThrow()` enforces; `ProviderRouterService` scoped to org |
| T4 | **Prompt attempting authority escalation** | Bridge translates intent only; no execution fields pass through; `evaluatePolicy()` (EO-01.4) is mandatory gate; `ExecutionProfileResolver` is trusted |
| T5 | **Provider/executable injection** | `ProviderRouterService` selects provider by capability; `TrustedLocalExecutableResolver` verifies binary; `RepositoryRegistry` validates repo; none controlled by operator |
| T6 | **Repository/ref injection** | `RepositoryRegistry` is a trusted server-side registry; `isBaseRefAllowed()` validates ref; operator never specifies repo URL or ref |
| T7 | **Oversized request/result** | Request: `MAX_PROMPT_BYTES` (512KB), `MAX_ARG_LENGTH` (4096), `MAX_DEFAULT_ARGS` (64); Result: `MAX_PATCH_BYTES` (2MB), `MAX_SAFE_TEXT_LENGTH` (2000) |
| T8 | **Result/patch exfiltration** | `redactSecretMaterial()` applied to all output; `sanitizeGovernedReferenceList()` filters non-gov:// refs; patch logged only as size; `workspaceDisposition: 'CLEANED'` |
| T9 | **Secret leakage** | `CredentialBroker` provides reference-only at adapter boundary; secrets never enter prompts, audit, or result; `redactTrustedSecretsDeep()` applied recursively |
| T10 | **Task-result enumeration** | taskId is UUID (unpredictable); `OperatorTask` queries scoped to authenticated `organizationId`; no bulk enumeration endpoint in v0.1 |
| T11 | **Duplicate dispatch** | `requestId` idempotency at bridge; `GovernedInvocationIdempotencyStore` at invocation level; `buildGovernedLogicalOperationKey()` prevents duplicate consequential actions |
| T12 | **Client disconnect/retry** | Task persists with terminal status regardless of client connectivity; `GET /v1/operator/tasks/:taskId` returns cached result; no re-execution on retry with same `requestId` |
| T13 | **Compromised bridge credential** | Service account JWT has short expiry; `tokenVersion` revocation; org-scoped; role-limited; bridge monitors for anomalous patterns (deferred v0.2) |

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
| **New: `operator-bridge.guard.ts`** | **New guard** | Operator-specific policy checks (beyond JWT + roles) |

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
  operator-bridge.ts                     -- Shared types (OperatorTaskStatus, request/result contracts)

prisma/
  migrations/
    <timestamp>_add_operator_task/       -- OperatorTask table migration
```

### 10.2 Modified Files

None in v0.1. The bridge is additive-only.

### 10.3 Prisma Schema Addition

```prisma
model OperatorTask {
  id                String   @id @default(uuid())
  organizationId    String
  userId            String
  requestId         String   @unique  // Client-generated idempotency key
  correlationId     String
  capabilityCode    String
  prompt            String   @db.Text
  assuranceLevel    String?
  status            String   @default("RECEIVED") // RECEIVED/AUTHENTICATED/AUTHORIZED/DISPATCHED/RUNNING/RESULT_READY/AUTO_CONTINUE/HUMAN_GATE/COMPLETED/FAILED

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
  patch             String?  @db.Text  // governed change-set
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

  @@index([organizationId, status])
  @@index([organizationId, requestId])
  @@index([correlationId])
}
```

### 10.4 Tests Required

| Test Type | Scope | Count (est.) |
|-----------|-------|--------------|
| Unit: `OperatorBridgeService` | Intent translation, result normalization, idempotency | 8-12 |
| Unit: `OperatorBridgeGuard` | Operator authorization policy | 4-6 |
| Unit: DTO validation | Request schema validation | 6-8 |
| Integration: Submit task E2E | Full flow: submit -> dispatch -> result | 3-4 |
| Integration: Idempotency E2E | Duplicate requestId returns same result | 2-3 |
| Integration: Cross-tenant rejection | Different org cannot access tasks | 2 |
| Integration: Budget enforcement | Budget limits enforced end-to-end | 2-3 |

---

## 11. Engineering Workflow Improvement

### 11.1 BASELINE_GATE

Reusable VITO engineering policy: **verify authoritative baseline before code changes.**

```typescript
/**
 * BASELINE_GATE: Before any code change, verify the authoritative baseline.
 *
 * Steps:
 * 1. Checkout authoritative baseline branch/SHA
 * 2. Run full test suite (pass = gate satisfied)
 * 3. Run typecheck (pass = gate satisfied)
 * 4. Run lint (pass = gate satisfied)
 * 5. Record baseline SHA in engineering record
 * 6. Only then: create feature branch and implement
 *
 * Gate failure: STOP. Do not proceed with implementation.
 * Record: baseline SHA, gate result, timestamp.
 */
```

**Current implementation:** The `main` branch tip (`cc02502`) is the authoritative baseline. All feature branches derive from it. The CI pipeline (`ci.yml`) enforces test + typecheck on every push.

### 11.2 AUTONOMY_GATE

Reusable VITO engineering policy: **autonomous continuation through reversible operations; stop only at explicit human-gate conditions or blocker.**

```typescript
/**
 * AUTONOMY_GATE: After each code change, evaluate continuation.
 *
 * Steps:
 * 1. Run tests (pass = AUTO_CONTINUE; fail = STOP, fix)
 * 2. Run typecheck (pass = AUTO_CONTINUE; fail = STOP, fix)
 * 3. Run lint (pass = AUTO_CONTINUE; fail = STOP, fix)
 * 4. Evaluate risk class:
 *    - AUTO operations: continue autonomously
 *    - HUMAN_GATE operations: STOP, notify operator
 * 5. If AUTO: commit, push, proceed to next step
 * 6. If HUMAN_GATE: pause, present decision to operator
 *
 * Default: CONTINUE. Escalation: EXCEPTION.
 */
```

### 11.3 Monthly Engineering Housekeeping (Deferred)

Scheduled capability for recurring maintenance:
- Dependency updates (patch versions)
- Security audit log review
- Provider health check validation
- Test coverage report
- Documentation currency check

**Deferred to v0.2+** -- tracked as a separate engineering record.

---

## 12. v0.1 Scope

### 12.1 In Scope

| Item | Status |
|------|--------|
| Secure operator API/facade (`/v1/operator/tasks`) | Design complete |
| Service account authentication | Uses existing JWT stack |
| Submit task (intent-level only) | Design complete |
| Get task status/result | Design complete |
| Reuse `AgentWorkforceService.dispatch()` | Existing, unchanged |
| OpenCode as first configured provider | Existing `LOCAL_TOOL` adapter |
| Audit/correlation (full trail) | Existing `AuditService` |
| `OperatorTask` persistence | New Prisma model |
| Idempotency (request-level) | New, plus existing invocation-level |
| Bounded result contract | Design complete |
| BASELINE_GATE / AUTONOMY_GATE policies | Design complete |
| Unit + integration tests | Design complete |

### 12.2 Explicitly Deferred (v0.2+)

| Item | Rationale |
|------|-----------|
| Streaming / WebSocket | Adds complexity; synchronous sufficient for v0.1 |
| Multi-worker scheduler | Single-worker execution sufficient for v0.1 |
| Artifact store (beyond inline patch) | Inline patch within 2MB limit sufficient for v0.1 |
| Auto-merge | Architecture supports it; not implemented in v0.1 |
| Production deployment automation | Separate concern; not in bridge scope |
| OAuth2 client credentials flow | Service account sufficient for v0.1 |
| MCP server integration | Deferred to v0.2 |
| ChatGPT connector/plugin | API contract compatible; specific integration deferred |
| Long-running task async support | Synchronous sufficient for v0.1 budget limits |
| Operator audit dashboard | Existing audit events queryable via API |
| Risk-class-based auto-continue policy engine | Manual human gate sufficient for v0.1 |
| Monthly engineering housekeeping scheduler | Deferred |
| Cross-organization operator federation | Not in scope |
| Result caching / pagination | Single-task response sufficient for v0.1 |

---

## 13. Migration Path Toward Provider-Neutral Coding Agents

### 13.1 Current State

The existing architecture is already provider-neutral:
- `ProviderRouterService` selects providers by capability, not by vendor
- `GovernedProviderAdapter` interface abstracts execution
- `HeadlessLocalAgentAdapter` / `RemoteExecutionWorker` are one implementation
- OpenCode is one configured provider (via `commandAlias` in provider metadata)

### 13.2 Operator Bridge Enables Provider Neutrality for External Clients

The bridge does **not** introduce a new provider model. It translates operator intent into the existing capability-based dispatch. This means:

1. **Adding a new provider** (e.g., Cursor, Windsurf, Aider) requires only:
   - Register in `ProviderRegistryService`
   - Assign capabilities
   - Implement/configure adapter
   - Bridge automatically routes to it via `ProviderRouterService`

2. **External clients are provider-agnostic** -- they specify `capabilityCode`, not provider

3. **Provider selection remains server-side** -- operators never see or control which provider executes

### 13.3 Future: Multi-Agent Operator Sessions

v0.2+ could support:
- Operator submits a series of tasks (multi-turn session)
- Bridge manages session state
- Different providers handle different capability needs within the same session
- Results are aggregated and presented to the operator

This follows the existing `WorkflowRuntime` pattern but is driven by external operator intent rather than internal orchestration.

---

## 14. Architecture Conflicts

### 14.1 Conflict Assessment

| Area | Conflict? | Resolution |
|------|-----------|------------|
| `AgentWorkforceController` | **None** | Bridge creates a parallel endpoint; existing endpoint unchanged |
| `AgentWorkforceService` | **None** | Bridge delegates to existing service; no internal changes |
| `TenantContext` | **None** | Bridge uses existing JWT-derived tenant context |
| `JwtAuthGuard` / `RolesGuard` | **None** | Bridge uses existing auth stack; adds operator-specific guard as additional layer |
| `ProviderRouterService` | **None** | Bridge does not bypass routing; routing remains authority |
| `GovernedRuntimeService` | **None** | Bridge does not bypass governed runtime |
| `GovernedInvocationServiceImpl` | **None** | Bridge does not bypass invocation pipeline |
| `RemoteExecutionWorker` | **None** | Bridge does not bypass sandbox |
| `WorkflowRuntimeService` | **None** | Bridge does not use workflow runtime (v0.1); may use it in v0.2 |
| Prisma schema | **Additive** | New `OperatorTask` model; no modifications to existing models |
| Audit | **Additive** | New audit events with `actorType: 'DIGITAL_EMPLOYEE'` for operator-initiated tasks |

### 14.2 Architectural Invariant Preserved

> **Operator/ChatGPT requests work. VITO authorizes work. Provider executes work.**
> **The external bridge must never become a second control plane.**

The bridge is a thin translation layer, not a control plane:
- It does not decide which provider executes
- It does not decide the execution profile
- It does not decide the execution policy
- It does not resolve executables
- It does not inject credentials
- It does not manage sandboxes
- It does not evaluate idempotency (it adds its own layer, but does not replace the existing one)

All authorization and execution authority remains in the existing governed runtime stack.

---

## 15. Summary of Major Architecture Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Thin facade over existing pipeline | Reuse over duplication; existing pipeline is battle-tested |
| D2 | Service account with JWT auth | Minimal auth changes; leverages existing stack; migration path to OAuth2 |
| D3 | Synchronous dispatch | Bounded execution times; ChatGPT function-calling compatibility |
| D4 | Intent-level request only | External clients never control execution parameters |
| D5 | `OperatorTask` as external state view | Decouples external interface from internal workflow state machine |
| D6 | No streaming in v0.1 | Complexity reduction; synchronous sufficient |
| D7 | No auto-merge in v0.1 | Architecture supports it; not implemented |
| D8 | `requestId` idempotency at bridge level | Client-friendly retry; separate from invocation-level idempotency |
| D9 | Provider-neutral capability codes | Bridge does not encode provider knowledge |
| D10 | Full audit trail for operator tasks | Accountability; leverages existing `AuditService` |

---

## 16. Deliverable Checklist

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
| Tests required | Complete (Section 10.4) |
| v0.1 scope | Complete (Section 12.1) |
| Deferred items | Complete (Section 12.2) |
| Migration path toward provider-neutral coding agents | Complete (Section 13) |
| Architecture conflicts | Complete (Section 14) |

---

**READY FOR OPERATOR BRIDGE ARCHITECTURE REVIEW: YES**
