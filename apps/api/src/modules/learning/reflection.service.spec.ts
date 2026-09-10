import { BadRequestException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { ExperienceStoreService } from './experience-store.service';
import { OutcomeEvaluationService } from './outcome-evaluation.service';
import { ReflectionRepository, RecordReflectionInput } from './reflection.types';
import { ReflectionService } from './reflection.service';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const experienceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const outcomeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function tenant(): TenantContext {
  const context = new TenantContext();
  context.set({ organizationId, userId: null, role: null, authenticationMethod: 'insecure-header' });
  return context;
}

const input: RecordReflectionInput = {
  experienceId,
  lesson: 'Reusing the governed result reduced duplicate work without reducing evidence quality.',
  whatWorked: ['Retrieved a prior governed result.'],
  whatFailed: [],
  assumptions: ['Prior result was still applicable.'],
  nextActionHint: 'Check applicability before reuse.',
  evidenceOutcomeIds: [outcomeId],
  confidence: 0.9,
};

function build(overrides: { status?: string; outcomes?: readonly any[] } = {}) {
  const experiences = {
    get: jest.fn().mockResolvedValue({ id: experienceId, status: overrides.status ?? 'EVALUATED' }),
  } as unknown as jest.Mocked<ExperienceStoreService>;
  const outcomes = {
    listForExperience: jest.fn().mockResolvedValue(overrides.outcomes ?? [{ id: outcomeId }]),
  } as unknown as jest.Mocked<OutcomeEvaluationService>;
  const repository: jest.Mocked<ReflectionRepository> = {
    create: jest.fn().mockImplementation(async (orgId, value) => ({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      organizationId: orgId,
      experienceId: value.experienceId,
      lesson: value.lesson,
      whatWorked: value.whatWorked ?? [],
      whatFailed: value.whatFailed ?? [],
      assumptions: value.assumptions ?? [],
      nextActionHint: value.nextActionHint ?? null,
      evidenceOutcomeIds: value.evidenceOutcomeIds,
      confidence: value.confidence ?? null,
      reflectorType: value.reflectorType ?? 'SYSTEM',
      reflectorId: value.reflectorId ?? null,
      createdAt: new Date('2026-09-10T19:25:00Z'),
    })),
    listForExperience: jest.fn().mockResolvedValue([]),
    markExperienceReflected: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue({}) } as unknown as jest.Mocked<AuditService>;
  return {
    service: new ReflectionService(tenant(), audit, experiences, outcomes, repository),
    experiences,
    outcomes,
    repository,
    audit,
  };
}

describe('ReflectionService', () => {
  it('records an audited reflection grounded in persisted outcome evidence', async () => {
    const { service, repository, audit } = build();
    const result = await service.record(input);

    expect(result.organizationId).toBe(organizationId);
    expect(repository.create).toHaveBeenCalledWith(organizationId, input);
    expect(repository.markExperienceReflected).toHaveBeenCalledWith(organizationId, experienceId);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      action: 'LEARNING_REFLECTION_RECORDED',
      entityType: 'ExperienceReflection',
      entityId: result.id,
    }));
  });

  it('refuses reflection before objective evaluation', async () => {
    const { service, repository } = build({ status: 'OBSERVED' });
    await expect(service.record(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('refuses reflection without persisted outcomes', async () => {
    const { service, repository } = build({ outcomes: [] });
    await expect(service.record(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('refuses evidence references that are not outcomes of the experience', async () => {
    const { service, repository } = build();
    await expect(service.record({ ...input, evidenceOutcomeIds: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'] }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('deduplicates evidence references and validates confidence', async () => {
    const { service, repository } = build();
    await service.record({ ...input, evidenceOutcomeIds: [outcomeId, outcomeId] });
    expect(repository.create).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ evidenceOutcomeIds: [outcomeId] }),
    );

    await expect(service.record({ ...input, confidence: 1.1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scopes reflection retrieval to the current organization', async () => {
    const { service, repository, experiences } = build();
    await service.listForExperience(experienceId);
    expect(experiences.get).toHaveBeenCalledWith(experienceId);
    expect(repository.listForExperience).toHaveBeenCalledWith(organizationId, experienceId);
  });
});
