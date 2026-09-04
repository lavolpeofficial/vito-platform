# VITO-EO-01.2 — Workflow Runtime Data Model & Persistence Spec

Status: Prepared build specification
Branch: feature/vito-eo-01-governed-runtime-v0.1

## Goal
Persist the deterministic EO-01 workflow without adding provider execution yet.

## Persisted models

### WorkflowRun
Minimum fields:
- `id`
- `organizationId`
- `taskId?`
- `workflowDefinitionCode`
- `workflowDefinitionVersion`
- `assuranceLevel`
- `status`
- `currentStepType?`
- `currentStepRunId?`
- `correctionLoopCount`
- `maxCorrectionLoops`
- `correlationId`
- `causationId?`
- `blockedReasonCode?`
- `blockedReasonMetadata?`
- `startedAt?`
- `completedAt?`
- `failedAt?`
- `createdAt`
- `updatedAt`

### WorkflowStepRun
Minimum fields:
- `id`
- `organizationId`
- `workflowRunId`
- `stepType`
- `status`
- `attemptNumber`
- `sequenceNumber`
- `startedAt?`
- `finishedAt?`
- `failureReasonCode?`
- `failureMetadata?`
- `createdAt`
- `updatedAt`

## Relations
- Organization 1:N WorkflowRun
- WorkflowRun 1:N WorkflowStepRun
- optional Task 1:N WorkflowRun or Task 1:1 current governed run; choose simplest implementation consistent with existing Task semantics

## Runtime service responsibilities
- create run from versioned workflow definition
- validate requested assurance level
- start current step
- complete current step
- call the pure EO-01.1 state machine
- reject invalid/stale transitions
- persist state transition atomically
- create next WorkflowStepRun when applicable
- increment correctionLoopCount only when a real correction cycle is entered
- persist BLOCKED/FAILED/COMPLETED outcomes
- resume active run after API restart

## Concurrency / ownership
V0.1 must prevent two workers from advancing the same run concurrently.
Preferred minimum solution:
- optimistic concurrency field/version or transactional compare-and-update
- a transition must assert expected current step/state before mutation
- stale transition attempts fail explicitly and are audited

Do not add distributed locks unless required by evidence.

## Workflow definition
Keep `engineering-assurance-v0.1` in versioned code/config.
Do not create a generic WorkflowDefinition database table yet.

## Restart/resume
A RUNNING or WAITING run must be reconstructable solely from persisted state.
On restart:
- no step is silently marked succeeded
- a RUNNING step with unknown execution outcome is surfaced as recoverable/attention-required according to policy
- state history remains intact

## Audit events
At minimum:
- WORKFLOW_RUN_CREATED
- WORKFLOW_RUN_STARTED
- WORKFLOW_STEP_CREATED
- WORKFLOW_STEP_STARTED
- WORKFLOW_STEP_SUCCEEDED
- WORKFLOW_STEP_FAILED
- WORKFLOW_TRANSITION_APPLIED
- WORKFLOW_BLOCKED
- WORKFLOW_COMPLETED
- WORKFLOW_FAILED
- WORKFLOW_RESUMED
- WORKFLOW_STALE_TRANSITION_REJECTED

Every event should include organizationId, workflowRunId, workflowStepRunId when applicable, correlationId, causationId where available, workflowDefinitionVersion and relevant reason codes.

## API scope
Minimal internal/application service first. Expose only endpoints needed to exercise/test the runtime. Avoid broad CRUD surface.

## Tests — mandatory
1. create run -> CREATED
2. start run -> RUNNING + PLAN step
3. PLAN success -> BUILD persisted
4. invalid transition rejected
5. stale transition rejected
6. TEST failure enters CORRECTION without exceeding loop policy
7. loop exhaustion -> BLOCKED
8. Verdict D -> BLOCKED
9. VERIFY -> HUMAN_RELEASE_GATE step created
10. no Human approval -> no RELEASE_EXECUTION
11. completed run cannot advance
12. cancelled/failed run cannot advance without explicit recovery policy
13. restart/resume reconstructs current run/step correctly
14. tenant isolation for run and step queries
15. audit event emitted for every state transition
16. correction counter increments exactly once per correction cycle

## Security invariants
- organization scope on every run/step access
- fail closed on unknown state/transition
- no provider execution
- no filesystem execution
- no git mutation
- no release action

## Non-goals
- provider registry/router
- AgentExecution persistence
- artifacts
- provider adapters
- generic workflow engine
- Temporal/Kafka/LangGraph
- UI designer

## Exit gate
EO-01.2 is OPEN only when:
- persistence migration is minimal and reviewed
- state machine remains single source of transition semantics
- runtime survives restart
- invalid/stale transitions are rejected
- tenant isolation proven
- audit chain complete
- tests/build green
- no EO-01.3+ scope leaked in
