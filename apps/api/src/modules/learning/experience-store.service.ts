import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import {
  EXPERIENCE_REPOSITORY,
  ExperienceRecord,
  ExperienceRepository,
  ExperienceSearchQuery,
  RecordExperienceInput,
} from './experience-store.types';

@Injectable()
export class ExperienceStoreService {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    @Inject(EXPERIENCE_REPOSITORY)
    private readonly repository: ExperienceRepository,
  ) {}

  async record(input: RecordExperienceInput): Promise<ExperienceRecord> {
    const organizationId = this.tenantContext.getOrThrow();
    validateInput(input);

    const agentBelongsToTenant = await this.repository.agentBelongsToOrganization(
      organizationId,
      input.agentId,
    );
    if (!agentBelongsToTenant) {
      throw new NotFoundException('Digital employee not found in the current organization.');
    }

    const experience = await this.repository.create(organizationId, input);
    await this.audit.record({
      organizationId,
      actorType: 'DIGITAL_EMPLOYEE',
      actorId: input.agentId,
      action: 'LEARNING_EXPERIENCE_RECORDED',
      entityType: 'Experience',
      entityId: experience.id,
      metadata: {
        status: experience.status,
        successScore: experience.successScore,
        confidence: experience.confidence,
      },
    });
    return experience;
  }

  async get(experienceId: string): Promise<ExperienceRecord> {
    const organizationId = this.tenantContext.getOrThrow();
    const experience = await this.repository.getById(organizationId, experienceId);
    if (!experience) throw new NotFoundException('Experience not found.');
    return experience;
  }

  search(query: ExperienceSearchQuery = {}): Promise<readonly ExperienceRecord[]> {
    const organizationId = this.tenantContext.getOrThrow();
    return this.repository.search(organizationId, query);
  }
}

function validateInput(input: RecordExperienceInput): void {
  if (!input.agentId?.trim()) throw new BadRequestException('agentId is required.');
  if (!input.goal?.trim()) throw new BadRequestException('goal is required.');
  if (input.successScore != null && (input.successScore < -1 || input.successScore > 1)) {
    throw new BadRequestException('successScore must be between -1 and 1.');
  }
  if (input.confidence != null && (input.confidence < 0 || input.confidence > 1)) {
    throw new BadRequestException('confidence must be between 0 and 1.');
  }
}
