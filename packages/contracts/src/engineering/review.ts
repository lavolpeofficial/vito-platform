/**
 * Review-Typen für den Engineering Runtime.
 *
 * Review-Ergebnisse sind frameworkunabhängig und description
 * für jeden Reviewer (menschlich oder automatisiert).
 */
import type { AssuranceLevel } from './assurance.js';

/** Verbindliche Review-Verdicts mit klarer Transition-Semantik */
export enum ReviewVerdict {
  /** PASS */
  A = 'A',
  /** PASS_WITH_NON_BLOCKING_FINDINGS */
  B = 'B',
  /** CORRECTION_REQUIRED */
  C = 'C',
  /** HUMAN_DECISION_REQUIRED */
  D = 'D',
}

/** Schweregrad eines Review-Findings */
export type ReviewFindingSeverity =
  | 'INFO'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

/** Kategorie eines Review-Findings */
export type ReviewFindingCategory =
  | 'CORRECTNESS'
  | 'SECURITY'
  | 'ARCHITECTURE'
  | 'TESTING'
  | 'MAINTAINABILITY'
  | 'GOVERNANCE'
  | 'OTHER';

/** Einzelnes Review-Finding */
export interface ReviewFinding {
  readonly id: string;
  readonly severity: ReviewFindingSeverity;
  readonly category: ReviewFindingCategory;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly blocking: boolean;
}

/** Ergebnis eines einzelnen Review-Durchlaufs */
export interface ReviewResult {
  readonly verdict: ReviewVerdict;
  readonly findings: readonly ReviewFinding[];
  readonly reviewerExecutionId: string;
  readonly assuranceLevel: AssuranceLevel;
  readonly artifactRefs: readonly string[];
}

/** Akzeptable Verdicts die zu VERIFY führen können */
type AcceptableVerdict = ReviewVerdict.A | ReviewVerdict.B;

/**
 * Prüft ob ein Verdict als "akzeptabel" gilt (führt zu VERIFY).
 */
function isAcceptableVerdict(v: ReviewVerdict): v is AcceptableVerdict {
  return v === ReviewVerdict.A || v === ReviewVerdict.B;
}

/**
 * Ergebnis der Disagreement-Erkennung.
 */
export type DisagreementResolution =
  | { readonly hasDisagreement: false; readonly mergedVerdict: ReviewVerdict }
  | { readonly hasDisagreement: true; readonly verdicts: readonly ReviewVerdict[] };

/**
 * Deterministische Erkennung von Reviewer-Disagreement.
 *
 * Regeln:
 * - Alle Verdicts identisch → kein Disagreement
 * - Vermixt akzeptabel/nicht-akzeptabel → Disagreement
 * - Keine Mehrheitsentscheidung. Kein Durchschnitt. Kein automatisches Downgrade.
 * - Fail closed.
 */
export function resolveReviewerDisagreement(
  reviewResults: readonly ReviewResult[],
): DisagreementResolution {
  if (reviewResults.length === 0) {
    return { hasDisagreement: true, verdicts: [] };
  }

  const verdicts = reviewResults.map((r) => r.verdict);
  const first = verdicts[0];

  // Alle identisch → kein Disagreement
  const allSame = verdicts.every((v) => v === first);
  if (allSame) {
    return { hasDisagreement: false, mergedVerdict: first };
  }

  // Nicht identisch → Disagreement
  return { hasDisagreement: true, verdicts };
}
