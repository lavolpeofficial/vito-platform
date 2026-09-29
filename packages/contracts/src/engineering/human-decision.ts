import { ReviewVerdict } from './review.js';
import type { RetryPolicy } from './execution.js';
import type { BlockReason, TransitionOutcome } from './state-machine.js';
import { EngineeringStepType } from './workflow.js';

export interface HumanDecisionInput {
  readonly blockReason: BlockReason;
  readonly decision: 'CORRECTION';
  readonly correctionLoopCount: number;
  readonly retryPolicy: RetryPolicy;
}

/**
 * Resolves an explicit authenticated human decision after a fail-closed block.
 * Pure contract logic: authorization, audit and persistence remain runtime concerns.
 */
export function nextEngineeringHumanDecision(input: HumanDecisionInput): TransitionOutcome {
  if (
    input.blockReason.type !== 'HUMAN_DECISION_REQUIRED' ||
    input.blockReason.verdict !== ReviewVerdict.D
  ) {
    return { kind: 'BLOCKED', reason: input.blockReason };
  }

  if (input.correctionLoopCount >= input.retryPolicy.maxCorrectionLoops) {
    return {
      kind: 'BLOCKED',
      reason: { type: 'LOOP_EXHAUSTED', correctionLoopCount: input.correctionLoopCount },
    };
  }

  return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.CORRECTION };
}
