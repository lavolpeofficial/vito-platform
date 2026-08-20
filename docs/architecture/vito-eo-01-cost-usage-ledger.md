# VITO-EO-01 — Cost & Usage Ledger Contract v0.1

Status: Prepared architecture specification

## Goal

Capture normalized provider/resource usage so VITO can optimize routing, enforce budgets and later feed the Digital Workforce Performance Ledger.

## Usage record

Minimum fields:
- organizationId
- workflowRunId
- workflowStepRunId
- agentExecutionId
- providerCode
- providerType
- modelFamily
- modelId where known
- capability
- inputTokens?
- outputTokens?
- cachedTokens?
- durationMs
- costMinorUnits?
- currency?
- providerReportedCost?
- localComputeDurationMs?
- localComputeClass?
- recordedAt
- source (`PROVIDER_REPORTED`, `ESTIMATED`, `LOCAL_METERED`, `UNKNOWN`)

## Invariants

- unknown cost remains unknown; never silently assume zero
- currency always accompanies monetary cost
- retries produce separate usage records
- correction-loop executions remain separately attributable
- local execution is not 'free'; runtime/compute usage may be captured independently of external invoice cost
- provider-reported values are preserved as provenance where possible

## Budget behavior

Budgets may constrain:
- per execution
- per workflow run
- per organization/time window later

Budget exhaustion blocks new eligible execution according to policy; it is not a code-quality finding and does not increment correction loops.

## Routing linkage

Historical normalized metrics may later feed deterministic routing scores:
- quality history
- latency
- retry rate
- cost
- human override rate

No adaptive ML scoring in EO-01 v0.1.

## Required tests

- unknown provider cost not stored as zero
- retries create distinct usage entries
- currency required with monetary value
- local compute record accepted without provider token values
- budget exhaustion yields explicit policy/routing outcome
