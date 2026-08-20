# VITO-EO-01 — Prepared Build Prompts EO-01.2 to EO-01.7

Status: Prepared execution prompts
Rule: Use only after the preceding block Gate is OPEN. No block may pre-implement later scope.

---

## EO-01.2 — Workflow Runtime

You are implementing VITO-EO-01.2 in `lavolpeofficial/vito-platform` on the clean governed runtime branch/worktree.

Read first:
- `docs/architecture/vito-eo-01-roadmap.md`
- `docs/architecture/vito-eo-01-2-runtime-data-model-spec.md`
- `docs/architecture/vito-eo-01-reason-codes-and-audit-vocabulary.md`
- EO-01.1 contracts/state machine

Mission: persist and resume the deterministic engineering workflow. Add only minimal Prisma models and NestJS runtime services required for WorkflowRun/WorkflowStepRun, atomic transitions, restart/resume and audit.

Must-have:
- tenant-scoped WorkflowRun/WorkflowStepRun
- versioned workflow definition code remains code/config
- state machine remains transition source of truth
- stale/invalid transition rejection
- correction counter correctness
- correlation/causation IDs
- restart/resume
- audit every transition
- tests from EO-01.2 spec

Do not build: provider registry/router, adapters, AgentExecution, artifacts, generic workflow engine, Temporal/Kafka/LangGraph, UI.

Run relevant tests, full tests and build. Do not commit or push. Return `VITO-EO-01.2 BUILD REPORT` and stop.

---

## EO-01.3 — Provider Registry & Router

Read first:
- roadmap
- provider-router contract
- provider-health conventions
- reason-code/audit vocabulary
- EO-01.1 assurance contracts
- EO-01.2 runtime

Mission: implement provider-neutral registry + deterministic router. Capability != Provider.

Must-have:
- provider type including CLOUD_LLM / LOCAL_LLM / DETERMINISTIC_TOOL where applicable
- capability declarations
- model-family metadata
- enabled/health/quota/capacity state
- assurance compatibility
- reviewer independence eligibility
- budget eligibility
- eligibility before scoring
- deterministic explainable scoring
- ordered fallback candidates
- auditable ProviderRoutingDecision
- no provider may win after failing eligibility
- no autonomous assurance downgrade

Do not build actual provider execution adapters yet. No Claude/OpenCode/Codex-specific workflow branching.

Tests must prove fallback, quota exclusion, independence exclusion, deterministic routing and NO_ELIGIBLE_PROVIDER fail-closed behavior.

Run tests/build. Do not commit/push. Return `VITO-EO-01.3 BUILD REPORT` and stop.

---

## EO-01.4 — Execution Policy & Sandbox

Read first:
- sandbox/permission matrix
- worktree strategy
- reason codes
- EO-01.3 router

Mission: implement enforceable execution policy boundary before any productive provider adapter can run.

Must-have:
- explicit builder/reviewer/release execution profiles
- allowed/denied path enforcement
- denied path overrides allowed path
- no unrestricted HOME
- secrets deny
- git mutation deny pre-release
- reviewer source writes deny
- network allow/deny policy
- timeout/budget enforcement contracts/runtime guards
- unknown/malformed policy fail closed
- normalized POLICY_BLOCKED/TIMED_OUT outcomes
- audit policy decisions

No `dangerously-skip-permissions`. No provider adapters yet except mocks/fakes for policy tests.

Security tests are mandatory. Do not commit/push. Return `VITO-EO-01.4 BUILD REPORT` and stop.

---

## EO-01.5 — Provider Adapters

Read first:
- provider router
- local reviewer node spec
- sandbox policy
- worktree strategy

Mission: implement common `execute(request) -> AgentExecutionResult` adapter boundary and first real provider/tool adapters behind EO-01.4 policy.

Initial target adapters:
- OpenCode/Big Pickle builder adapter
- Claude reviewer adapter when available
- Codex/OpenAI reviewer/fallback when available
- local reviewer adapter interface/runtime path
- deterministic tool adapter path

Must-have:
- provider-specific code only inside adapter layer
- normalized result/status/stdout/stderr metadata
- timeout/cancel
- token/cost capture where available
- quota/rate-limit normalization
- execution audit
- no commit/push/merge authority
- credentials injected minimally and never exposed to model context/artifacts

Use mocks when external credentials are unavailable; separate adapter contract tests from live smoke tests.

Do not commit/push. Return `VITO-EO-01.5 BUILD REPORT` and stop.

---

## EO-01.6 — Artifact, Verdict & Correction Runtime

Read first:
- artifact conventions
- reason/audit vocabulary
- EO-01.1 state machine
- EO-01.2 runtime
- EO-01.5 adapters

Mission: close the governed build-review-correction loop.

Must-have:
- AgentExecution persistence
- ExecutionArtifact registry with SHA-256
- immutable accepted artifacts
- lineage to workflow run/step/execution
- review-package generator
- structured review-result/verdict parsing
- findings persistence
- reviewer-disagreement handling
- correction request generation
- re-test/re-package/re-review
- max correction loops = policy value, default 3
- provider retries do not increment correction loops
- loop exhaustion -> human gate/block
- artifact integrity failure fail closed

No release mutation yet.

Tests must cover artifact lineage, hash mismatch, A/B/C/D paths, disagreement, provider retry vs correction loop and restart/resume through a correction cycle.

Do not commit/push. Return `VITO-EO-01.6 BUILD REPORT` and stop.

---

## EO-01.7 — Human Release Gate & Release Execution

Read first:
- Human Gate contracts
- sandbox matrix
- worktree strategy
- artifact conventions
- EO-01.6 runtime

Mission: implement explicit human-controlled release boundary.

Must-have:
- HumanGate persistence
- approve/reject/expire semantics
- immutable approval context bound to exact revision/artifact hashes
- no approval -> no RELEASE_EXECUTION
- release actor separate from builder/reviewer
- commit/push only through governed release adapter after approval
- merge remains denied unless separately approved future policy
- branch deletion denied
- remote verification
- auditable release failure
- stale/mismatched approval context blocks release

Tests must prove attempts to release unapproved or changed artifacts are rejected.

Do not merge to main automatically. Do not delete branches. Return `VITO-EO-01.7 BUILD REPORT` and stop.

---

## Final acceptance after EO-01.7 Gate OPEN

Execute the real AOE-Core assurance scenario from `docs/architecture/vito-eo-01-acceptance-test-plan.md`. Stop at Human Release Gate unless explicit human approval is provided for the exact release context.
