export type SkillCandidateStatus = 'RECORDED' | 'REJECTED' | 'RETIRED';

export interface SkillCandidateRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly learningCandidateId: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly procedure: Readonly<Record<string, unknown>>;
  readonly applicability: Readonly<Record<string, unknown>>;
  readonly supportingOutcomeIds: readonly string[];
  readonly confidence: number;
  readonly approvalRef: string;
  readonly approvedByUserId: string;
  readonly status: SkillCandidateStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RecordSkillCandidateInput {
  readonly learningCandidateId: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly procedure: Readonly<Record<string, unknown>>;
  readonly applicability?: Readonly<Record<string, unknown>>;
  readonly supportingOutcomeIds: readonly string[];
  readonly confidence: number;
  readonly approvalRef: string;
}

export interface SkillCandidateRepository {
  outcomesBelongToExperience(
    organizationId: string,
    experienceId: string,
    outcomeIds: readonly string[],
  ): Promise<boolean>;
  create(
    organizationId: string,
    approvedByUserId: string,
    input: RecordSkillCandidateInput,
  ): Promise<SkillCandidateRecord>;
  getById(organizationId: string, skillCandidateId: string): Promise<SkillCandidateRecord | null>;
  search(
    organizationId: string,
    query?: { code?: string; status?: SkillCandidateStatus; limit?: number },
  ): Promise<readonly SkillCandidateRecord[]>;
}

export const SKILL_CANDIDATE_REPOSITORY = Symbol('SKILL_CANDIDATE_REPOSITORY');
