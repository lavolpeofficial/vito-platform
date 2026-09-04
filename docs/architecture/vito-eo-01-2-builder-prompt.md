# VITO-EO-01.2 — Builder Prompt

Target branch: `feature/vito-eo-01-governed-runtime-v0.1`
Target worktree: `/home/alessandro/Downloads/vito-platform_eo01_runtime`
Parent issue: #9

## Mission

Implement only the durable, resumable, tenant-scoped and auditable Workflow Runtime for VITO. Reuse the approved EO-01.1 contracts/state machine. Do not implement provider execution yet.

## Before editing

1. Verify branch and clean status.
2. Read:
   - `packages/contracts/src/engineering/**`
   - `docs/architecture/vito-eo-01-build-specs.md`
   - `docs/architecture/vito-eo-01-runtime-data-model-v0.1.md` if present
   - existing Prisma schema/services/audit patterns
3. Inventory existing models/services first. Reuse existing conventions.

## Required v0.1 persistence

Add minimal persistence for:

### WorkflowRun
- `id`
- `organizationId`
- optional `taskId`
- `workflowDefinitionCode`
- `workflowDefinitionVersion`
- `assuranceLevel`
- `status`
- optional `currentStepType`
- `correctionLoopCount`
- `maxCorrectionLoops`
- `correlationId`
- optional `blockReasonCode`
- optional `failureReasonCode`
- timestamps: created/updated plus started/completed where appropriate

### WorkflowStepRun
- `id`
- `organizationId`
- `workflowRunId`
- `stepType`
- `status`
- `attemptNumber`
- optional `causationId`
- JSON metadata
- started/finished timestamps

Use repository naming/ID/timestamp conventions. Do not add speculative fields unless necessary for a required invariant.

## Runtime service

Implement a small service/module that can:

- create a workflow run in `CREATED`
- start it deterministically
- persist the active/current step
- accept a completed-step result and call the EO-01.1 pure state machine to derive the next transition
- persist `NEXT_STEP`, `BLOCKED`, `FAILED`, `COMPLETED`
- persist/increment correction loop count only on actual correction-cycle entry
- reload a non-terminal run from DB
- resume safely after process restart without resetting counters/state
- reject invalid/stale transitions
- preserve organization/tenant boundary on every read/write

Workflow definition remains versioned code/config in v0.1. No generic DSL or workflow designer.

## Transition authority

The EO-01.1 pure state machine remains the transition authority.

Do not duplicate A/B/C/D, AL4, loop, disagreement or Human Gate rules in ad-hoc service logic. The runtime persists and orchestrates state; it does not invent parallel governance semantics.

## Idempotency / concurrency — minimal must-have

Prevent accidental double advancement of the same step. Use the simplest repository-consistent mechanism (transaction + state/status check and/or optimistic version/update predicate).

A duplicate completion callback must not create two next steps or increment counters twice.

Do not build a distributed lock service in this block.

## Audit

Use the existing AuditService/patterns. Emit auditable events for at least:

- workflow created
- workflow started
- step started/activated
- transition persisted
- workflow blocked
- workflow failed
- workflow completed
- workflow resumed
- invalid/stale transition rejected where appropriate

Audit payload must include `organizationId`, `workflowRunId`, relevant step IDs/types, correlationId and reason code where present. Do not log secrets or large artifact content.

## Tenant isolation

Every runtime read/write must be organization-scoped. Tests must prove tenant A cannot read, resume, mutate or advance tenant B runs.

## Prisma

A Prisma migration is allowed in EO-01.2 because durable runtime persistence is the block's purpose.

Requirements:
- modify only the minimal schema needed for WorkflowRun/WorkflowStepRun and relations/indexes
- generate Prisma Client
- do not alter unrelated models
- do not require destructive migration/reset
- include useful indexes for organization/run/status/current workflow access

## Tests — mandatory

At minimum prove:

1. create run -> `CREATED`
2. start run -> `RUNNING`
3. valid PLAN -> BUILD transition persists
4. invalid/stale transition is rejected
5. duplicate completion does not double-advance
6. correction-loop count persists and does not double-increment
7. BLOCKED state and machine-readable reason persist
8. FAILED state persists
9. COMPLETED state persists
10. reload reconstructs current workflow state
11. simulated service/process restart can resume non-terminal run
12. tenant A cannot read tenant B run
13. tenant A cannot mutate/advance tenant B run
14. audit event is emitted for every state-changing operation
15. existing EO-01.1 49 contract tests remain green
16. full existing API tests remain green
17. build passes

## Explicit non-goals

Do NOT implement:

- AgentProvider / provider registry
- Claude/OpenCode/Codex adapters
- provider routing
- n8n adapter
- shell execution
- artifact storage runtime
- Human Gate UI/API beyond what persistence transition semantics minimally require
- commit/push/merge automation
- generic workflow designer / DSL
- Temporal
- Kafka
- LangGraph
- Kubernetes

## Validation

Run:

```bash
pnpm prisma:generate
pnpm --filter @vito/contracts test
pnpm --filter @vito/api test
pnpm test
pnpm build
```

If a migration is created, report its exact path/name and whether it was applied locally. Do not reset or destroy a database.

## Git boundary

Do not commit or push.

## Required final report

Return exactly:

### VITO-EO-01.2 BUILD REPORT

- Branch
- Changed files
- Prisma changes/migration
- Models added
- Runtime/service/module added
- Transition persistence behavior
- Idempotency/concurrency behavior
- Tenant isolation behavior
- Audit behavior
- Test commands/results
- Build result
- Deviations
- Open questions
- Git status
- Commit: NOT CREATED
- Push: NOT PERFORMED

Stop afterward. No EO-01.3 work without gate.