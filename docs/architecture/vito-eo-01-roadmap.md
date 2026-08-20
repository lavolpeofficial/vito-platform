# VITO-EO-01 — Governed Multi-Agent Engineering Runtime

Status: Draft execution roadmap
Branch: feature/vito-eo-01-governed-runtime-v0.1
Base: main

## Goal

Build the first productive, governed, provider-independent VITO multi-agent runtime for engineering work. VITO remains the orchestrator. Engineering is a capability/workflow package inside VITO, not a separate orchestration product.

## Core invariants

- Capability != Provider.
- Human release authority remains mandatory.
- Commit, push, merge and branch deletion are denied by default.
- Secrets access is denied by default.
- Builder and reviewer execution contexts are separated.
- Provider failures do not automatically equal workflow failures.
- Correction loops and provider retries are separate counters.
- Reviewer disagreement fails closed.
- Assurance requirements fail closed when they cannot be verified.
- All relevant actions and transitions are auditable.
- Review artifacts are immutable references once accepted into a workflow run.

## EO-01 block sequence

### EO-01.1 — Contracts & deterministic state machine

Scope:
- Engineering capability taxonomy
- Assurance levels
- Workflow/step statuses
- Review verdicts and findings
- Human gate contracts
- Provider execution statuses
- Independence contracts
- Retry/correction semantics
- Execution budget contract
- Permission policy contract
- Artifact types
- Pure deterministic transition logic
- Unit tests

Current gate status: CLOSED — Correction 01 required.

Blocking review findings:
1. Real reviewer-disagreement detection must be implemented and tested.
2. AL-4 independence must be enforced by the state machine, not only exposed as a helper.
3. Unknown builder model family at AL-4 must fail closed.

Exit gate:
- Correction findings closed
- Contract tests green
- full test suite green
- build green
- independent review confirms invariants
- no commit/push before explicit human gate

### EO-01.2 — Workflow Runtime

Scope:
- WorkflowRun persistence
- WorkflowStepRun persistence
- deterministic transition persistence
- current-step ownership
- run resume after process restart
- correlation and causation IDs
- audit events for create/start/transition/block/complete/fail
- maxCorrectionLoops persistence
- workflow definition remains versioned code/config in v0.1

Do not build:
- generic workflow designer
- external workflow DSL
- Temporal/Kafka/LangGraph

Exit gate:
- workflow survives restart
- invalid transitions rejected
- state/history auditable
- no provider execution yet

### EO-01.3 — Provider Registry & Router

Scope:
- AgentProvider registry
- provider capability declarations
- model-family metadata
- provider health/availability
- quota state
- assurance compatibility
- independence compatibility
- cost/latency metadata
- eligibility filter
- deterministic scoring
- ProviderRoutingDecision audit record

Routing order:
1. Eligibility
2. Governance/policy
3. Availability/quota
4. Assurance/independence
5. Budget
6. Quality/cost/latency scoring

Provider names never enter capability codes.

Exit gate:
- Claude can be unavailable without becoming a single point of failure
- ineligible providers can never win by score
- routing decision is explainable and auditable

### EO-01.4 — Execution Policy & Sandbox Contract

Scope:
- builder/reviewer execution profiles
- allowed/denied filesystem paths
- worktree separation
- command allow/deny rules
- secrets deny
- network policy
- timeout
- token/cost budget
- git commit/push/merge/delete deny
- policy-blocked execution result

Security gate:
No productive provider adapter may execute before this block is approved.

### EO-01.5 — Provider Adapters

Initial adapters:
- OpenCode/Big Pickle as builder
- Claude as reviewer
- Codex as second reviewer/fallback as soon as practical

Common adapter contract:
- execute(request) -> AgentExecutionResult

Requirements:
- no provider-specific branching inside workflow logic
- normalized stdout/stderr/result metadata
- timeout/cancel support
- cost/token capture where available
- execution audit

### EO-01.6 — Artifact, Verdict & Correction Loop

Scope:
- AgentExecution persistence
- ExecutionArtifact registry
- immutable hash/reference metadata
- review package generation
- structured verdict parsing
- findings persistence
- correction request generation
- correction loop counter
- re-test/re-package/re-review
- reviewer disagreement handling
- loop exhaustion -> human gate

Primary artifact classes:
- PLAN
- PATCH
- DIFF
- TEST_REPORT
- BUILD_LOG
- REVIEW_PACKAGE
- REVIEW_REPORT
- VERDICT
- CORRECTION_REQUEST
- VERIFICATION_REPORT
- RELEASE_RECORD

### EO-01.7 — Human Release Gate & Release Execution

Scope:
- explicit approval/rejection
- release gate audit record
- immutable approval context
- commit/push adapter available only after approval
- remote verification
- release failure remains auditable

Hard invariant:
No human approval -> no RELEASE_EXECUTION.

## First productive acceptance test

Use real AOE engineering work, not a demo:

"Determine the assurance status of still-open AOE-Core blocks and execute missing BUILD / TEST / RED-TEAM / CORRECTION / RE-REVIEW cycles until the Human Release Gate."

The acceptance test must exercise:
- repository/worktree discovery
- plan/build/test/package
- provider routing
- provider fallback
- quota handling
- review artifacts
- verdict parsing
- correction loops
- assurance levels
- audit trail
- human release gate

## Recommended branch discipline

Use one clean branch per governed block or tightly related block set. Do not continue VITO-EO work on the old architecture/multi-agent-foundation-v0.2 branch as a merge vehicle because it has substantial divergent history versus main.

Canonical runtime branch prepared from current main:

feature/vito-eo-01-governed-runtime-v0.1

EO-01.1 should be transferred to this branch only after its gate opens. Prefer a minimal patch/cherry-pick containing only reviewed EO-01.1 files.

## Must-have before first productive run

- EO-01.1 open
- EO-01.2 workflow persistence
- EO-01.3 provider router
- EO-01.4 sandbox/policy enforcement
- at least one builder adapter
- at least one independent reviewer adapter
- artifact/verdict/correction loop
- human release gate
- audit trail

## Should-have shortly after

- second reviewer/model-family support
- provider health probes
- normalized cost/token accounting
- execution metrics
- remote verification hardening
- workflow resume/recovery tests

## Nice-to-have later

- learned provider scoring
- UI workflow designer
- generic policy DSL
- marketplace/provider discovery
- distributed queue/event bus
- Temporal/Kafka
- Kubernetes agent workers
- automatic performance optimization

## Explicit non-goals for EO-01

- finishing all VITO business workflows
- full Digital Employee SDK
- generic no-code agent builder
- autonomous merge/release
- unrestricted filesystem access
- unrestricted HOME access
- secrets-by-default access
- separate Engineering Orchestrator product

## Definition of done for VITO-EO-01 v0.1

VITO can take a real engineering task and, under auditable governance, route capabilities to available independent providers, execute BUILD/TEST/REVIEW/CORRECTION cycles, preserve artifacts and state, recover from provider failure, enforce assurance requirements, and stop at a human-controlled release gate. No provider is a mandatory single point of failure and no release action can occur without explicit human authority.
