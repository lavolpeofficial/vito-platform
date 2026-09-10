export type OutcomeEvaluatorType = 'SYSTEM' | 'USER' | 'EXTERNAL';

export interface OutcomeRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly experienceId: string;
  readonly metricCode: string;
  readonly expectedValue: unknown | null;
  readonly observedValue: unknown;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly score: number;
  readonly confidence: number | null;
  readonly evaluatorType: OutcomeEvaluatorType;
  readonly evaluatorId: string | null;
  readonly evaluatedAt: Date;
  readonly createdAt: Date;
}

export interface RecordOutcomeInput {
  readonly experienceId: string;
  readonly metricCode: string;
  readonly expectedValue?: unknown | null;
  readonly observedValue: unknown;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly score: number;
  readonly confidence?: number | null;
  readonly evaluatorType?: OutcomeEvaluatorType;
  readonly evaluatorId?: string | null;
}

export interface OutcomeRepository {
  experienceExists(organizationId: string, experienceId: string): Promise<boolean>;
  create(organizationId: string, input: RecordOutcomeInput): Promise<OutcomeRecord>;
  listForExperience(organizationId: string, experienceId: string): Promise<readonly OutcomeRecord[]>;
  markExperienceEvaluated(organizationId: string, experienceId: string): Promise<void>;
}

export const OUTCOME_REPOSITORY = Symbol('OUTCOME_REPOSITORY');
