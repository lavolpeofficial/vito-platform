export type FailurePatternStatus = 'ACTIVE' | 'RESOLVED' | 'ARCHIVED';

export interface FailurePatternRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly experienceId: string;
  readonly reflectionId: string;
  readonly outcomeIds: readonly string[];
  readonly signature: string;
  readonly rootCause: string;
  readonly prevention: string;
  readonly applicability: Readonly<Record<string, unknown>>;
  readonly severity: number;
  readonly confidence: number | null;
  readonly status: FailurePatternStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RecordFailurePatternInput {
  readonly experienceId: string;
  readonly reflectionId: string;
  readonly outcomeIds: readonly string[];
  readonly signature: string;
  readonly rootCause: string;
  readonly prevention: string;
  readonly applicability?: Readonly<Record<string, unknown>>;
  readonly severity: number;
  readonly confidence?: number | null;
}

export interface FailurePatternRepository {
  create(organizationId: string, input: RecordFailurePatternInput): Promise<FailurePatternRecord>;
  getById(organizationId: string, failurePatternId: string): Promise<FailurePatternRecord | null>;
  search(
    organizationId: string,
    query: { signature?: string; status?: FailurePatternStatus; limit?: number },
  ): Promise<readonly FailurePatternRecord[]>;
}

export const FAILURE_PATTERN_REPOSITORY = Symbol('FAILURE_PATTERN_REPOSITORY');
