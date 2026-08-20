# VITO-EO-01 — Productive Acceptance Test Plan

Status: Draft acceptance specification

## Acceptance objective

Validate VITO against real engineering assurance work, not a synthetic demo.

Canonical acceptance task:

> Determine the assurance status of still-open AOE-Core blocks and execute missing BUILD / TEST / RED-TEAM / CORRECTION / RE-REVIEW cycles until the Human Release Gate.

The test stops before release unless a human explicitly approves the exact release context.

## Preconditions

- EO-01.1 gate OPEN
- workflow runtime durable and resumable
- provider router available
- execution sandbox approved
- builder adapter available
- at least one independent reviewer adapter available
- artifact/verdict/correction runtime available
- Human Gate available
- AOE-Core repository/worktree locations explicitly configured
- no unrestricted HOME access
- secrets denied by default

## Discovery phase

VITO must inventory the target assurance state without mutating production source:

- target repository and branch/worktree
- relevant AOE-Core block documents
- current block gate status
- existing build/test evidence
- existing review evidence
- prior correction/re-review evidence
- commit/revision identifiers associated with evidence

Output: immutable/current acceptance input manifest.

## Per-block decision

For each open or uncertain block, VITO determines the missing assurance steps.

Examples:

- BUILD exists + TEST exists + independent RED_TEAM missing -> start at PACKAGE/RED_TEAM as appropriate
- prior C verdict + corrected code exists + no re-review -> TEST/PACKAGE/RED_TEAM
- evidence bound to stale revision -> required assurance steps must be repeated against current revision
- contradictory reviewer evidence -> reviewer disagreement -> Human Gate closed

VITO must never mark a block assured solely because a textual document says OPEN if required machine-verifiable evidence is absent or revision-mismatched.

## Execution path

Expected governed path where all steps are required:

PLAN
-> BUILD
-> TEST
-> PACKAGE
-> RED_TEAM
-> PARSE_VERDICT

Verdict routing:

- A -> VERIFY
- B -> VERIFY with non-blocking findings retained
- C -> CORRECTION -> TEST -> PACKAGE -> RED_TEAM -> PARSE_VERDICT
- D -> HUMAN DECISION

Correction loops:

- maximum automatic loops = 3
- provider retries use a separate counter
- fourth automatic correction is forbidden

## Provider-fallback scenario

Acceptance must intentionally or naturally exercise at least one provider-local failure/fallback scenario before EO-01 is declared operationally proven.

Examples:

- preferred reviewer quota unavailable
- reviewer temporarily unavailable
- provider timeout

Expected behavior:

- provider execution receives normalized local failure status
- correction loop count unchanged
- router evaluates next eligible provider
- assurance requirements are not relaxed
- decision is audited

## Assurance scenarios

At minimum validate:

### AL-2

- independent review present
- builder cannot self-review as the only reviewer when independence policy forbids it

### AL-3

- adversarial review executed
- material findings require correction and re-review

### AL-4

- at least two reviewers
- required distinct model families
- builder/reviewer independence verifiable
- reviewer disagreement closes gate
- unknown required identity/family metadata fails closed
- Human Release Gate mandatory

## Artifact chain

Required artifact/evidence classes as applicable:

- plan
- patch/diff
- build log
- test report
- review package
- review report
- structured verdict
- findings
- correction request
- verification report
- release record only after approval

Every accepted artifact must be bound to:

- workflowRunId
- workflowStepRunId
- producer execution
- repository/revision context
- hash/reference
- timestamp

## Security acceptance

Prove at runtime:

- builder cannot push
- reviewer cannot modify production source
- VITO cannot release independently
- secrets are denied
- unrestricted HOME access denied
- builder/reviewer worktrees are separated
- policy parse/config error fails closed
- release execution cannot occur before explicit approval

## Restart/resume acceptance

Interrupt the VITO service during a non-terminal workflow after durable state exists.

Expected:

- restart does not lose run state
- completed steps are not blindly re-executed
- current/next step reconstructs correctly
- artifacts remain linked
- counters remain correct
- audit chain records resume

## Human Release Gate acceptance

When assurance requirements are satisfied, VITO must stop at a human-controlled release gate and present a compact release evidence package containing at least:

- target repository/revision
- workflow run
- assurance level
- reviewers/model families
- test status
- findings/resolution status
- artifact hashes/references
- correction-loop count
- outstanding non-blocking findings
- release actions requested

Without explicit APPROVED status, commit/push must remain denied.

## Success criteria

VITO-EO-01 v0.1 passes productive acceptance only if all are true:

- real AOE assurance work completed or correctly blocked
- no copy/paste required between builder/reviewer for governed artifacts
- provider routing/fallback demonstrably works
- no provider is architecturally mandatory
- workflow survives restart
- audit chain reconstructs what happened and why
- correction loops are bounded
- disagreement and unmet assurance fail closed
- sandbox prevents forbidden actions
- system stops at Human Release Gate

## Failure criteria

Immediate acceptance failure if any occurs:

- automatic push/merge without explicit human approval
- provider-specific capability coupling in workflow logic
- missing tenant boundary on persisted execution state
- reviewer disagreement silently resolved by averaging/majority
- assurance downgraded automatically to make routing possible
- secret leakage into prompt/artifact/log
- unrestricted HOME access required for normal execution
- correction-loop count conflated with provider retry count
- lost workflow state after restart
- stale review evidence accepted for a materially different revision

## Acceptance report

Final report should contain:

- tested AOE-Core blocks
- initial assurance state
- executed workflow steps
- routing decisions
- provider failures/fallbacks
- artifacts and hashes
- verdicts/findings
- correction cycles
- final assurance state per block
- unresolved blockers
- Human Gate status
- release actions: NOT PERFORMED unless separately approved
