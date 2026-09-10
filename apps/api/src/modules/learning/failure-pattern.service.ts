import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { ExperienceStoreService } from './experience-store.service';
import { OutcomeEvaluationService } from './outcome-evaluation.service';
import { ReflectionService } from './reflection.service';
import {
  FAILURE_PATTERN_REPOSITORY,
  FailurePatternRecord,
  FailurePatternRepository,
  FailurePatternStatus,
  RecordFailurePatternInput,
} from './failure-pattern.types';

@Injectable()
export class FailurePatternService {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly experiences: ExperienceStoreService,
    private readonly outcomes: OutcomeEvaluationService,
    private readonly reflections: ReflectionService,
    @Inject(FAILURE_PATTERN_REPOSITORY)
    private readonly repository: FailurePatternRepository,
  ) {}

  async record(input: RecordFailurePatternInput): Promise<FailurePatternRecord> {
    const organizationId = this.tenantContext.getOrThrow();
    validateInput(input);

    const experience = await this.experiences.get(input.experienceId);
    if (experience.status !== 'REFLECTED' && experience.status !== 'LEARNING_CANDIDATE') {
      throw new BadRequestException('failure pattern requires a reflected experience.');
    }

    const reflections = await this.reflections.listForExperience(input.experienceId);
    if (!reflections.some((reflection) => reflection.id === input.reflectionId)) {
      throw new BadRequestException('reflection must belong to the referenced experience.');
    }

    const persistedOutcomes = await this.outcomes.listForExperience(input.experienceId);
    const selectedIds = [...new Set(input.outcomeIds)];
    const selected = persistedOutcomes.filter((outcome) => selectedIds.includes(outcome.id));
    if (selected.length !== selectedIds.length) {
      throw new BadRequestException('failure outcomes must belong to the referenced experience.');
    }
    if (!selected.some((outcome) => outcome.score < 0)) {
      throw new BadRequestException('failure pattern requires at least one objectively negative outcome.');
    }

    const pattern = await this.repository.create(organizationId, { ...input, outcomeIds: selectedIds });
    await this.audit.record({
      organizationId,
      actorType: 'SYSTEM',
      actorId: null,
      action: 'LEARNING_FAILURE_PATTERN_RECORDED',
      entityType: 'FailurePattern',
      entityId: pattern.id,
      metadata: {
        experienceId: pattern.experienceId,
        outcomeIds: pattern.outcomeIds,
        severity: pattern.severity,
        confidence: pattern.confidence,
      },
    });
    return pattern;
  }

  async get(failurePatternId: string): Promise<FailurePatternRecord> {
    const organizationId = this.tenantContext.getOrThrow();
    const pattern = await this.repository.getById(organizationId, failurePatternId);
    if (!pattern) throw new NotFoundException('Failure pattern not found.');
    return pattern;
  }

  search(query: { signature?: string; status?: FailurePatternStatus; limit?: number } = {}) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.repository.search(organizationId, query);
  }
}

function validateInput(input: RecordFailurePatternInput): void {
  if (!input.experienceId?.trim()) throw new BadRequestException('experienceId is required.');
  if (!input.reflectionId?.trim()) throw new BadRequestException('reflectionId is required.');
  if (!Array.isArray(input.outcomeIds) || input.outcomeIds.length === 0) {
    throw new BadRequestException('at least one outcomeId is required.');
  }
  if (!input.signature?.trim()) throw new BadRequestException('signature is required.');
  if (!input.rootCause?.trim()) throw new BadRequestException('rootCause is required.');
  if (!input.prevention?.trim()) throw new BadRequestException('prevention is required.');
  if (input.severity < 0 || input.severity > 1) throw new BadRequestException('severity must be between 0 and 1.');
  if (input.confidence != null && (input.confidence < 0 || input.confidence > 1)) {
    throw new BadRequestException('confidence must be between 0 and 1.');
  }
}
