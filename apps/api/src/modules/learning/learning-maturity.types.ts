export type LearningMaturity = 'OBSERVATION' | 'HYPOTHESIS' | 'PATTERN' | 'POLICY';
export type LearningCandidateStatus = 'ACTIVE' | 'REJECTED' | 'RETIRED';
export type PromotionActorType = 'SYSTEM' | 'USER' | 'EXTERNAL';

export interface LearningCandidateRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly experienceId: string;
  readonly reflectionId: string;
  readonly statement: string;
  readonly applicability: Readonly<Record<string, unknown>>;
  readonly maturity: LearningMaturity;
  readonly confidence: number | null;
  readonly status: LearningCandidateStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateLearningCandidateInput {
  readonly experienceId: string;
  readonly reflectionId: string;
  readonly statement: string;
  readonly applicability?: Readonly<Record<string, unknown>>;
  readonly confidence?: number | null;
}

export interface PromotionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly candidateId: string;
  readonly fromMaturity: LearningMaturity;
  readonly toMaturity: LearningMaturity;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly reason: string;
  readonly actorType: PromotionActorType;
  readonly actorId: string | null;
  readonly approvalRef: string | null;
  readonly createdAt: Date;
}

export interface PromoteLearningCandidateInput {
  readonly candidateId: string;
  readonly toMaturity: LearningMaturity;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly reason: string;
  readonly actorType?: PromotionActorType;
  readonly actorId?: string | null;
  readonly approvalRef?: string | null;
}

export interface LearningMaturityRepository {
  createCandidate(organizationId: string, input: CreateLearningCandidateInput): Promise<LearningCandidateRecord>;
  getCandidate(organizationId: string, candidateId: string): Promise<LearningCandidateRecord | null>;
  createPromotion(
    organizationId: string,
    candidate: LearningCandidateRecord,
    input: PromoteLearningCandidateInput,
  ): Promise<PromotionRecord>;
  setMaturity(
    organizationId: string,
    candidateId: string,
    fromMaturity: LearningMaturity,
    toMaturity: LearningMaturity,
  ): Promise<boolean>;
  listPromotions(organizationId: string, candidateId: string): Promise<readonly PromotionRecord[]>;
}

export const LEARNING_MATURITY_REPOSITORY = Symbol('LEARNING_MATURITY_REPOSITORY');
