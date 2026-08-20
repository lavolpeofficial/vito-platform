# ADR-009 — VITO EO Release Authority

Status: Accepted for EO-01 v0.1

## Decision

Release authority remains human-controlled. No builder, reviewer, provider adapter or VITO orchestration component may independently authorize commit/push/release.

## v0.1 rule

A HumanGate approval is required before RELEASE_EXECUTION. Approval must bind to the exact workflow run and reviewed artifact/revision context.

## Consequences

- commit/push adapters remain inaccessible before approval
- approval is auditable and immutable as a decision record
- reviewer pass is not release approval
- retries after partial release failure require reconciliation and may require renewed approval when context changes

## Revisit when

Delegated organizational roles, multi-approver policies or policy-bounded low-risk releases are designed explicitly.
