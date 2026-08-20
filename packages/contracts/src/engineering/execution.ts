/**
 * Provider-Execution-Contracts für den Engineering Runtime.
 *
 * Providerfehler dürfen nicht automatisch Workflowfehler bedeuten.
 * z.B. "Claude quota exceeded" → QUOTA_BLOCKED (nicht FAILED).
 */

/** Ausführungsstatus einer einzelnen Provider-Ausführung */
export enum AgentExecutionStatus {
  QUEUED = 'QUEUED',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  TIMED_OUT = 'TIMED_OUT',
  CANCELLED = 'CANCELLED',
  POLICY_BLOCKED = 'POLICY_BLOCKED',
  QUOTA_BLOCKED = 'QUOTA_BLOCKED',
}

/** Retry-Policy: Provider Retry und Correction Loop sind getrennt */
export interface RetryPolicy {
  /** Maximale Anzahl an Correction Loops */
  readonly maxCorrectionLoops: number;
  /** Maximale Provider-Retry-Versuche pro Step */
  readonly maxProviderRetriesPerStep: number;
}

/** Default für VITO-EO-01 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxCorrectionLoops: 3,
  maxProviderRetriesPerStep: 2,
} as const;

/** Execution Budget (Contract, noch keine Cost Engine) */
export interface ExecutionBudget {
  readonly maxDurationMs?: number;
  readonly maxTokens?: number;
  readonly maxCostMinorUnits?: number;
  readonly currency?: string;
}

/** Unabhängigkeits-Kontext für AL4 */
export interface IndependenceContext {
  readonly builderProviderId?: string;
  readonly builderModelFamily?: string;
  readonly previousReviewerProviderIds: readonly string[];
  readonly previousReviewerModelFamilies: readonly string[];
}

/** Reason-Code wenn Assurance-Anforderungen nicht erfüllt werden können */
export type AssuranceUnsatisfiedReason =
  | 'REVIEWER_INDEPENDENCE_UNSATISFIED'
  | 'MODEL_FAMILY_REQUIREMENT_UNSATISFIED'
  | 'MIN_REVIEWER_COUNT_UNSATISFIED'
  | 'HUMAN_GATE_REQUIREMENT_UNSATISFIED'
  | 'BUILDER_MODEL_FAMILY_UNKNOWN'
  | 'REVIEW_EVIDENCE_INSUFFICIENT'
  | 'REVIEWER_EXECUTION_NOT_DISTINCT'
  | 'REVIEWER_PROVIDER_NOT_DISTINCT';
