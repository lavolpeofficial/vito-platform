import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import {
  OUTCOME_REPOSITORY,
  OutcomeRecord,
  OutcomeRepository,
  RecordOutcomeInput,
} from './outcome-evaluation.types';

@Injectable()
export class OutcomeEvaluationService {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    @Inject(OUTCOME_REPOSITORY)
    private readonly repository: OutcomeRepository,
  ) {}

  async record(input: RecordOutcomeInput): Promise<OutcomeRecord> {
    const organizationId = this.tenantContext.getOrThrow();
    validateInput(input);

    if (!(await this.repository.experienceExists(organizationId, input.experienceId))) {
      throw new NotFoundException('Experience not found in the current organization.');
    }

    const outcome = await this.repository.create(organizationId, input);
    await this.repository.markExperienceEvaluated(organizationId, input.experienceId);

    await this.audit.record({
      organizationId,
      actorType: 'SYSTEM',
      actorId: input.evaluatorId ?? null,
      action: 'LEARNING_OUTCOME_RECORDED',
      entityType: 'ExperienceOutcome',
      entityId: outcome.id,
      metadata: {
        experienceId: outcome.experienceId,
        metricCode: outcome.metricCode,
        score: outcome.score,
        confidence: outcome.confidence,
        evaluatorType: outcome.evaluatorType,
      },
    });

    return outcome;
  }

  async listForExperience(experienceId: string): Promise<readonly OutcomeRecord[]> {
    const organizationId = this.tenantContext.getOrThrow();
    if (!(await this.repository.experienceExists(organizationId, experienceId))) {
      throw new NotFoundException('Experience not found in the current organization.');
    }
    return this.repository.listForExperience(organizationId, experienceId);
  }
}

function validateInput(input: RecordOutcomeInput): void {
  if (!input.experienceId?.trim()) throw new BadRequestException('experienceId is required.');
  if (!input.metricCode?.trim()) throw new BadRequestException('metricCode is required.');
  if (input.observedValue === undefined) throw new BadRequestException('observedValue is required.');
  if (!input.evidence || Object.keys(input.evidence).length === 0) {
    throw new BadRequestException('objective evidence is required.');
  }
  if (input.score < -1 || input.score > 1) {
    throw new BadRequestException('score must be between -1 and 1.');
  }
  if (input.confidence != null && (input.confidence < 0 || input.confidence > 1)) {
    throw new BadRequestException('confidence must be between 0 and 1.');
  }
}
