import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  EXPERIENCE_REPOSITORY,
  ExperienceRecord,
  ExperienceRepository,
  RecordExperienceInput,
} from './experience-store.types';

export interface RuntimeExperienceCaptureInput extends RecordExperienceInput {
  readonly organizationId: string;
  readonly source: 'AGENT_WORKFORCE';
}

@Injectable()
export class RuntimeExperienceCaptureService {
  constructor(
    private readonly audit: AuditService,
    @Inject(EXPERIENCE_REPOSITORY)
    private readonly repository: ExperienceRepository,
  ) {}

  async record(input: RuntimeExperienceCaptureInput): Promise<ExperienceRecord> {
    validateRuntimeInput(input);

    const agentBelongsToTenant = await this.repository.agentBelongsToOrganization(
      input.organizationId,
      input.agentId,
    );
    if (!agentBelongsToTenant) {
      throw new NotFoundException('Digital employee not found in the runtime organization.');
    }

    const experience = await this.repository.create(input.organizationId, {
      agentId: input.agentId,
      goal: input.goal,
      context: input.context,
      observation: input.observation,
      decision: input.decision,
      action: input.action,
      result: input.result,
      successScore: input.successScore ?? null,
      confidence: input.confidence ?? null,
      feedback: input.feedback ?? null,
      lesson: input.lesson ?? null,
      reusablePattern: input.reusablePattern ?? null,
    });

    await this.audit.record({
      organizationId: input.organizationId,
      actorType: 'DIGITAL_EMPLOYEE',
      actorId: input.agentId,
      action: 'LEARNING_EXPERIENCE_RECORDED',
      entityType: 'Experience',
      entityId: experience.id,
      metadata: {
        source: input.source,
        status: experience.status,
        successScore: experience.successScore,
        confidence: experience.confidence,
      },
    });

    return experience;
  }
}

function validateRuntimeInput(input: RuntimeExperienceCaptureInput): void {
  if (!input.organizationId?.trim()) throw new BadRequestException('organizationId is required.');
  if (!input.agentId?.trim()) throw new BadRequestException('agentId is required.');
  if (!input.goal?.trim()) throw new BadRequestException('goal is required.');
  if (input.successScore != null && (input.successScore < -1 || input.successScore > 1)) {
    throw new BadRequestException('successScore must be between -1 and 1.');
  }
  if (input.confidence != null && (input.confidence < 0 || input.confidence > 1)) {
    throw new BadRequestException('confidence must be between 0 and 1.');
  }
}
