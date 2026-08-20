# VITO-EO-01 — Observability Contract v0.1

Status: Prepared architecture specification

## Goal

Make VITO engineering runs diagnosable without introducing a heavy observability stack in v0.1.

## Signals

### Logs
Structured logs must include where applicable:
- organizationId
- workflowRunId
- workflowStepRunId
- agentExecutionId
- providerCode/modelFamily
- capability
- correlationId
- causationId
- status/reasonCode

Secrets, full prompts containing credentials, tokens and sensitive environment values must not be logged.

### Metrics
Minimum metrics:
- workflow_runs_started_total
- workflow_runs_completed_total
- workflow_runs_blocked_total
- workflow_duration_ms
- step_duration_ms
- provider_execution_duration_ms
- provider_retry_total
- correction_loop_total
- review_disagreement_total
- assurance_unsatisfied_total
- human_gate_wait_ms
- provider_quota_blocked_total
- provider_timeout_total
- execution_cost_minor_units where measurable

### Tracing
v0.1 may use correlation/causation IDs without requiring OpenTelemetry. Trace-provider integration is later optional.

## Health
Expose/derive health separately for:
- VITO API/runtime
- database
- provider registry
- provider instances
- local reviewer capacity

## Alerts / operator conditions
Initial operator-visible conditions:
- workflow blocked
- repeated provider timeout
- no eligible provider
- AL4 assurance unsatisfied
- reviewer disagreement
- correction loop exhausted
- artifact integrity failure
- stale lease/workflow
- release execution failure

## Performance Ledger linkage
Observability events are operational telemetry. Business/performance records may derive from them but must not mutate audit history.

## Required tests

- logs include correlation IDs
- secret-like values are not included in structured log payloads
- status/reason metrics increment deterministically
- provider retry and correction loop metrics are distinct
- blocked workflows expose machine-readable reason
