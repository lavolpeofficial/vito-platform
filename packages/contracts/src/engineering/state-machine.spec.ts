/**
 * Unit Tests für die deterministische Engineering-Workflow-State-Machine.
 *
 * Korrektur 01: Reviewer Disagreement, AL4 Enforcement, Fail-Closed Unknown Builder.
 * Korrektur 02: AL4 Evidence Binding — require actual reviewResults, not metadata.
 */

import { EngineeringStepType } from './workflow.js';
import { ReviewVerdict, resolveReviewerDisagreement, type ReviewResult } from './review.js';
import { AgentExecutionStatus, DEFAULT_RETRY_POLICY, type IndependenceContext } from './execution.js';
import { AssuranceLevel } from './assurance.js';
import { nextEngineeringStep, checkAl4Independence, type StateMachineInput } from './state-machine.js';
import { createDefaultEngineeringPermissionPolicy } from './permissions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(overrides: Partial<StateMachineInput> = {}): StateMachineInput {
  return {
    completedStep: EngineeringStepType.PLAN,
    stepStatus: 'SUCCEEDED',
    correctionLoopCount: 0,
    retryPolicy: DEFAULT_RETRY_POLICY,
    ...overrides,
  };
}

function successInput(step: EngineeringStepType, overrides: Partial<StateMachineInput> = {}): StateMachineInput {
  return baseInput({ completedStep: step, stepStatus: 'SUCCEEDED', ...overrides });
}

function failedInput(step: EngineeringStepType, overrides: Partial<StateMachineInput> = {}): StateMachineInput {
  return baseInput({ completedStep: step, stepStatus: 'FAILED', ...overrides });
}

function makeReviewResult(verdict: ReviewVerdict, id = `reviewer-${verdict}`): ReviewResult {
  return {
    verdict,
    findings: [],
    reviewerExecutionId: id,
    assuranceLevel: AssuranceLevel.AL2,
    artifactRefs: [],
  };
}

function al4Context(overrides: Partial<IndependenceContext> = {}): IndependenceContext {
  return {
    builderModelFamily: 'claude',
    previousReviewerProviderIds: ['r1', 'r2'],
    previousReviewerModelFamilies: ['gpt-4', 'gemini'],
    ...overrides,
  };
}

function al4Input(overrides: Partial<StateMachineInput> = {}): StateMachineInput {
  return successInput(EngineeringStepType.PARSE_VERDICT, {
    reviewResults: [makeReviewResult(ReviewVerdict.A, 'reviewer-r1'), makeReviewResult(ReviewVerdict.A, 'reviewer-r2')],
    assuranceLevel: AssuranceLevel.AL4,
    independenceContext: al4Context(),
    ...overrides,
  });
}

// ===========================================================================
// §19.1 Happy Path A (Verdict A)
// ===========================================================================

describe('Happy Path A (Verdict A)', () => {
  it('PLAN → BUILD', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.PLAN))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.BUILD });
  });

  it('BUILD → TEST', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.BUILD))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.TEST });
  });

  it('TEST → PACKAGE', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.TEST))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.PACKAGE });
  });

  it('PACKAGE → RED_TEAM', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.PACKAGE))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.RED_TEAM });
  });

  it('RED_TEAM → PARSE_VERDICT', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.RED_TEAM))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.PARSE_VERDICT });
  });

  it('PARSE_VERDICT(A) → VERIFY (non-AL4, single reviewer)', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, { verdict: ReviewVerdict.A }))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.VERIFY });
  });

  it('VERIFY → HUMAN_RELEASE_GATE', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.VERIFY))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.HUMAN_RELEASE_GATE });
  });

  it('HUMAN_RELEASE_GATE (approved) → RELEASE_EXECUTION', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.HUMAN_RELEASE_GATE, { humanApproved: true }))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.RELEASE_EXECUTION });
  });

  it('RELEASE_EXECUTION → REMOTE_VERIFY', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.RELEASE_EXECUTION))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.REMOTE_VERIFY });
  });

  it('REMOTE_VERIFY → COMPLETED', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.REMOTE_VERIFY))).toEqual({ kind: 'COMPLETED' });
  });
});

// ===========================================================================
// §19.2 Verdict B → VERIFY
// ===========================================================================

describe('Verdict B', () => {
  it('PARSE_VERDICT(B) → VERIFY', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, { verdict: ReviewVerdict.B }))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.VERIFY });
  });
});

// ===========================================================================
// §19.3 Verdict C → CORRECTION
// ===========================================================================

describe('Verdict C', () => {
  it('PARSE_VERDICT(C) → CORRECTION', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, { verdict: ReviewVerdict.C }))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.CORRECTION });
  });
});

// ===========================================================================
// §19.4 Correction Loop
// ===========================================================================

describe('Correction Loop', () => {
  it('CORRECTION → TEST', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.CORRECTION))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.TEST });
  });

  it('Full loop: CORRECTION → TEST → PACKAGE → RED_TEAM → PARSE_VERDICT', () => {
    const r = [
      nextEngineeringStep(successInput(EngineeringStepType.CORRECTION)),
      nextEngineeringStep(successInput(EngineeringStepType.TEST)),
      nextEngineeringStep(successInput(EngineeringStepType.PACKAGE)),
      nextEngineeringStep(successInput(EngineeringStepType.RED_TEAM)),
    ];
    expect(r).toEqual([
      { kind: 'NEXT_STEP', nextStep: EngineeringStepType.TEST },
      { kind: 'NEXT_STEP', nextStep: EngineeringStepType.PACKAGE },
      { kind: 'NEXT_STEP', nextStep: EngineeringStepType.RED_TEAM },
      { kind: 'NEXT_STEP', nextStep: EngineeringStepType.PARSE_VERDICT },
    ]);
  });
});

// ===========================================================================
// §19.5 maxCorrectionLoops = 3
// ===========================================================================

describe('maxCorrectionLoops = 3', () => {
  it('PARSE_VERDICT(C) at loop 3 → BLOCKED + LOOP_EXHAUSTED', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, {
      verdict: ReviewVerdict.C, correctionLoopCount: 3,
    }))).toEqual({ kind: 'BLOCKED', reason: { type: 'LOOP_EXHAUSTED', correctionLoopCount: 3 } });
  });

  it('TEST failure at loop 3 → BLOCKED', () => {
    expect(nextEngineeringStep(failedInput(EngineeringStepType.TEST, { correctionLoopCount: 3 }))).toEqual({
      kind: 'BLOCKED', reason: { type: 'LOOP_EXHAUSTED', correctionLoopCount: 3 },
    });
  });

  it('loop count 2 allows correction (count < max)', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, {
      verdict: ReviewVerdict.C, correctionLoopCount: 2,
    }))).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.CORRECTION });
  });
});

// ===========================================================================
// §19.6 Verdict D → HUMAN_DECISION_REQUIRED
// ===========================================================================

describe('Verdict D', () => {
  it('PARSE_VERDICT(D) → BLOCKED + HUMAN_DECISION_REQUIRED', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, { verdict: ReviewVerdict.D }))).toEqual({
      kind: 'BLOCKED', reason: { type: 'HUMAN_DECISION_REQUIRED', verdict: ReviewVerdict.D },
    });
  });
});

// ===========================================================================
// §19.7 REVIEWER DISAGREEMENT (Korrektur 01)
// ===========================================================================

describe('Reviewer Disagreement', () => {
  describe('resolveReviewerDisagreement (contract-level)', () => {
    it('A vs C → hasDisagreement', () => {
      const r = resolveReviewerDisagreement([makeReviewResult(ReviewVerdict.A, 'r1'), makeReviewResult(ReviewVerdict.C, 'r2')]);
      expect(r.hasDisagreement).toBe(true);
      if (r.hasDisagreement) expect(r.verdicts).toEqual([ReviewVerdict.A, ReviewVerdict.C]);
    });

    it('A vs A → no disagreement', () => {
      const r = resolveReviewerDisagreement([makeReviewResult(ReviewVerdict.A, 'r1'), makeReviewResult(ReviewVerdict.A, 'r2')]);
      expect(r.hasDisagreement).toBe(false);
      if (!r.hasDisagreement) expect(r.mergedVerdict).toBe(ReviewVerdict.A);
    });

    it('B vs C → hasDisagreement', () => {
      const r = resolveReviewerDisagreement([makeReviewResult(ReviewVerdict.B, 'r1'), makeReviewResult(ReviewVerdict.C, 'r2')]);
      expect(r.hasDisagreement).toBe(true);
      if (r.hasDisagreement) expect(r.verdicts).toEqual([ReviewVerdict.B, ReviewVerdict.C]);
    });

    it('empty results → hasDisagreement', () => {
      expect(resolveReviewerDisagreement([]).hasDisagreement).toBe(true);
    });

    it('single result → no disagreement', () => {
      const r = resolveReviewerDisagreement([makeReviewResult(ReviewVerdict.A)]);
      expect(r.hasDisagreement).toBe(false);
    });

    it('three reviewers all different → hasDisagreement', () => {
      const r = resolveReviewerDisagreement([
        makeReviewResult(ReviewVerdict.A, 'r1'),
        makeReviewResult(ReviewVerdict.B, 'r2'),
        makeReviewResult(ReviewVerdict.C, 'r3'),
      ]);
      expect(r.hasDisagreement).toBe(true);
    });

    it('three reviewers all same → no disagreement', () => {
      const r = resolveReviewerDisagreement([
        makeReviewResult(ReviewVerdict.B, 'r1'),
        makeReviewResult(ReviewVerdict.B, 'r2'),
        makeReviewResult(ReviewVerdict.B, 'r3'),
      ]);
      expect(r.hasDisagreement).toBe(false);
      if (!r.hasDisagreement) expect(r.mergedVerdict).toBe(ReviewVerdict.B);
    });
  });

  describe('state machine integration', () => {
    it('A vs C → BLOCKED + REVIEW_DISAGREEMENT', () => {
      const result = nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, {
        reviewResults: [makeReviewResult(ReviewVerdict.A, 'r1'), makeReviewResult(ReviewVerdict.C, 'r2')],
      }));
      expect(result).toEqual({
        kind: 'BLOCKED',
        reason: { type: 'REVIEW_DISAGREEMENT', verdicts: [ReviewVerdict.A, ReviewVerdict.C] },
      });
    });

    it('A vs A → VERIFY (no disagreement)', () => {
      const result = nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, {
        reviewResults: [makeReviewResult(ReviewVerdict.A, 'r1'), makeReviewResult(ReviewVerdict.A, 'r2')],
      }));
      expect(result).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.VERIFY });
    });

    it('B vs C → BLOCKED + REVIEW_DISAGREEMENT', () => {
      const result = nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, {
        reviewResults: [makeReviewResult(ReviewVerdict.B, 'r1'), makeReviewResult(ReviewVerdict.C, 'r2')],
      }));
      expect(result).toEqual({
        kind: 'BLOCKED',
        reason: { type: 'REVIEW_DISAGREEMENT', verdicts: [ReviewVerdict.B, ReviewVerdict.C] },
      });
    });

    it('no verdict and no reviewResults → BLOCKED + REVIEW_DISAGREEMENT', () => {
      const result = nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, {
        verdict: undefined,
        reviewResults: undefined,
      }));
      expect(result.kind).toBe('BLOCKED');
      if (result.kind === 'BLOCKED') {
        expect(result.reason.type).toBe('REVIEW_DISAGREEMENT');
      }
    });
  });
});

// ===========================================================================
// §19.8 AL4 EVIDENCE BINDING (Korrektur 02)
// ===========================================================================

describe('AL4 Evidence Binding', () => {
  it('A) AL4 + single verdict: A + apparently valid metadata → BLOCKED + REVIEW_EVIDENCE_INSUFFICIENT', () => {
    const result = nextEngineeringStep(al4Input({
      verdict: ReviewVerdict.A,
      reviewResults: undefined,
    }));
    expect(result).toEqual({
      kind: 'BLOCKED',
      reason: { type: 'ASSURANCE_UNSATISFIED', reason: 'REVIEW_EVIDENCE_INSUFFICIENT' },
    });
  });

  it('B) AL4 + only one ReviewResult → BLOCKED + REVIEW_EVIDENCE_INSUFFICIENT', () => {
    const result = nextEngineeringStep(al4Input({
      reviewResults: [makeReviewResult(ReviewVerdict.A, 'reviewer-r1')],
    }));
    expect(result).toEqual({
      kind: 'BLOCKED',
      reason: { type: 'ASSURANCE_UNSATISFIED', reason: 'REVIEW_EVIDENCE_INSUFFICIENT' },
    });
  });

  it('C) AL4 + two ReviewResults but identical reviewerExecutionId → BLOCKED + REVIEWER_EXECUTION_NOT_DISTINCT', () => {
    const result = nextEngineeringStep(al4Input({
      reviewResults: [
        makeReviewResult(ReviewVerdict.A, 'same-exec-id'),
        makeReviewResult(ReviewVerdict.A, 'same-exec-id'),
      ],
    }));
    expect(result).toEqual({
      kind: 'BLOCKED',
      reason: { type: 'ASSURANCE_UNSATISFIED', reason: 'REVIEWER_EXECUTION_NOT_DISTINCT' },
    });
  });

  it('D) AL4 + duplicate reviewer provider IDs → BLOCKED + REVIEWER_PROVIDER_NOT_DISTINCT', () => {
    const result = nextEngineeringStep(al4Input({
      independenceContext: {
        builderModelFamily: 'claude',
        previousReviewerProviderIds: ['same-provider', 'same-provider'],
        previousReviewerModelFamilies: ['gpt-4', 'gemini'],
      },
    }));
    expect(result).toEqual({
      kind: 'BLOCKED',
      reason: { type: 'ASSURANCE_UNSATISFIED', reason: 'REVIEWER_PROVIDER_NOT_DISTINCT' },
    });
  });

  it('E) AL4 + two distinct actual reviewers + valid metadata + unanimous A → VERIFY', () => {
    const result = nextEngineeringStep(al4Input());
    expect(result).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.VERIFY });
  });

  it('E2) AL4 + two distinct actual reviewers + valid metadata + unanimous B → VERIFY', () => {
    const result = nextEngineeringStep(al4Input({
      reviewResults: [
        makeReviewResult(ReviewVerdict.B, 'reviewer-r1'),
        makeReviewResult(ReviewVerdict.B, 'reviewer-r2'),
      ],
    }));
    expect(result).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.VERIFY });
  });

  it('F) AL4 + valid independent reviewers + A vs C → REVIEW_DISAGREEMENT', () => {
    const result = nextEngineeringStep(al4Input({
      reviewResults: [
        makeReviewResult(ReviewVerdict.A, 'reviewer-r1'),
        makeReviewResult(ReviewVerdict.C, 'reviewer-r2'),
      ],
    }));
    expect(result).toEqual({
      kind: 'BLOCKED',
      reason: { type: 'REVIEW_DISAGREEMENT', verdicts: [ReviewVerdict.A, ReviewVerdict.C] },
    });
  });

  it('non-AL4 does not enforce evidence binding', () => {
    const result = nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, {
      verdict: ReviewVerdict.A,
      independenceContext: {
        builderModelFamily: 'claude',
        previousReviewerProviderIds: ['r1'],
        previousReviewerModelFamilies: ['claude'],
      },
    }));
    expect(result).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.VERIFY });
  });
});

// ===========================================================================
// §19.8b AL4 + Unknown Builder Model Family (Korrektur 03, evidence-aware)
// ===========================================================================

describe('AL4 Unknown Builder Model Family → Fail Closed', () => {
  it('AL4 + missing builderModelFamily + valid reviewResults → BLOCKED + BUILDER_MODEL_FAMILY_UNKNOWN', () => {
    const result = nextEngineeringStep(al4Input({
      independenceContext: {
        previousReviewerProviderIds: ['r1', 'r2'],
        previousReviewerModelFamilies: ['gpt-4', 'gemini'],
      },
    }));
    expect(result).toEqual({
      kind: 'BLOCKED',
      reason: { type: 'ASSURANCE_UNSATISFIED', reason: 'BUILDER_MODEL_FAMILY_UNKNOWN' },
    });
  });

  it('AL4 + empty string builderModelFamily → BLOCKED', () => {
    const result = nextEngineeringStep(al4Input({
      independenceContext: {
        builderModelFamily: '   ',
        previousReviewerProviderIds: ['r1', 'r2'],
        previousReviewerModelFamilies: ['gpt-4', 'gemini'],
      },
    }));
    expect(result).toEqual({
      kind: 'BLOCKED',
      reason: { type: 'ASSURANCE_UNSATISFIED', reason: 'BUILDER_MODEL_FAMILY_UNKNOWN' },
    });
  });

  it('AL4 + no independenceContext at all + valid reviewResults → BLOCKED', () => {
    const result = nextEngineeringStep(successInput(EngineeringStepType.PARSE_VERDICT, {
      reviewResults: [makeReviewResult(ReviewVerdict.A, 'reviewer-r1'), makeReviewResult(ReviewVerdict.A, 'reviewer-r2')],
      assuranceLevel: AssuranceLevel.AL4,
      independenceContext: undefined,
    }));
    expect(result).toEqual({
      kind: 'BLOCKED',
      reason: { type: 'ASSURANCE_UNSATISFIED', reason: 'MIN_REVIEWER_COUNT_UNSATISFIED' },
    });
  });

  it('checkAl4Independence standalone: missing builder → BUILDER_MODEL_FAMILY_UNKNOWN', () => {
    const ctx: IndependenceContext = {
      previousReviewerProviderIds: ['r1', 'r2'],
      previousReviewerModelFamilies: ['gpt-4', 'gemini'],
    };
    expect(checkAl4Independence(ctx, 2)).toBe('BUILDER_MODEL_FAMILY_UNKNOWN');
  });
});

// ===========================================================================
// §19.9 QUOTA_BLOCKED
// ===========================================================================

describe('QUOTA_BLOCKED', () => {
  it('QUOTA_BLOCKED → BLOCKED (not FAILED, not CORRECTION)', () => {
    expect(nextEngineeringStep({
      completedStep: EngineeringStepType.TEST,
      stepStatus: 'SUCCEEDED',
      providerStatus: AgentExecutionStatus.QUOTA_BLOCKED,
      correctionLoopCount: 0,
      retryPolicy: DEFAULT_RETRY_POLICY,
    })).toEqual({
      kind: 'BLOCKED',
      reason: { type: 'PROVIDER_BLOCKED', providerStatus: AgentExecutionStatus.QUOTA_BLOCKED },
    });
  });

  it('POLICY_BLOCKED → BLOCKED', () => {
    expect(nextEngineeringStep({
      completedStep: EngineeringStepType.BUILD,
      stepStatus: 'SUCCEEDED',
      providerStatus: AgentExecutionStatus.POLICY_BLOCKED,
      correctionLoopCount: 0,
      retryPolicy: DEFAULT_RETRY_POLICY,
    })).toEqual({
      kind: 'BLOCKED',
      reason: { type: 'PROVIDER_BLOCKED', providerStatus: AgentExecutionStatus.POLICY_BLOCKED },
    });
  });
});

// ===========================================================================
// §19.10 Release ohne Human Approval
// ===========================================================================

describe('Release Execution without Human Approval', () => {
  it('HUMAN_RELEASE_GATE without approval → BLOCKED + HUMAN_APPROVAL_MISSING', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.HUMAN_RELEASE_GATE, { humanApproved: false }))).toEqual({
      kind: 'BLOCKED', reason: { type: 'HUMAN_APPROVAL_MISSING' },
    });
  });

  it('HUMAN_RELEASE_GATE with undefined approval → BLOCKED', () => {
    expect(nextEngineeringStep(successInput(EngineeringStepType.HUMAN_RELEASE_GATE, { humanApproved: undefined }))).toEqual({
      kind: 'BLOCKED', reason: { type: 'HUMAN_APPROVAL_MISSING' },
    });
  });
});

// ===========================================================================
// §19.11 Secure Permission Defaults
// ===========================================================================

describe('Secure Permission Defaults', () => {
  it('forbids commit, push, merge, branch delete, secrets', () => {
    const p = createDefaultEngineeringPermissionPolicy();
    expect(p.allowGitCommit).toBe(false);
    expect(p.allowGitPush).toBe(false);
    expect(p.allowMerge).toBe(false);
    expect(p.allowBranchDelete).toBe(false);
    expect(p.allowSecrets).toBe(false);
  });

  it('allows read, write, tests', () => {
    const p = createDefaultEngineeringPermissionPolicy();
    expect(p.allowRead).toBe(true);
    expect(p.allowWrite).toBe(true);
    expect(p.allowTests).toBe(true);
  });

  it('denies network', () => {
    expect(createDefaultEngineeringPermissionPolicy().allowNetwork).toBe(false);
  });
});

// ===========================================================================
// §19.12 Provider-Name Irrelevance
// ===========================================================================

describe('Provider Name Irrelevance', () => {
  it('state machine only uses generic step types, no provider names', () => {
    expect(EngineeringStepType.PLAN).toBe('PLAN');
    expect(ReviewVerdict.A).toBe('A');
    expect(AgentExecutionStatus.RUNNING).toBe('RUNNING');
  });
});
