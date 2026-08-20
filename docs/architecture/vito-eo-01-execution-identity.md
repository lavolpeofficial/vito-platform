# VITO-EO-01 — Execution Identity & Correlation Contract v0.1

Status: Prepared architecture specification

## Identity chain

EngineeringTask
→ WorkflowRun
→ WorkflowStepRun
→ AgentExecution
→ ExecutionArtifact / ReviewResult
→ HumanGate

Every record must be attributable to one tenant/organization and one causal chain.

## Required identifiers

- engineeringTaskId
- organizationId
- workflowRunId
- workflowStepRunId
- agentExecutionId
- artifactId
- reviewResultId where applicable
- humanGateId where applicable
- correlationId
- causationId
- attemptNo
- correctionLoopNo

## Correlation semantics

`correlationId` identifies the end-to-end business/engineering operation.

`causationId` points to the immediate event/record that caused the current action.

Example:
EngineeringTask T1 correlationId C1
WorkflowRun W1 correlationId C1 causationId T1
Step S2 correlationId C1 causationId S1
Execution E4 correlationId C1 causationId S2
Artifact A9 correlationId C1 causationId E4

## Attempt semantics

Provider retry increments `attemptNo`.
Correction loop increments `correctionLoopNo` only when workflow semantics enter CORRECTION.
These counters must never be conflated.

## Invariants

- IDs are immutable after creation.
- cross-tenant references are forbidden.
- every execution belongs to exactly one WorkflowStepRun.
- every accepted artifact references its producer execution or governed system producer.
- every HumanGate references exact workflow/revision/evidence context.
- audit events carry correlation and causation metadata.

## Required tests

- correlation ID propagates across run/step/execution/artifact
- causation chain points to existing same-tenant records
- provider retry changes attemptNo but not correctionLoopNo
- correction cycle changes correctionLoopNo
- cross-tenant relation rejected
- gate approval references exact workflow/evidence context
