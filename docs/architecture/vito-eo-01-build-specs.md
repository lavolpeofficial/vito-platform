# VITO-EO-01 — Block Build Specifications

Status: Draft implementation specification
Parent roadmap: `docs/architecture/vito-eo-01-roadmap.md`

## Purpose

Provide executable build scopes for EO-01.2 through EO-01.7 so implementation can proceed gate-by-gate without repeated architecture rediscovery.

Each block follows the same rule:

> one bounded scope -> tests -> independent review -> gate -> next block.

## EO-01.2 — Workflow Runtime

### Must-have

- `WorkflowRun` persistence
- `WorkflowStepRun` persistence
- deterministic transition persistence
- workflow definition/version identifier
- current step and run status
- correction-loop count and max-loop policy
- correlation ID and causation ID
- restart/resume after application process restart
- audit events for run creation, start, transition, block, fail, complete and resume
- invalid transition rejection
- tenant isolation on every persisted run and step

### Minimal data shape

`WorkflowRun`
- id
- organizationId
- taskId optional
- workflowDefinitionCode
- workflowDefinitionVersion
- assuranceLevel
- status
- currentStepType optional
- correctionLoopCount
- maxCorrectionLoops
- correlationId
- createdAt / startedAt / completedAt / updatedAt

`WorkflowStepRun`
- id
- organizationId
- workflowRunId
- stepType
- status
- attemptNumber
- startedAt / finishedAt
- causationId optional
- metadata JSON

### Tests

- create run in CREATED
- start run -> RUNNING
- valid transition persists next step
- invalid transition rejected
- correction loop count persists
- blocked state persists reason
- run reload reconstructs current state
- tenant A cannot read/write tenant B run
- simulated service restart can resume non-terminal run
- audit event produced for every state-changing operation

### Explicit non-goals

- provider invocation
- provider registry
- generic workflow designer
- workflow DSL
- Temporal/Kafka/LangGraph

### Exit gate

Runtime state is durable, resumable, tenant-scoped and auditable without any provider execution.

---

## EO-01.3 — Provider Registry & Router

### Must-have

- provider registry
- provider capability declarations
- model-family metadata
- provider enabled/disabled state
- provider health/availability state
- quota state
- assurance compatibility
- independence compatibility
- cost and latency metadata
- eligibility filter before scoring
- deterministic scoring v0.1
- routing decision record with reasons
- fallback candidate list

### Routing sequence

1. capability eligibility
2. execution/security policy
3. enabled + health + availability
4. quota
5. assurance compatibility
6. independence requirements
7. budget
8. deterministic quality/cost/latency score

### Router invariant

A provider that fails any mandatory eligibility predicate can never win via score.

### Minimal provider fields

- providerCode
- providerType
- modelFamily
- supportedCapabilities[]
- enabled
- healthStatus
- quotaStatus
- qualityScore optional
- estimatedCostWeight optional
- latencyWeight optional
- metadata

### Tests

- capability mismatch excludes provider
- unhealthy provider excluded
- quota-blocked provider excluded from current attempt but remains known
- AL-4 independence constraint excludes invalid reviewer
- cheapest provider cannot bypass security policy
- deterministic identical input -> identical route
- fallback route selected when preferred provider unavailable
- no eligible provider -> fail closed with explicit reason
- routing decision explains rejected and selected candidates

### Explicit non-goals

- ML routing
- dynamic pricing engine
- learned quality optimization
- provider marketplace

### Exit gate

Claude or any other single provider can be unavailable without making the workflow architecture unavailable, provided another eligible provider exists.

---

## EO-01.4 — Execution Policy & Sandbox

### Must-have

- execution profile per role: builder / reviewer / orchestrator / release
- explicit allowed and denied filesystem paths
- separate builder and reviewer worktrees
- secrets deny by default
- HOME unrestricted access deny
- git commit deny by default
- git push deny by default
- merge deny by default
- branch deletion deny
- timeout
- token budget
- cost budget
- network policy
- command policy
- policy decision audit
- fail-closed behavior when policy is incomplete

### Default profiles

Builder:
- read repository/worktree: yes
- write builder worktree: yes
- run tests: yes
- network: policy-controlled
- secrets: no
- commit/push/merge/delete: no

Reviewer:
- read reviewer worktree: yes
- write production code: no
- run tests: yes
- network: policy-controlled
- secrets: no
- commit/push/merge/delete: no

VITO Orchestrator:
- workflow control: yes
- artifact read: yes
- production source write: no
- release action: no

Release Authority:
- release action only after explicit approved Human Gate

### Tests

- builder cannot write reviewer worktree
- reviewer cannot modify production source
- secret path denied
- HOME unrestricted path denied
- git push denied
- merge denied
- branch delete denied
- missing policy -> blocked
- timeout produces normalized execution status

### Exit gate

No productive provider adapter may execute before this block is independently approved.

---

## EO-01.5 — Provider Adapters

### Initial adapters

- OpenCode / Big Pickle -> builder
- Claude -> reviewer
- Codex -> second reviewer/fallback when available

### Common interface

`execute(request) -> AgentExecutionResult`

Request must carry:
- workflowRunId
- workflowStepRunId
- requested capability
- execution policy reference
- worktree/path context
- input artifact references
- budget
- timeout
- correlation ID

Result must normalize:
- status
- stdout/stderr refs or summaries
- produced artifact refs
- token/cost data where available
- start/end timestamps
- provider/model metadata
- timeout/quota/policy errors

### Tests

- provider-specific implementation hidden behind common port
- normalized success
- normalized failure
- timeout
- quota blocked
- cancellation
- provider fallback path can consume normalized failure
- no commit/push unless release adapter and approved gate context

### Explicit non-goals

- provider-specific branching in workflow state machine
- direct secrets exposure
- autonomous release

### Exit gate

At least one builder and one independent reviewer can execute through the same provider-neutral runtime contract.

---

## EO-01.6 — Artifacts, Verdicts & Correction Loop

### Must-have

- `AgentExecution` persistence
- `ExecutionArtifact` registry
- immutable artifact identity via hash/reference
- review package assembly
- structured review result parser
- findings persistence/reference
- reviewer disagreement detection
- correction request generation
- correction loop counter
- re-test -> re-package -> re-review
- loop exhaustion -> human gate
- artifact lineage from producer execution to consuming step

### Artifact metadata

- id
- organizationId
- workflowRunId
- workflowStepRunId
- agentExecutionId
- artifactType
- contentType
- storage/reference URI
- sha256
- producer metadata
- createdAt
- immutable flag

### Tests

- identical artifact content produces stable hash behavior
- accepted immutable artifact cannot be overwritten silently
- review package references exact build/test artifacts
- verdict A/B -> verify
- verdict C -> correction
- verdict D -> human decision
- reviewer A vs C -> disagreement -> gate closed
- correction loop increments only on actual correction cycles
- provider retry never increments correction-loop counter
- fourth automatic correction not possible when maxLoops=3

### Exit gate

VITO can complete a governed build/review/correction cycle without copy/paste and with complete artifact lineage.

---

## EO-01.7 — Human Release Gate & Release Execution

### Must-have

- explicit human gate record
- approval/rejection identity
- approval timestamp
- immutable approval context referencing exact workflow/artifact state
- release action denied unless gate approved
- commit execution only in release domain
- push execution only in release domain
- remote verification
- release failure audit
- no approval reuse after material artifact change

### Tests

- no approval -> no release
- rejection -> no release
- approval for artifact set A cannot release changed artifact set B
- approved release can commit/push according to explicit release policy
- remote verify success -> completed
- remote verify failure -> audited non-success terminal/recovery state
- human actor and exact approval context are retained

### Exit gate

Human authority is cryptographically/logically bound to the exact reviewed release context and cannot be bypassed by builder, reviewer or orchestrator.

---

## Final EO-01 v0.1 acceptance

A real AOE-Core engineering assurance task must travel through the runtime from planning to the Human Release Gate with:

- deterministic workflow state
- provider-independent routing
- provider fallback
- sandboxed execution
- independent review
- immutable artifacts
- correction/re-review loops
- complete audit chain
- no automatic release
