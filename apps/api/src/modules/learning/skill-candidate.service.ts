import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { LearningMaturityService } from './learning-maturity.service';
import {
  RecordSkillCandidateInput,
  SKILL_CANDIDATE_REPOSITORY,
  SkillCandidateRecord,
  SkillCandidateRepository,
  SkillCandidateStatus,
} from './skill-candidate.types';

export const MIN_SKILL_CANDIDATE_CONFIDENCE = 0.7;

@Injectable()
export class SkillCandidateService {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly maturity: LearningMaturityService,
    @Inject(SKILL_CANDIDATE_REPOSITORY)
    private readonly repository: SkillCandidateRepository,
  ) {}

  async record(input: RecordSkillCandidateInput): Promise<SkillCandidateRecord> {
    const organizationId = this.tenantContext.getOrThrow();
    validateInput(input);

    const userId = this.tenantContext.getUserId();
    if (this.tenantContext.getAuthenticationMethod() !== 'jwt' || !userId) {
      throw new BadRequestException('Skill candidate recording requires authenticated human governance approval.');
    }

    const candidate = await this.maturity.get(input.learningCandidateId);
    if (candidate.status !== 'ACTIVE') {
      throw new BadRequestException('Skill candidate requires an active learning candidate.');
    }
    if (candidate.maturity !== 'PATTERN' && candidate.maturity !== 'POLICY') {
      throw new BadRequestException('Skill candidate requires PATTERN or POLICY maturity.');
    }
    if (candidate.confidence == null || candidate.confidence < MIN_SKILL_CANDIDATE_CONFIDENCE) {
      throw new BadRequestException('Learning candidate confidence is below the skill-candidate threshold.');
    }

    const outcomeIds = [...new Set(input.supportingOutcomeIds)];
    if (outcomeIds.length < 2) {
      throw new BadRequestException('Skill candidate requires at least two distinct objective outcomes.');
    }
    if (!(await this.repository.outcomesBelongToExperience(organizationId, candidate.experienceId, outcomeIds))) {
      throw new BadRequestException(
        'All supporting outcomes must belong to the source learning candidate experience.',
      );
    }

    const skill = await this.repository.create(organizationId, userId, {
      ...input,
      code: input.code.trim(),
      name: input.name.trim(),
      description: input.description.trim(),
      approvalRef: input.approvalRef.trim(),
      supportingOutcomeIds: outcomeIds,
    });

    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: 'LEARNING_SKILL_CANDIDATE_RECORDED',
      entityType: 'SkillCandidate',
      entityId: skill.id,
      metadata: {
        learningCandidateId: skill.learningCandidateId,
        sourceExperienceId: candidate.experienceId,
        supportingOutcomeIds: skill.supportingOutcomeIds,
        confidence: skill.confidence,
        approvalRef: skill.approvalRef,
        executable: false,
      },
    });

    return skill;
  }

  async get(skillCandidateId: string): Promise<SkillCandidateRecord> {
    const organizationId = this.tenantContext.getOrThrow();
    const skill = await this.repository.getById(organizationId, skillCandidateId);
    if (!skill) throw new NotFoundException('Skill candidate not found.');
    return skill;
  }

  search(query: { code?: string; status?: SkillCandidateStatus; limit?: number } = {}) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.repository.search(organizationId, query);
  }
}

function validateInput(input: RecordSkillCandidateInput): void {
  if (!input.learningCandidateId?.trim()) throw new BadRequestException('learningCandidateId is required.');
  if (!input.code?.trim()) throw new BadRequestException('code is required.');
  if (!input.name?.trim()) throw new BadRequestException('name is required.');
  if (!input.description?.trim()) throw new BadRequestException('description is required.');
  if (!input.procedure || Object.keys(input.procedure).length === 0) {
    throw new BadRequestException('procedure is required.');
  }
  if (!Array.isArray(input.supportingOutcomeIds)) {
    throw new BadRequestException('supportingOutcomeIds must be an array.');
  }
  if (input.confidence < MIN_SKILL_CANDIDATE_CONFIDENCE || input.confidence > 1) {
    throw new BadRequestException(
      `confidence must be between ${MIN_SKILL_CANDIDATE_CONFIDENCE} and 1.`,
    );
  }
  if (!input.approvalRef?.trim()) throw new BadRequestException('approvalRef is required.');
}
