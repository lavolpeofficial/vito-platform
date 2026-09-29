import { DEFAULT_RETRY_POLICY } from './execution.js';
import { ReviewVerdict } from './review.js';
import { nextEngineeringHumanDecision } from './human-decision.js';
import { EngineeringStepType } from './workflow.js';

describe('nextEngineeringHumanDecision', () => {
  it('routes explicit correction after verdict D to CORRECTION while budget remains', () => {
    expect(nextEngineeringHumanDecision({
      blockReason: { type: 'HUMAN_DECISION_REQUIRED', verdict: ReviewVerdict.D },
      decision: 'CORRECTION',
      correctionLoopCount: 0,
      retryPolicy: DEFAULT_RETRY_POLICY,
    })).toEqual({ kind: 'NEXT_STEP', nextStep: EngineeringStepType.CORRECTION });
  });

  it('fails closed when the correction-loop budget is exhausted', () => {
    expect(nextEngineeringHumanDecision({
      blockReason: { type: 'HUMAN_DECISION_REQUIRED', verdict: ReviewVerdict.D },
      decision: 'CORRECTION',
      correctionLoopCount: DEFAULT_RETRY_POLICY.maxCorrectionLoops,
      retryPolicy: DEFAULT_RETRY_POLICY,
    })).toEqual({
      kind: 'BLOCKED',
      reason: {
        type: 'LOOP_EXHAUSTED',
        correctionLoopCount: DEFAULT_RETRY_POLICY.maxCorrectionLoops,
      },
    });
  });

  it('does not reinterpret another block reason as a correction decision', () => {
    const reason = { type: 'HUMAN_APPROVAL_MISSING' } as const;
    expect(nextEngineeringHumanDecision({
      blockReason: reason,
      decision: 'CORRECTION',
      correctionLoopCount: 0,
      retryPolicy: DEFAULT_RETRY_POLICY,
    })).toEqual({ kind: 'BLOCKED', reason });
  });
});
