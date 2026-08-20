# VITO-EO-01 — Golden Acceptance Fixtures v0.1

Status: Prepared test specification

## Goal

Maintain small, reproducible fixtures that prove governance behavior independent of live providers.

## Fixture set

### GF-01 Happy AL2
Builder succeeds, tests pass, one reviewer verdict A, verify, human gate pending.

### GF-02 Verdict B
Reviewer returns B with non-blocking findings. Workflow proceeds to VERIFY; findings remain attributable.

### GF-03 Verdict C
Reviewer returns C. Workflow enters CORRECTION, then TEST/PACKAGE/RED_TEAM.

### GF-04 Verdict D
Workflow blocks for HUMAN_DECISION_REQUIRED.

### GF-05 Reviewer disagreement
Two reviewers return A/C. Workflow blocks REVIEW_DISAGREEMENT.

### GF-06 AL4 valid
Two distinct reviewer executions, distinct required model families, builder/reviewer independence, unanimous A. Workflow may proceed to VERIFY.

### GF-07 AL4 evidence missing
Metadata claims two reviewers but only one ReviewResult. Workflow blocks assurance-unsatisfied.

### GF-08 Quota fallback
Preferred reviewer quota-blocked. Correction counter unchanged. Eligible fallback selected.

### GF-09 Loop exhaustion
Third correction loop completes and next required correction blocks with LOOP_EXHAUSTED.

### GF-10 Artifact integrity
Artifact content altered after accepted hash. Workflow blocks ARTIFACT_INTEGRITY_FAILED.

### GF-11 Restart/resume
Runtime stops with persisted RUNNING/PENDING state. Recovery reclaims stale lease and resumes without duplicate logical side effect.

### GF-12 Human release boundary
No approval -> RELEASE_EXECUTION impossible. Approval bound to exact evidence -> release action eligible.

### GF-13 Policy deny
Reviewer attempts source write or builder attempts push. POLICY_BLOCKED; no quality/correction implication.

### GF-14 No eligible provider
All candidates unavailable/ineligible -> explicit NO_ELIGIBLE_PROVIDER and blocked run.

## Fixture format

Each fixture should contain:
- input EngineeringTask
- workflow definition version
- provider registry fixture
- scripted provider responses
- expected transitions
- expected reason codes
- expected audit events
- expected artifacts/hashes where applicable
- expected final workflow status

## Invariant

Golden fixtures are version-controlled and deterministic. Updating expected outcomes requires explicit architecture/gate review, not casual snapshot regeneration.
