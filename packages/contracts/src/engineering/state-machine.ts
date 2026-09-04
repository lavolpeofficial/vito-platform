/**
 * Deterministische, pure Engineering-Workflow-State-Machine.
 *
 * Keine NestJS-Abhängigkeit. Keine Prisma-Abhängigkeit. Keine LLM-Abhängigkeit.
 * Keine Provider-Abhängigkeit. Provider-Name ist für die State Machine irrelevant.
 *
 * VITO IST der Orchestrator. Es gibt keinen separaten Engineering-Orchestrator.
 */

import { EngineeringStepType } from './workflow.js';
import { ReviewVerdict, resolveReviewerDisagreement, type ReviewResult } from './review.js';
import { AgentExecutionStatus } from './execution.js';
import { DEFAULT_RETRY_POLICY, type RetryPolicy, type IndependenceContext, type AssuranceUnsatisfiedReason } from './execution.js';
import type { AssuranceLevel } from './assurance.js';

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

export interface StateMachineInput {
  /** Aktueller Step-Typ der gerade abgeschlossen wurde */
  readonly completedStep: EngineeringStepType;
  /** Status des abgeschlossenen Steps */
  readonly stepStatus: 'SUCCEEDED' | 'FAILED';
  /** Review-Verdict (nur bei PARSE_VERDICT relevant, single-reviewer shortcut) */
  readonly verdict?: ReviewVerdict;
  /** Review-Ergebnisse aller Reviewer (bei PARSE_VERDICT, multi-reviewer) */
  readonly reviewResults?: readonly ReviewResult[];
  /** Provider-Status (für QUOTA_BLOCKED / POLICY_BLOCKED Erkennung) */
  readonly providerStatus?: AgentExecutionStatus;
  /** Anzahl bisheriger Correction Loops */
  readonly correctionLoopCount: number;
  /** Maximale Correction Loops (Default: 3) */
  readonly retryPolicy: RetryPolicy;
  /** Human Approval liegt vor (nur für HUMAN_RELEASE_GATE → RELEASE_EXECUTION) */
  readonly humanApproved?: boolean;
  /** Independence Context für AL4 Prüfung */
  readonly independenceContext?: IndependenceContext;
  /** Gewünschte Assurance Level */
  readonly assuranceLevel?: AssuranceLevel;
}

export type TransitionOutcome =
  | { readonly kind: 'NEXT_STEP'; readonly nextStep: EngineeringStepType }
  | { readonly kind: 'BLOCKED'; readonly reason: BlockReason }
  | { readonly kind: 'COMPLETED' }
  | { readonly kind: 'FAILED'; readonly reason: string };

export type BlockReason =
  | { readonly type: 'LOOP_EXHAUSTED'; readonly correctionLoopCount: number }
  | { readonly type: 'REVIEW_DISAGREEMENT'; readonly verdicts: readonly ReviewVerdict[] }
  | { readonly type: 'HUMAN_DECISION_REQUIRED'; readonly verdict: ReviewVerdict }
  | { readonly type: 'ASSURANCE_UNSATISFIED'; readonly reason: AssuranceUnsatisfiedReason }
  | { readonly type: 'HUMAN_APPROVAL_MISSING' }
  | { readonly type: 'PROVIDER_BLOCKED'; readonly providerStatus: AgentExecutionStatus };

// ---------------------------------------------------------------------------
// Internal: AL4 Enforcement + Disagreement Detection
// ---------------------------------------------------------------------------

/**
 * Resolviert den effektiven Verdict aus reviewResults (multi-reviewer)
 * oder dem einzelnen verdict (single-reviewer shortcut).
 *
 * Für AL4 wird Disagreement erkannt und als BlockReason zurückgegeben.
 * Für nicht-AL4 wird bei Disagreement fail-closed (REVIEW_DISAGREEMENT).
 */
function resolveVerdict(
  input: StateMachineInput,
): { verdict: ReviewVerdict } | { blocked: BlockReason } {
  // Multi-reviewer Pfad
  if (input.reviewResults && input.reviewResults.length > 0) {
    const resolution = resolveReviewerDisagreement(input.reviewResults);

    if (resolution.hasDisagreement) {
      return {
        blocked: {
          type: 'REVIEW_DISAGREEMENT',
          verdicts: resolution.verdicts,
        },
      };
    }

    return { verdict: resolution.mergedVerdict };
  }

  // Single-reviewer shortcut
  if (input.verdict !== undefined) {
    return { verdict: input.verdict };
  }

  // Kein Verdict → Fehler
  return {
    blocked: {
      type: 'REVIEW_DISAGREEMENT',
      verdicts: [],
    },
  };
}

/**
 * Prüft AL4 Assurance-Anforderungen vor PARSE_VERDICT → VERIFY.
 *
 * AL4 erfordert TATSÄCHLICHE Review-Evidence, nicht nur Metadata:
 *   - reviewResults muss vorhanden sein mit mind. 2 Einträgen
 *   - Single-verdict shortcut befriedigt AL4 NICHT
 *   - reviewerExecutionId Werte müssen distinct sein
 *   - previousReviewerProviderIds muss mind. 2 distinct Werte enthalten
 *   - Builder-Modellfamilie muss bekannt sein (fail closed)
 *   - Reviewer-1 Modellfamilie ≠ Builder-Modellfamilie
 *   - Reviewer-2 Modellfamilie ≠ Reviewer-1 Modellfamilie
 *   - Kein Reviewer-Disagreement
 *
 * @returns null wenn erfüllt, sonst BlockReason
 */
function enforceAl4Requirements(
  input: StateMachineInput,
): BlockReason | null {
  if (input.assuranceLevel !== 'AL4') {
    return null;
  }

  // ── 1. Actual review evidence required ──────────────────────────────
  if (!input.reviewResults || input.reviewResults.length < 2) {
    return { type: 'ASSURANCE_UNSATISFIED', reason: 'REVIEW_EVIDENCE_INSUFFICIENT' };
  }

  // ── 2. Distinct reviewerExecutionId values ─────────────────────────
  const executionIds = input.reviewResults.map((r) => r.reviewerExecutionId);
  const distinctExecutionIds = new Set(executionIds);
  if (distinctExecutionIds.size < executionIds.length) {
    return { type: 'ASSURANCE_UNSATISFIED', reason: 'REVIEWER_EXECUTION_NOT_DISTINCT' };
  }

  // ── 3. Independence context required ───────────────────────────────
  const ctx = input.independenceContext;
  if (!ctx) {
    return { type: 'ASSURANCE_UNSATISFIED', reason: 'MIN_REVIEWER_COUNT_UNSATISFIED' };
  }

  // ── 4. Metadata: at least 2 distinct reviewer provider IDs ─────────
  const distinctProviderIds = new Set(ctx.previousReviewerProviderIds);
  if (distinctProviderIds.size < 2) {
    return { type: 'ASSURANCE_UNSATISFIED', reason: 'REVIEWER_PROVIDER_NOT_DISTINCT' };
  }

  // ── 5. Metadata: at least 2 model family entries ───────────────────
  if (ctx.previousReviewerModelFamilies.length < 2) {
    return { type: 'ASSURANCE_UNSATISFIED', reason: 'MODEL_FAMILY_REQUIREMENT_UNSATISFIED' };
  }

  // ── 6. Builder model family known (fail closed) ────────────────────
  if (!ctx.builderModelFamily || ctx.builderModelFamily.trim() === '') {
    return { type: 'ASSURANCE_UNSATISFIED', reason: 'BUILDER_MODEL_FAMILY_UNKNOWN' };
  }

  // ── 7. Reviewer independence: reviewer families ≠ builder family ───
  const reviewer1Family = ctx.previousReviewerModelFamilies[0];
  if (reviewer1Family === ctx.builderModelFamily) {
    return { type: 'ASSURANCE_UNSATISFIED', reason: 'REVIEWER_INDEPENDENCE_UNSATISFIED' };
  }

  // ── 8. Reviewer families must differ from each other ───────────────
  const reviewer2Family = ctx.previousReviewerModelFamilies[1];
  if (reviewer1Family && reviewer2Family && reviewer1Family === reviewer2Family) {
    return { type: 'ASSURANCE_UNSATISFIED', reason: 'MODEL_FAMILY_REQUIREMENT_UNSATISFIED' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Transition-Funktion (pure, deterministisch)
// ---------------------------------------------------------------------------

/**
 * Berechnet den nächsten Workflow-Schritt basierend auf dem aktuellen Zustand.
 *
 * Regeln:
 *   PLAN   success → BUILD
 *   BUILD  success → TEST
 *   TEST   success → PACKAGE
 *   TEST   failure → CORRECTION (bei fachlichen Findings)
 *   PACKAGE success → RED_TEAM
 *   RED_TEAM success → PARSE_VERDICT
 *   PARSE_VERDICT → Reviewer Disagreement? → BLOCKED
 *   PARSE_VERDICT → AL4 enforcement? → BLOCKED
 *   PARSE_VERDICT → je nach Verdict: A/B → VERIFY, C → CORRECTION, D → HUMAN
 *   VERIFY → HUMAN_RELEASE_GATE
 *   HUMAN_RELEASE_GATE → RELEASE_EXECUTION (nur bei approved)
 *   RELEASE_EXECUTION success → REMOTE_VERIFY
 *   REMOTE_VERIFY success → COMPLETED
 *
 *   QUOTA_BLOCKED / POLICY_BLOCKED zählen NICHT als Correction Loop.
 */
export function nextEngineeringStep(input: StateMachineInput): TransitionOutcome {
  const { completedStep, stepStatus, providerStatus, correctionLoopCount, retryPolicy, humanApproved } = input;

  // Provider-Blocking erkannt → kein Workflow-Fehler, sondern BLOCKED mit Provider-Status
  if (providerStatus === AgentExecutionStatus.QUOTA_BLOCKED ||
      providerStatus === AgentExecutionStatus.POLICY_BLOCKED) {
    return { kind: 'BLOCKED', reason: { type: 'PROVIDER_BLOCKED', providerStatus } };
  }

  // --- PLAN ---
  if (completedStep === EngineeringStepType.PLAN) {
    if (stepStatus === 'SUCCEEDED') {
      return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.BUILD };
    }
    return { kind: 'FAILED', reason: 'PLAN step failed' };
  }

  // --- BUILD ---
  if (completedStep === EngineeringStepType.BUILD) {
    if (stepStatus === 'SUCCEEDED') {
      return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.TEST };
    }
    return { kind: 'FAILED', reason: 'BUILD step failed' };
  }

  // --- TEST ---
  if (completedStep === EngineeringStepType.TEST) {
    if (stepStatus === 'SUCCEEDED') {
      return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.PACKAGE };
    }
    // TEST failure → CORRECTION (if loop not exhausted)
    if (correctionLoopCount >= retryPolicy.maxCorrectionLoops) {
      return {
        kind: 'BLOCKED',
        reason: { type: 'LOOP_EXHAUSTED', correctionLoopCount },
      };
    }
    return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.CORRECTION };
  }

  // --- PACKAGE ---
  if (completedStep === EngineeringStepType.PACKAGE) {
    if (stepStatus === 'SUCCEEDED') {
      return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.RED_TEAM };
    }
    return { kind: 'FAILED', reason: 'PACKAGE step failed' };
  }

  // --- RED_TEAM ---
  if (completedStep === EngineeringStepType.RED_TEAM) {
    if (stepStatus === 'SUCCEEDED') {
      return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.PARSE_VERDICT };
    }
    return { kind: 'FAILED', reason: 'RED_TEAM step failed' };
  }

  // --- PARSE_VERDICT ---
  if (completedStep === EngineeringStepType.PARSE_VERDICT) {
    if (stepStatus !== 'SUCCEEDED') {
      return { kind: 'FAILED', reason: 'PARSE_VERDICT requires succeeded status' };
    }

    // Verdict auflösen (multi-reviewer oder single-reviewer)
    const resolution = resolveVerdict(input);
    if ('blocked' in resolution) {
      return { kind: 'BLOCKED', reason: resolution.blocked };
    }
    const verdict = resolution.verdict;

    // AL4 Enforcement: PRÜFUNG VOR Verdict-Logik
    if (input.assuranceLevel === 'AL4') {
      const al4Block = enforceAl4Requirements(input);
      if (al4Block) {
        return { kind: 'BLOCKED', reason: al4Block };
      }
    }

    if (verdict === ReviewVerdict.A || verdict === ReviewVerdict.B) {
      return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.VERIFY };
    }

    if (verdict === ReviewVerdict.C) {
      // Correction Loop prüfen
      if (correctionLoopCount >= retryPolicy.maxCorrectionLoops) {
        return {
          kind: 'BLOCKED',
          reason: { type: 'LOOP_EXHAUSTED', correctionLoopCount },
        };
      }
      return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.CORRECTION };
    }

    if (verdict === ReviewVerdict.D) {
      return {
        kind: 'BLOCKED',
        reason: { type: 'HUMAN_DECISION_REQUIRED', verdict },
      };
    }
  }

  // --- CORRECTION ---
  if (completedStep === EngineeringStepType.CORRECTION) {
    if (stepStatus === 'SUCCEEDED') {
      // Correction Loop zurück zu TEST
      return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.TEST };
    }
    return { kind: 'FAILED', reason: 'CORRECTION step failed' };
  }

  // --- VERIFY ---
  if (completedStep === EngineeringStepType.VERIFY) {
    if (stepStatus === 'SUCCEEDED') {
      return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.HUMAN_RELEASE_GATE };
    }
    return { kind: 'FAILED', reason: 'VERIFY step failed' };
  }

  // --- HUMAN_RELEASE_GATE ---
  if (completedStep === EngineeringStepType.HUMAN_RELEASE_GATE) {
    if (humanApproved === true) {
      return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.RELEASE_EXECUTION };
    }
    return {
      kind: 'BLOCKED',
      reason: { type: 'HUMAN_APPROVAL_MISSING' },
    };
  }

  // --- RELEASE_EXECUTION ---
  if (completedStep === EngineeringStepType.RELEASE_EXECUTION) {
    if (stepStatus === 'SUCCEEDED') {
      return { kind: 'NEXT_STEP', nextStep: EngineeringStepType.REMOTE_VERIFY };
    }
    return { kind: 'FAILED', reason: 'RELEASE_EXECUTION step failed' };
  }

  // --- REMOTE_VERIFY ---
  if (completedStep === EngineeringStepType.REMOTE_VERIFY) {
    if (stepStatus === 'SUCCEEDED') {
      return { kind: 'COMPLETED' };
    }
    return { kind: 'FAILED', reason: 'REMOTE_VERIFY step failed' };
  }

  return { kind: 'FAILED', reason: `Unknown step type: ${completedStep}` };
}

// ---------------------------------------------------------------------------
// AL4 Independence Check (pure, standalone helper)
// ---------------------------------------------------------------------------

/**
 * Prüft ob die AL4 Unabhängigkeitsanforderungen erfüllt sind.
 *
 * AL4 erfordert:
 *   - Builder-Modellfamilie muss bekannt sein (fail closed)
 *   - Reviewer 1 model family != Builder model family
 *   - Reviewer 2 model family != Reviewer 1 model family
 *   - Mindestens 2 unabhängige Reviewer
 *
 * @returns null wenn erfüllt, sonst den Grund der Nichterfüllung
 */
export function checkAl4Independence(
  context: IndependenceContext,
  reviewerCount: number,
): AssuranceUnsatisfiedReason | null {
  if (reviewerCount < 2) {
    return 'MIN_REVIEWER_COUNT_UNSATISFIED';
  }

  if (context.previousReviewerModelFamilies.length < 2) {
    return 'MODEL_FAMILY_REQUIREMENT_UNSATISFIED';
  }

  // Builder-Modellfamilie muss bekannt sein (fail closed)
  if (!context.builderModelFamily || context.builderModelFamily.trim() === '') {
    return 'BUILDER_MODEL_FAMILY_UNKNOWN';
  }

  const reviewer1Family = context.previousReviewerModelFamilies[0];
  if (reviewer1Family === context.builderModelFamily) {
    return 'REVIEWER_INDEPENDENCE_UNSATISFIED';
  }

  const reviewer2Family = context.previousReviewerModelFamilies[1];
  if (reviewer1Family && reviewer2Family && reviewer1Family === reviewer2Family) {
    return 'MODEL_FAMILY_REQUIREMENT_UNSATISFIED';
  }

  return null;
}
