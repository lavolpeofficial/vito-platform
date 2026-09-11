# Runtime Reflection & Learning Observation v1

## Purpose

Close the next governed stage of VITO's runtime learning loop after objective outcome evaluation.

The runtime path is now:

`Experience → Objective Outcome → Evidence-bound Reflection → Learning Observation → Retrieval`

## Evidence boundary

The runtime pipeline only operates on the persisted `workflow_step_execution_status` outcome produced by `RuntimeOutcomeEvaluationService`.

It does not ask a model to judge quality and it does not infer hidden causes. The reflection is a deterministic restatement of persisted execution evidence:

- workflow step type
- capability code
- expected execution status
- observed execution status
- objective outcome score
- persisted outcome confidence

No assumptions are generated. `nextActionHint` remains null.

## Learning candidate

A non-zero objective outcome produces a `LearningCandidate` at maturity `OBSERVATION` only. The statement is intentionally scoped to **this observed run** so a single successful or failed execution is never generalized into a pattern or policy.

The candidate carries structured applicability metadata for retrieval:

- metric code
- step type
- capability code
- observed status
- expected status
- outcome score

## Failure patterns

Runtime v1 deliberately does **not** create a `FailurePattern` from a single negative execution outcome. The existing FailurePattern model requires a root cause and prevention statement. Execution status alone does not establish either. Inventing them would create false learning.

Failure-pattern automation therefore remains a later governed stage that must require corroborated causal evidence or repeated observations.

## Idempotency

Reprocessing the same Experience reuses the existing evidence-bound Reflection and active LearningCandidate. It does not create duplicate learning observations.

## Failure semantics

The runtime integration is fail-open relative to an already completed governed execution. A learning-pipeline persistence failure is audited as `LEARNING_RUNTIME_REFLECTION_PIPELINE_FAILED` and does not rewrite the execution result.

## Promotion boundary

No automatic maturity promotion occurs. Runtime-generated candidates remain `OBSERVATION`. Existing governed promotion rules remain authoritative, including human approval for `POLICY` maturity.
