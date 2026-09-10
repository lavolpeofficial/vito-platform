import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { ExperienceStoreService } from './experience-store.service';
import { OutcomeEvaluationService } from './outcome-evaluation.service';
import { ReflectionService } from './reflection.service';
import { FailurePatternRepository, RecordFailurePatternInput } from './failure-pattern.types';
import { FailurePatternService } from './failure-pattern.service';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const experienceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reflectionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const negativeOutcomeId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function tenant(): TenantContext {
  const context = new TenantContext();
  context.set({ organizationId, userId: null, role: null, authenticationMethod: 'insecure-header' });
  return context;
}

const input: RecordFailurePatternInput = {
  experienceId,
  reflectionId,
  outcomeIds: [negativeOutcomeId],
  signature: 'duplicate-work-after-stale-reuse',
  rootCause: 'A prior result was reused without checking current applicability.',
  prevention: 'Validate applicability before reusing a prior governed result.',
  applicability: { workflow: 'research' },
  severity: 0.8,
  confidence: 0.9,
};

function build(options: { status?: string; outcomes?: readonly any[]; reflections?: readonly any[] } = {}) {
  const experiences = {
    get: jest.fn().mockResolvedValue({ id: experienceId, status: options.status ?? 'REFLECTED' }),
  } as unknown as jest.Mocked<ExperienceStoreService>;
  const outcomes = {
    listForExperience: jest.fn().mockResolvedValue(options.outcomes ?? [{ id: negativeOutcomeId, score: -1 }]),
  } as unknown as jest.Mocked<OutcomeEvaluationService>;
  const reflections = {
    listForExperience: jest.fn().mockResolvedValue(options.reflections ?? [{ id: reflectionId }]),
  } as unknown as jest.Mocked<ReflectionService>;
  const repository: jest.Mocked<FailurePatternRepository> = {
    create: jest.fn().mockImplementation(async (orgId, value) => ({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      organizationId: orgId,
      experienceId: value.experienceId,
      reflectionId: value.reflectionId,
      outcomeIds: value.outcomeIds,
      signature: value.signature,
      rootCause: value.rootCause,
      prevention: value.prevention,
      applicability: value.applicability ?? {},
      severity: value.severity,
      confidence: value.confidence ?? null,
      status: 'ACTIVE',
      createdAt: new Date('2026-09-10T20:45:00Z'),
      updatedAt: new Date('2026-09-10T20:45:00Z'),
    })),
    getById: jest.fn().mockResolvedValue(null),
    search: jest.fn().mockResolvedValue([]),
  };
  const audit = { record: jest.fn().mockResolvedValue({}) } as unknown as jest.Mocked<AuditService>;
  return {
    service: new FailurePatternService(tenant(), audit, experiences, outcomes, reflections, repository),
    repository,
    audit,
  };
}

describe('FailurePatternService', () => {
  it('records a tenant-scoped failure pattern only when grounded in a negative outcome', async () => {
    const { service, repository, audit } = build();
    const result = await service.record(input);
    expect(result.organizationId).toBe(organizationId);
    expect(repository.create).toHaveBeenCalledWith(organizationId, input);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'LEARNING_FAILURE_PATTERN_RECORDED' }));
  });

  it('refuses failure patterns before reflection', async () => {
    const { service, repository } = build({ status: 'EVALUATED' });
    await expect(service.record(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('refuses unrelated outcome and reflection references', async () => {
    const unrelatedReflection = build({ reflections: [] });
    await expect(unrelatedReflection.service.record(input)).rejects.toBeInstanceOf(BadRequestException);

    const unrelatedOutcome = build({ outcomes: [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', score: -1 }] });
    await expect(unrelatedOutcome.service.record(input)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a failure pattern without an objectively negative outcome', async () => {
    const { service } = build({ outcomes: [{ id: negativeOutcomeId, score: 0.5 }] });
    await expect(service.record(input)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates severity and confidence bounds', async () => {
    const { service } = build();
    await expect(service.record({ ...input, severity: 1.1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.record({ ...input, confidence: -0.1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails closed on cross-tenant lookup and keeps search tenant-scoped', async () => {
    const { service, repository } = build();
    await expect(service.get('ffffffff-ffff-4fff-8fff-ffffffffffff')).rejects.toBeInstanceOf(NotFoundException);
    await service.search({ signature: 'duplicate', status: 'ACTIVE', limit: 5 });
    expect(repository.search).toHaveBeenCalledWith(organizationId, { signature: 'duplicate', status: 'ACTIVE', limit: 5 });
  });
});
