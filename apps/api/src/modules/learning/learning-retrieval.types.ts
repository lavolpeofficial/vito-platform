export type RetrievedLearningKind = 'EXPERIENCE' | 'LEARNING_CANDIDATE' | 'FAILURE_PATTERN';

export interface RetrievedLearningItem {
  readonly kind: RetrievedLearningKind;
  readonly sourceId: string;
  readonly title: string;
  readonly detail: string;
  readonly maturity: string | null;
  readonly confidence: number | null;
  readonly createdAt: Date;
}

export interface LearningRetrievalQuery {
  readonly query: string;
  readonly agentId?: string;
  readonly limit?: number;
}

export interface LearningRetrievalRepository {
  retrieve(
    organizationId: string,
    query: LearningRetrievalQuery,
  ): Promise<readonly RetrievedLearningItem[]>;
}

export const LEARNING_RETRIEVAL_REPOSITORY = Symbol('LEARNING_RETRIEVAL_REPOSITORY');
