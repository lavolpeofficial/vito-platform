# VITO-EO-01 — Provider Health & Artifact Conventions

Status: Prepared architecture specification

## Provider health state machine

### States
- `UNKNOWN`
- `HEALTHY`
- `DEGRADED`
- `QUOTA_LIMITED`
- `UNAVAILABLE`
- `DISABLED`

### Semantics
`UNKNOWN`: no trusted recent evidence; policy decides whether eligible. Never treat as equivalent to HEALTHY by default.

`HEALTHY`: recent executions/health probes indicate normal operation.

`DEGRADED`: usable but impaired; e.g. increased error/latency. Eligible only if policy permits.

`QUOTA_LIMITED`: provider/model usable only within known remaining quota or reduced capacity.

`UNAVAILABLE`: temporary inability to execute; excluded from routing.

`DISABLED`: administratively disabled; always excluded regardless of score.

### Transition triggers
Examples:
- UNKNOWN -> HEALTHY: successful health probe or successful governed execution
- HEALTHY -> DEGRADED: repeated transient failures / latency threshold
- HEALTHY/DEGRADED -> QUOTA_LIMITED: quota signal or rate-limit evidence
- any active state -> UNAVAILABLE: hard outage / repeated start failures / exhausted quota when no capacity remains
- any -> DISABLED: explicit admin/governance action
- UNAVAILABLE -> HEALTHY/DEGRADED: successful recovery evidence
- QUOTA_LIMITED -> HEALTHY: quota reset/recovery confirmed

Do not allow autonomous transition out of DISABLED.

### Health evidence
Record:
- providerId
- modelFamily/modelCode when applicable
- priorState/newState
- evidence source
- observedAt
- expiry/staleness time
- failure/success counters
- quota signal if present

## Local provider capacity
For LOCAL_LLM providers also track resource/capacity state:
- `LOCAL_READY`
- `LOCAL_BUSY`
- `LOCAL_CAPACITY_LIMITED`
- `LOCAL_UNAVAILABLE`

This is not a separate assurance level. It is routing/capacity evidence.

## Artifact identity and naming

### Logical artifact key
Use a stable hierarchy conceptually equivalent to:

`{organizationId}/{workflowRunId}/{workflowStepRunId}/{agentExecutionId}/{artifactType}/{artifactId}`

Storage backend may differ, but logical identity must not.

### Minimum artifact metadata
- artifactId
- organizationId
- workflowRunId
- workflowStepRunId
- agentExecutionId? (optional only for non-agent-generated artifacts)
- artifactType
- producerActorType
- producerActorId/providerId where applicable
- createdAt
- contentType
- byteSize
- sha256
- storageRef
- immutableAcceptedAt?
- supersedesArtifactId? when a new artifact replaces an earlier version without mutating it

### Immutability
Once an artifact is accepted into an assurance chain:
- content is never overwritten
- metadata fields essential to identity/integrity are immutable
- corrections produce new artifacts
- supersession is represented by relation, never mutation of old evidence

### Recommended filenames for human export
Human-readable export can use:
`{run-short}-{step}-{artifact-type}-{artifact-short}.{ext}`

Canonical identity remains IDs + hashes, not filename.

### Hashing
SHA-256 minimum for v0.1.
Hash before acceptance into review/release chain.
Integrity mismatch => `ARTIFACT_HASH_MISMATCH` and fail closed.

### Required artifact lineage
Every REVIEW_REPORT/VERDICT must reference the REVIEW_PACKAGE hash/ref it reviewed.
Every CORRECTION_REQUEST references originating finding/verdict artifacts.
Every VERIFICATION_REPORT references the exact revision/diff/artifact set verified.
Every RELEASE_RECORD references the Human Gate approval context and exact approved artifact/revision set.

## Cleanup / retention
Do not delete accepted assurance artifacts as part of normal worktree cleanup.
Ephemeral logs/temp files may have retention policy later, but accepted evidence remains durable per tenant policy.
