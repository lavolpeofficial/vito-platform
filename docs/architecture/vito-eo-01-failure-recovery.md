# VITO-EO-01 — Failure & Recovery Architecture v0.1

Status: Prepared architecture specification

## Principle

VITO must recover deterministically from partial failure without duplicating side effects, losing auditability, or weakening governance. Recovery is fail-closed.

## Failure classes

1. Orchestrator process crash
2. Provider timeout or late response
3. Duplicate step execution
4. Database write succeeds but dependent side effect fails
5. Worktree missing, dirty, or unexpectedly mutated
6. Artifact hash mismatch
7. Provider becomes unavailable mid-step
8. Human gate remains pending for long duration
9. Runtime restarts while a lease is stale
10. Release action partially succeeds

## Core mechanisms

- idempotency keys per WorkflowStepRun attempt
- optimistic versioning on WorkflowRun/WorkflowStepRun
- execution leases with expiry
- stale execution detection
- explicit retry counters separated from correctionLoopCount
- immutable accepted artifact references
- resumable state machine transitions
- causation/correlation IDs
- recovery reason codes
- no automatic release recovery across Human Gate

## Lease model

Each runnable step may hold a lease with:
- leaseOwner
- leaseAcquiredAt
- leaseExpiresAt
- heartbeatAt

A worker may execute a step only while holding a valid lease. Expired leases may be reclaimed only after stale-state validation.

## Idempotency

Recommended key:
`workflowRunId:workflowStepRunId:attemptNo:capability`

Duplicate execution with the same idempotency key must not create duplicate logical side effects.

## Recovery rules

### Process crash during pure computation
Resume from persisted step state or safely retry the same attempt.

### Provider timeout
Mark execution TIMED_OUT. Do not increment correctionLoopCount. Router may select another eligible provider when retry policy permits.

### Late provider response after timeout
Treat as stale unless the execution attempt remains authoritative. Never overwrite a newer accepted execution/result.

### Duplicate step start
Reject or return existing active execution based on idempotency/lease state.

### Worktree integrity failure
Block workflow with WORKTREE_INTEGRITY_FAILED. No silent recreation if evidence lineage would be lost.

### Artifact hash mismatch
Block with ARTIFACT_INTEGRITY_FAILED and require human or controlled regeneration.

### Human Gate pending
Remain WAITING_FOR_HUMAN. Gate expiry may move to BLOCKED/EXPIRED according to policy, never auto-approve.

### Release partial failure
Persist exact completed release action and stop. Never retry push/merge blindly without comparing remote/local state and human-approved context.

## Transaction boundary

State transition persistence and its audit event should occur transactionally where feasible. External provider or Git effects cannot be part of the DB transaction and therefore require idempotent command design plus reconciliation.

## Required tests

- restart resumes pending workflow correctly
- stale lease is reclaimed safely
- active lease prevents duplicate worker execution
- provider timeout does not increment correctionLoopCount
- late stale provider result cannot overwrite accepted result
- duplicate idempotency key does not duplicate logical execution
- artifact hash mismatch blocks workflow
- missing/dirty unexpected worktree blocks workflow
- pending Human Gate survives restart
- partial release failure does not auto-repeat unsafe mutation

## Non-goals

- distributed consensus
- exactly-once networking guarantees
- multi-region failover
- Kafka/Temporal dependency in v0.1
