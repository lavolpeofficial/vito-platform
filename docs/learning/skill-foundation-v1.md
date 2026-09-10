# VITO Self-Learning Core v1 · Phase 7 · Skill Foundation

Phase 7 introduces a governed representation for reusable skill candidates derived from mature, objective learning evidence.

## Boundary

A `SkillCandidate` is metadata, not executable production behavior.

It MUST NOT:

- generate or modify source code autonomously;
- create, enable or mutate a production `Capability`;
- bypass VITO governance or approval boundaries;
- arise from a single unsupported observation or free-form model reflection.

## Recording gate

A skill candidate may be recorded only when all of the following are true:

1. the authenticated organization owns all referenced evidence;
2. the source `LearningCandidate` is ACTIVE and has reached PATTERN or POLICY maturity;
3. source learning confidence is at least 0.70;
4. the proposed skill confidence is at least 0.70;
5. at least two distinct persisted objective Outcomes from the source LearningCandidate's Experience support it;
6. the request is made in an authenticated JWT user context;
7. an explicit governance `approvalRef` is supplied.

The 0.70 threshold is the deterministic v1 minimum. It is intentionally simple and may later become organization policy rather than hard-coded configuration.

## Evidence grounding

Supporting Outcome IDs are validated against both the authenticated organization and the exact Experience referenced by the source LearningCandidate. Outcomes from another Experience in the same tenant are not accepted as supporting evidence. This prevents unrelated evidence from being used to justify skill reuse.

## Persistence

`skill_candidates` records:

- organization scope;
- source learning candidate;
- stable code and human-readable name/description;
- structured procedure metadata;
- applicability metadata;
- supporting objective Outcome IDs;
- confidence;
- governance approval reference and approving user;
- lifecycle status.

The lifecycle values are `RECORDED`, `REJECTED`, and `RETIRED`. There is deliberately no `ENABLED` or `EXECUTABLE` state in this phase.

## Audit

Successful recording emits `LEARNING_SKILL_CANDIDATE_RECORDED` with the source candidate, source Experience, evidence IDs, confidence, approval reference and `executable: false`.

## Future boundary

A later governed activation layer may map an explicitly approved skill candidate to an existing or new VITO Capability. That conversion, any executable implementation, and autonomous code generation are outside Self-Learning Core v1.
