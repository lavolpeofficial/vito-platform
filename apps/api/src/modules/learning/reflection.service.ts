import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { ExperienceStoreService } from './experience-store.service';
import { OutcomeEvaluationService } from './outcome-evaluation.service';
import {
  REFLECTION_REPOSITORY,
  RecordReflectionInput,
  ReflectionRecord,
  ReflectionRepository,
} from './reflection.types';

@Injectable()
export class ReflectionService {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly experiences: ExperienceStoreService,
    private readonly outcomes: OutcomeEvaluationService,
    @Inject(REFLECTION_REPOSITORY)
    private readonly repository: ReflectionRepository,
  ) {}

  async record(input: RecordReflectionInput): Promise<ReflectionRecord> {
    const organizationId = this.tenantContext.getOrThrow();
    validateInput(input);

    const experience = await this.experiences.get(input.experienceId);
    if (experience.status !== 'EVALUATED' && experience.status !== 'REFLECTED') {
      throw new BadRequestException('experience must be objectively evaluated before reflection.');
    }

    const persistedOutcomes = await this.outcomes.listForExperience(input.experienceId);
    if (persistedOutcomes.length === 0) {
      throw new BadRequestException('at least one persisted outcome is required before reflection.');
    }

    const persistedIds = new Set(persistedOutcomes.map((outcome) => outcome.id));
    const evidenceIds = [...new Set(input.evidenceOutcomeIds)];
    if (evidenceIds.some((id) => !persistedIds.has(id))) {
      throw new BadRequestException('reflection evidence must reference persisted outcomes from this experience.');
    }

    const reflection = await this.repository.create(organizationId, {
      ...input,
      evidenceOutcomeIds: evidenceIds,
    });
    await this.repository.markExperienceReflected(organizationId, input.experienceId);

    await this.audit.record({
      organizationId,
      actorType: 'SYSTEM',
      actorId: input.reflectorId ?? null,
      action: 'LEARNING_REFLECTION_RECORDED',
      entityType: 'ExperienceReflection',
      entityId: reflection.id,
      metadata: {
        experienceId: reflection.experienceId,
        evidenceOutcomeIds: reflection.evidenceOutcomeIds,
        confidence: reflection.confidence,
        reflectorType: reflection.reflectorType,
      },
    });

    return reflection;
  }

  async listForExperience(experienceId: string): Promise<readonly ReflectionRecord[]> {
    const organizationId = this.tenantContext.getOrThrow();
    await this.experiences.get(experienceId);
    return this.repository.listForExperience(organizationId, experienceId);
  }
}

function validateInput(input: RecordReflectionInput): void {
  if (!input.experienceId?.trim()) throw new BadRequestException('experienceId is required.');
  if (!input.lesson?.trim()) throw new BadRequestException('lesson is required.');
  if (!Array.isArray(input.evidenceOutcomeIds) || input.evidenceOutcomeIds.length === 0) {
    throw new BadRequestException('at least one outcome evidence reference is required.');
  }
  if (input.evidenceOutcomeIds.some((id) => !id?.trim())) {
    throw new BadRequestException('outcome evidence references must be non-empty.');
  }
  if (input.confidence != null && (input.confidence < 0 || input.confidence > 1)) {
    throw new BadRequestException('confidence must be between 0 and 1.');
  }
}
