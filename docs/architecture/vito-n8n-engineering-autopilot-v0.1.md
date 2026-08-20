# VITO Engineering Autopilot v0.1

Status: Draft build-phase automation architecture
Purpose: eliminate manual copy/paste and agent handoffs during VITO/AOE engineering while preserving VITO governance and human release authority.

## Core decision

VITO remains the Control Plane and source of truth for engineering governance.
n8n is introduced as an Execution Plane for transport, scheduling, trigger handling, API orchestration and technical retries.
Workers/agents perform the actual work.

VITO != n8n.
n8n != provider router.
n8n != assurance authority.

## Immediate build-phase objective

The first practical goal is not a generic automation platform. It is to remove Alessandro from the manual message-bus role between ChatGPT, OpenCode/Big Pickle, reviewers, terminal commands, test runs and Git inspection.

Desired operator experience:

`Start EO-01.2`

Then the system proceeds autonomously through BUILD / TEST / PACKAGE / REVIEW / CORRECTION cycles until a governed Human Gate is reached.

## V0.1 architecture

AOE / Human engineering task
  -> VITO Control Plane
      - capability request
      - assurance level
      - policy
      - max correction loops
      - provider routing decision
      - human gate state
      - audit/cost/performance state
  -> ExecutionRuntimePort
  -> N8nExecutionRuntimeAdapter
  -> n8n workflow
  -> controlled execution workers
      - Git/read worker
      - build/test worker
      - OpenCode builder adapter
      - reviewer adapter(s)
      - artifact collector
  -> normalized ExecutionResult
  -> VITO
  -> deterministic next governed decision

## Immediate workflow

Name: `VITO_ENGINEERING_AUTOPILOT_V1`

1. receive EngineeringTask / workflow context
2. validate repository allowlist
3. validate branch/worktree policy
4. collect git status, branch, diff and baseline metadata
5. request CODE_BUILD provider decision from VITO
6. invoke builder through controlled worker
7. run deterministic tests/build commands through controlled worker
8. create immutable review package
9. request REVIEW / RED_TEAM provider decision from VITO
10. invoke selected reviewer
11. normalize and parse verdict
12. send result to VITO state machine
13. A/B -> verify path
14. C -> generate structured correction request and return to builder
15. D / disagreement / assurance unsatisfied -> stop at Human Gate
16. maximum semantic correction loops governed by VITO (default 3)
17. provider-local technical retry may happen in n8n/worker without incrementing correctionLoopCount
18. once assurance passes, stop at Human Release Gate
19. never commit, push, merge or delete branches without explicit human release authority

## Retry boundary

### Execution Plane retry (n8n/worker)
Allowed examples:
- transient HTTP failure
- connection reset
- temporary worker unavailable
- webhook delivery retry
- process startup retry within policy

These retries increment a technical-attempt counter only.

### Control Plane retry (VITO)
Only VITO can decide:
- correction loop after Verdict C
- reviewer disagreement handling
- assurance retry/re-review
- provider fallback after router decision
- loop exhaustion
- human escalation

Technical retry != correction loop.

## Controlled worker rule

n8n must not receive unrestricted shell access to the host or user HOME.

Preferred contract:

`POST /execute`

with a structured action such as:

- GIT_INSPECT
- RUN_BUILD
- RUN_TESTS
- RUN_REPLAY
- READ_ARTIFACT
- INVOKE_BUILDER
- INVOKE_REVIEWER

The worker maps approved actions to command templates under an explicit repository/worktree policy.

Arbitrary shell strings are denied by default.

## Build-phase repository scope

Initial allowed repositories:
- vito-platform
- aoe-knowledge-engine

Each task must declare:
- repository id/name
- target ref
- worktree role
- allowed command profile
- timeout
- artifact directory

## Git permissions

Before Human Release Gate:
ALLOW:
- git status
- git diff
- git log
- git show
- git rev-parse
- git branch --show-current
- git fetch subject to branch/network policy

DENY:
- git commit
- git push
- git merge
- git branch delete
- remote delete
- destructive reset/clean unless a future explicit isolated policy is approved

## Secrets

- secrets never enter prompts
- secrets never enter stdout/stderr artifacts
- n8n credentials remain inside n8n credential storage / injected adapter environment
- worker receives only the minimum credential needed for its action
- model context must never receive full environment dumps

## Artifact chain

Each run must preserve at minimum:
- task envelope
- baseline git metadata
- builder output/report
- diff/patch reference
- test/build report
- review package
- reviewer output
- parsed verdict
- correction request(s)
- final verification report
- human gate request

Every accepted artifact receives immutable metadata and a content hash.

## Provider neutrality

n8n receives an execution target selected by VITO; it does not contain business logic such as `if Claude then ...`.

Neutral capabilities include:
- CODE_PLAN
- CODE_BUILD
- TEST_EXECUTION
- CODE_REVIEW
- RED_TEAM
- SECURITY_REVIEW
- ARCHITECTURE_REVIEW
- RESEARCH_RUN
- RELEASE_VERIFICATION

Provider candidates may include OpenCode, Codex, Claude, Gemini, local models and deterministic tools.

## Phase plan

### Phase A — Engineering Harness
Goal: eliminate manual copy/paste immediately.
- n8n self-hosted
- controlled worker
- one workflow
- file/artifact store
- simple task envelope
- current provider adapters
- stop at Human Gate

### Phase B — VITO control integration
- ExecutionRuntimePort -> n8n adapter
- VITO provider router
- VITO state persistence
- VITO human gates
- VITO audit/cost/performance

### Phase C — generalized governed execution
- multiple workflows/repositories
- scheduled work
- business automation
- digital employee execution

## Explicit non-goals for Phase A

- generic no-code workflow platform
- customer-facing n8n editor
- autonomous merge
- unrestricted shell
- dynamic policy relaxation
- replacement of VITO state machine
- replacement of Provider Router
- replacement of Human Gates
- Kubernetes
- distributed workflow engine of our own

## Definition of Done — build-phase autopilot v0.1

The system can take a governed engineering task, inspect the assigned repository/worktree, invoke a builder, run deterministic validation, package evidence, invoke an independent reviewer, parse a structured verdict, execute up to the VITO-defined correction limit, handle technical execution retries separately, preserve artifacts and audit metadata, and stop at a Human Review/Release Gate without Alessandro manually copying terminal commands or agent messages between tools.