# ADR-006 — VITO EO Workflow Definition Storage

Status: Accepted for EO-01 v0.1

## Decision

Workflow definitions remain versioned code/config artifacts in EO-01 v0.1. Runtime instances and step runs are persisted, but the workflow graph itself is not yet a database-managed DSL.

## Rationale

- one primary engineering assurance workflow exists
- code/config is easier to review, diff and version
- avoids premature generic workflow framework
- keeps deterministic state-machine semantics close to contracts/tests

## Consequences

- every WorkflowRun records workflowDefinitionVersion
- changing workflow definition requires code review
- no runtime UI workflow editing in EO-01

## Revisit when

Multiple business workflows require dynamic authoring or tenant-specific workflow composition.
