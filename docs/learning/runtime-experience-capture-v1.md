# VITO Runtime Experience Capture v1

This phase closes the write-back half of the governed learning loop for persisted workflow executions.

## Trust boundary

`AgentWorkforceService` distinguishes two execution contexts:

1. **Persisted workflow context** — `workflowStepRunId` resolves to a real `WorkflowStepRun`. VITO then verifies organization ownership, exact `workflowRunId` linkage, the backing Task, and a server-owned DigitalEmployee assignment.
2. **Synthetic governed context** — no persisted `WorkflowStepRun` exists. This preserves existing Operator Bridge / governed-operation correlation IDs and does not invent a DigitalEmployee identity or Experience.

If a persisted step exists but belongs to another tenant, references a different run, lacks a Task, or the Task is not assigned to a DigitalEmployee, execution fails closed before routing.

## Authoritative workflow metadata

For a persisted workflow execution, caller-provided correlation and assurance values are not authoritative. VITO uses the values stored on the verified `WorkflowRun` for provider routing and governed execution.

## Experience capture

After a governed AgentWorkforce execution returns, VITO records an `OBSERVED` Experience for the verified DigitalEmployee. The Experience contains bounded structural evidence only:

- WorkflowRun / WorkflowStepRun / Task identifiers;
- step type and attempt number;
- correlation and capability code;
- number of prior learning items retrieved;
- routing decision and selected provider identifiers;
- a whitelisted execution summary.

Raw stdout/stderr and the task prompt are deliberately not copied into the Experience Store.

## No invented outcome quality

Execution completion is not equivalent to task quality. Runtime Experience Capture therefore writes:

- `successScore: null`
- `confidence: null`

Objective quality remains the responsibility of the existing Outcome/Evaluation phase.

## Failure behavior

Experience persistence is a learning side effect, not execution authority. If capture fails after the governed execution has already completed, VITO keeps the execution result authoritative, attempts to emit `LEARNING_RUNTIME_EXPERIENCE_CAPTURE_FAILED`, and returns `experienceId: null`.

## Result

The runtime loop is now structurally bidirectional for persisted workflow-backed agent executions:

`retrieve prior learning → execute governed action → record Experience → later Outcome/Evaluation → Reflection → Maturity → Retrieval`

Synthetic Operator Bridge dispatches remain compatible and do not create fabricated Experiences.
