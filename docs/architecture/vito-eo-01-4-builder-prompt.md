# VITO-EO-01.4 — Execution Policy & Sandbox Contract
## Builder Specification v0.1

Status: BUILD SPEC
Base: main
Dependency gates:
- EO-01.1 contracts/state machine
- EO-01.2 workflow runtime
- EO-01.3 provider registry/router

## Objective

Implement the mandatory execution-policy boundary that every future
productive provider execution must pass before EO-01.5 provider adapters
may execute commands or access repository resources.

EO-01.4 does NOT execute LLM/provider workloads.
It decides and enforces whether an intended execution action is permitted.

Core invariant:

Provider routing eligibility != execution permission.

A provider selected by EO-01.3 still MUST pass EO-01.4 policy enforcement.

## Security model

Fail closed.

Missing policy, malformed policy, unknown execution profile,
unknown action, unresolved path, invalid worktree context,
unverifiable release authority or ambiguous command classification
MUST result in DENY / POLICY_BLOCKED.

No fallback-to-allow behavior is permitted.

## Required execution profiles

At minimum:

- BUILDER
- REVIEWER
- ORCHESTRATOR
- RELEASE_AUTHORITY

### BUILDER

May:
- read assigned builder worktree
- modify source inside assigned builder worktree
- create governed temporary/build/test artifacts
- run approved build/test/static-analysis commands
- perform read-only git operations

Must not:
- read secrets
- traverse unrestricted HOME
- write outside assigned builder worktree / governed temp areas
- commit
- push
- merge
- rebase
- delete branches
- modify remote refs

Important:
Prisma schema/migrations are legitimate source modifications when they are
inside the assigned builder worktree. They MUST NOT be globally denied
merely because their path begins with prisma/.

### REVIEWER

May:
- read assigned reviewer/source worktree
- run approved tests/static analysis
- create review artifacts in governed artifact/temp location
- perform read-only git operations

Must not:
- modify production/source files
- modify builder worktree
- read secrets
- commit/push/merge/rebase/delete branches

Reviewer and builder writable source context MUST remain distinct.

### ORCHESTRATOR

May:
- load policy
- inspect execution metadata
- inspect governed artifacts
- record policy/audit decisions
- initiate governed execution requests

Must not directly:
- modify source
- execute arbitrary shell commands
- commit/push/merge

### RELEASE_AUTHORITY

EO-01.4 only defines the policy contract.

Commit/push may become eligible ONLY when:
- workflow release state is valid
- explicit Human Gate is APPROVED
- approval references exact artifact/revision context
- requested action is explicitly granted
- governed release actor is used

Merge and branch deletion remain denied for EO-01 v0.1 unless a later,
explicitly approved policy changes that invariant.

## Required contracts

Add explicit contracts/types for:

### ExecutionProfile

BUILDER
REVIEWER
ORCHESTRATOR
RELEASE_AUTHORITY

### ExecutionAction

At minimum:
- READ_FILE
- WRITE_FILE
- CREATE_FILE
- DELETE_FILE
- RUN_COMMAND
- NETWORK_ACCESS
- READ_SECRET
- GIT_READ
- GIT_COMMIT
- GIT_PUSH
- GIT_MERGE
- GIT_REBASE
- GIT_BRANCH_DELETE
- REMOTE_REF_DELETE

### PolicyDecision

Must contain enough explainability/audit data to include:

- allowed: boolean
- executionProfile
- requestedAction
- reasonCode
- human-readable reason
- organizationId where applicable
- workflowRunId where applicable
- workflowStepRunId where applicable
- correlationId where applicable
- requestedPath / normalizedPath where applicable
- requestedCommand where applicable
- policyVersion

No secrets or complete environment payloads may be included.

## Required reason codes

At minimum:

POLICY_ALLOWED
POLICY_MISSING
POLICY_INVALID
EXECUTION_PROFILE_UNKNOWN
ACTION_UNKNOWN
PATH_OUTSIDE_ALLOWED_ROOT
PATH_EXPLICITLY_DENIED
PATH_TRAVERSAL_REJECTED
HOME_ACCESS_DENIED
SECRET_ACCESS_DENIED
REVIEWER_WRITE_DENIED
COMMAND_NOT_ALLOWED
GIT_COMMIT_DENIED
GIT_PUSH_DENIED
GIT_MERGE_DENIED
GIT_REBASE_DENIED
GIT_BRANCH_DELETE_DENIED
REMOTE_REF_DELETE_DENIED
NETWORK_ACCESS_DENIED
RELEASE_GATE_NOT_APPROVED
EXECUTION_TIMEOUT
EXECUTION_BUDGET_EXCEEDED

Names may be refined if existing project vocabulary requires it,
but semantics must remain explicit and fail closed.

## Filesystem policy

Do not trust raw string-prefix matching.

Policy evaluation must normalize/canonicalize paths before authorization.

Required properties:

- ../ traversal cannot escape allowed root
- absolute path outside worktree denied
- denied path wins over allowed parent/root
- unrestricted HOME denied
- secret-like paths denied
- reviewer source writes denied
- builder writes limited to assigned builder worktree
- governed temp/artifact paths explicitly modeled

Symlink escape must either:
1. be safely resolved and rejected when outside the allowed root, or
2. fail closed if canonical resolution cannot be verified.

## Secret policy

Default DENY.

At minimum deny access to:
- .env
- .env.*
- credential/key/token files where identifiable
- SSH/private-key material
- configured secret paths
- unrestricted process environment export

Provider credentials in EO-01.5 must eventually be injected into the
adapter process with minimum scope and MUST NOT become task/model context.

## Command policy

Do not authorize commands solely because allowTests=true.

Introduce explicit command classification/evaluation.

Read-only git examples that may be allowed:
- git status
- git diff
- git show
- git log
- git rev-parse
- git branch --show-current

Mutating git commands denied before approved release authority:
- git commit
- git push
- git merge
- git rebase
- git branch -D / -d
- git push --delete
- remote ref deletion equivalents

Shell chaining MUST NOT bypass policy.

Examples that must not be misclassified as safe:
- git status && git push
- npm test; git commit ...
- sh -c 'git push ...'

If robust parsing cannot prove safety, fail closed.

## Network policy

Default deny.

Network access requires an explicit policy grant.

Future provider endpoint allowlists belong to provider/tool scoped policy,
not a generic Internet grant.

EO-01.4 does not need to implement the final provider allowlist system,
but the contract and denial behavior must exist.

## Timeout and budget

ExecutionBudget already exists.

EO-01.4 must define policy behavior for:
- maxDurationMs
- maxTokens where measurable
- maxCostMinorUnits where measurable

Unknown/unverifiable enforcement for a required hard budget must fail closed
where execution would otherwise exceed governance certainty.

Timeout produces TIMED_OUT / EXECUTION_TIMEOUT semantics and is NOT a
code-quality finding or correction-loop event.

## Normalized execution outcomes

Preserve:
- POLICY_BLOCKED
- TIMED_OUT
- QUOTA_BLOCKED
- CANCELLED

Do not convert these into review findings.

## Auditability

Every denied execution-policy decision must be representable in the audit
chain with reason code and relevant non-secret metadata.

Material ALLOW decisions for productive execution must also be auditable.

Do not persist:
- secrets
- raw credential values
- complete environment variables

## Required tests

At minimum test:

1. builder reads inside assigned worktree -> allow
2. builder writes source inside assigned worktree -> allow
3. builder may modify prisma schema/migration inside assigned worktree
4. ../ traversal outside worktree -> deny
5. absolute path outside worktree -> deny
6. explicitly denied child path overrides allowed parent
7. .env read -> deny
8. .env.* read -> deny
9. unrestricted HOME read -> deny
10. reviewer source read -> allow
11. reviewer source write -> deny
12. reviewer governed temp artifact creation -> allow
13. git status -> allow
14. git diff -> allow
15. git commit -> deny
16. git push -> deny
17. git merge -> deny
18. git rebase -> deny
19. branch delete -> deny
20. remote ref deletion -> deny
21. chained safe+unsafe command -> deny
22. unknown command classification -> deny
23. network access without grant -> deny
24. network access with explicit grant -> allow
25. missing policy -> deny
26. unknown profile -> deny
27. unknown action -> deny
28. malformed/unresolvable path -> deny
29. release commit without approved Human Gate -> deny
30. release push without approved Human Gate -> deny
31. policy decision exposes no secret values
32. deterministic identical policy inputs -> identical decision
33. policy blocked maps to AgentExecutionStatus.POLICY_BLOCKED
34. timeout maps to TIMED_OUT semantics

Where feasible test symlink escape fail-closed behavior.

## Existing contract compatibility

Refactor/extend the existing ExecutionPermissionPolicy rather than creating
a parallel competing permission system.

Existing secure defaults must remain semantically true:

- allowSecrets = false
- allowGitCommit = false
- allowGitPush = false
- allowMerge = false
- allowBranchDelete = false
- allowNetwork = false

Do not silently weaken existing invariants.

## Non-goals

Do NOT implement:

- productive provider adapter execution
- Claude/OpenAI/OpenCode adapter
- generic policy DSL
- generic sandbox platform
- container/Kubernetes isolation
- billing engine
- secret broker
- autonomous commit/push
- release execution
- EO-01.5 functionality
- EO-01.6 correction loop
- EO-01.7 release gate execution

## Validation

Required before independent review:

- prisma generate if schema touched
- contracts tests
- API tests
- TypeScript compile/build
- EO-01.4 focused tests
- no regression of EO-01.1–EO-01.3 tests

## Gate

EO-01.4 may open only if:

- fail-closed policy enforcement exists
- builder/reviewer isolation is enforced
- path traversal is rejected
- secret/HOME access is rejected
- git mutation is rejected pre-release
- unknown policy/action/profile fails closed
- policy results are explainable/auditable
- all tests/build pass
- independent red-team review returns PASS
- no productive provider execution was introduced

No productive EO-01.5 provider adapter may execute before this gate is OPEN.
