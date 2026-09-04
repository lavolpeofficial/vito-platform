# VITO Engineering Autopilot v0.1

Status: Phase A bootstrap implemented; productive provider execution intentionally gated behind EO-01.4.
Purpose: eliminate manual copy/paste and agent handoffs during VITO/AOE engineering while preserving VITO governance and human release authority.

## Core decision

VITO remains the Control Plane and source of truth for engineering governance.
n8n is introduced as an Execution Plane for transport, scheduling, trigger handling, API orchestration and technical retries.
Workers/agents perform the actual work.

VITO != n8n.
n8n != provider router.
n8n != assurance authority.

## Current implementation status — 2026-08-20

Implemented on `feature/vito-eo-01-governed-runtime-v0.1`:

- `tools/engineering-worker/server.mjs`
  - localhost-only worker (`127.0.0.1:8081`)
  - bearer-authenticated `POST /execute`
  - static repository registry
  - typed actions: `GIT_INSPECT`, `RUN_BUILD`, `RUN_TESTS`, `RUN_PRISMA_GENERATE`
  - arbitrary action deny by default
  - `shell: false`
  - minimal environment and fake/non-user HOME
  - timeout/process-group termination
  - stdout/stderr caps
  - SHA-256 artifact references
  - process-local executionId idempotency
- `infra/n8n/docker-compose.autopilot.yml`
  - self-hosted n8n
  - Linux host networking so n8n can reach the localhost-only worker without exposing it on `0.0.0.0`
  - n8n bound to `127.0.0.1:5678`
- `infra/n8n/workflows/vito-engineering-bootstrap-v1.json`
  - importable bootstrap workflow
  - `GIT_INSPECT -> RUN_TESTS -> RUN_BUILD -> response`
- bootstrap/import/smoke-test scripts under `scripts/autopilot/`
- local artifacts ignored by Git
- bootstrap runbook: `docs/architecture/vito-autopilot-bootstrap-runbook-v0.1.md`
- EO-01.3 provider-router builder prompt prepared

Productive `INVOKE_BUILDER` / `INVOKE_REVIEWER` actions remain disabled until EO-01.4 Execution Policy & Sandbox passes its security gate. This preserves the rule that no productive provider adapter executes before sandbox/policy controls are approved.

## Immediate build-phase objective

The practical goal is not a generic automation platform. It is to remove Alessandro from the manual message-bus role between ChatGPT, OpenCode/Big Pickle, reviewers, terminal commands, test runs and Git inspection.

EO-01.2 was the final fully manual bootstrap block. EO-01.3 is prepared as the next build block while the deterministic execution plane is brought online. Productive agent invocation is intentionally deferred until the EO-01.4 sandbox gate.

Desired operator experience:

`Start EO-01.3`

Then the system proceeds autonomously through BUILD / TEST / PACKAGE / REVIEW / CORRECTION cycles until a governed Human Gate is reached once the execution-policy gate allows provider adapters.

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
      - OpenCode builder adapter (after EO-01.4)
      - reviewer adapter(s) (after EO-01.4)
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
19. never merge or release without explicit human authority

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

DENY by default until a separate engineering-autonomy policy explicitly enables them:
- git commit
- git push
- git merge
- git branch delete
- remote delete
- destructive reset/clean

Merge to main and release/deployment remain Human Gate operations in v0.1.

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
Goal: eliminate deterministic manual terminal relays first.
- self-hosted n8n
- controlled worker
- bootstrap workflow
- file/artifact store
- simple task envelope
- no productive agent adapters until EO-01.4

### Phase B — VITO control integration
- EO-01.3 provider registry/router
- EO-01.4 execution policy/sandbox
- ExecutionRuntimePort -> n8n adapter
- VITO state persistence
- VITO human gates
- VITO audit/cost/performance
- productive provider adapters only after the policy gate

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

## Bootstrap exit criteria

Before we claim manual relay is removed:
- self-hosted n8n is running
- controlled worker has authenticated typed action interface
- repo/worktree allowlist enforced
- health/echo workflow works
- GIT_INSPECT workflow returns normalized branch/status
- RUN_TESTS/RUN_BUILD works in an allowlisted worktree
- builder invocation can return a structured result (after EO-01.4)
- reviewer invocation can return a structured verdict (after EO-01.4)
- technical retry counter is separate from correctionLoopCount
- artifacts are stored with hashes
- workflow stops at Human Gate
- no unrestricted shell/HOME access

## Definition of Done — build-phase autopilot v0.1

The system can take a governed engineering task, inspect the assigned repository/worktree, invoke a builder, run deterministic validation, package evidence, invoke an independent reviewer, parse a structured verdict, execute up to the VITO-defined correction limit, handle technical execution retries separately, preserve artifacts and audit metadata, and stop at a Human Review/Release Gate without Alessandro manually copying terminal commands or agent messages between tools.
