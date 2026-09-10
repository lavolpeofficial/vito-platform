import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { OutcomeRepository, RecordOutcomeInput } from './outcome-evaluation.types';
import { OutcomeEvaluationService } from './outcome-evaluation.service';

const input: RecordOutcomeInput = {
  experienceId: '22222222-2222-4222-8222-222222222222',
  metricCode: 'duplicate_work_reduction',
  expectedValue: { maxDuplicates: 0 },
  observedValue: { duplicates: 0 },
  evidence: { source: 'workflow-run', workflowRunId: 'run-1' },
  score: 1,
  confidence: 0.95,
  evaluatorType: 'SYSTEM',
};

function tenant(organizationId: string): TenantContext {
  const context = new TenantContext();
  context.set({ organizationId, userId: null, role: null, authenticationMethod: 'insecure-header' });
  return context;
}

function repository(overrides: Partial<OutcomeRepository> = {}): jest.Mocked<OutcomeRepository> {
  return {
    experienceExists: jest.fn().mockResolvedValue(true),
    create: jest.fn().mockImplementation(async (organizationId, value) => ({
      id: '33333333-3333-4333-8333-333333333333',
      organizationId,
      experienceId: value.experienceId,
      metricCode: value.metricCode,
      expectedValue: value.expectedValue ?? null,
      observedValue: value.observedValue,
      evidence: value.evidence,
      score: value.score,
      confidence: value.confidence ?? null,
      evaluatorType: value.evaluatorType ?? 'SYSTEM',
      evaluatorId: value.evaluatorId ?? null,
      evaluatedAt: new Date('2026-09-10T19:00:00Z'),
      createdAt: new Date('2026-09-10T19:00:00Z'),
    })),
    listForExperience: jest.fn().mockResolvedValue([]),
    markExperienceEvaluated: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<OutcomeRepository>;
}

describe('OutcomeEvaluationService', () => {
  it('records objective outcome inside current tenant, marks experience evaluated and audits', async () => {
    const repo = repository();
    const audit = { record: jest.fn().mockResolvedValue({}) } as unknown as jest.Mocked<AuditService>;
    const service = new OutcomeEvaluationService(tenant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), audit, repo);

    const outcome = await service.record(input);

    expect(repo.experienceExists).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', input.experienceId);
    expect(repo.create).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', input);
    expect(repo.markExperienceEvaluated).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', input.experienceId);
    expect(outcome.score).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      action: 'LEARNING_OUTCOME_RECORDED',
      entityType: 'ExperienceOutcome',
      entityId: outcome.id,
    }));
  });

  it('fails closed when experience belongs to another tenant', async () => {
    const repo = repository({ experienceExists: jest.fn().mockResolvedValue(false) });
    const audit = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const service = new OutcomeEvaluationService(tenant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), audit, repo);

    await expect(service.record(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.markExperienceEvaluated).not.toHaveBeenCalled();
  });

  it('requires objective evidence and bounded score/confidence', async () => {
    const repo = repository();
    const audit = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const service = new OutcomeEvaluationService(tenant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), audit, repo);

    await expect(service.record({ ...input, evidence: {} })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.record({ ...input, score: 1.1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.record({ ...input, confidence: -0.1 })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('scopes outcome retrieval to the current tenant', async () => {
    const repo = repository();
    const audit = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const service = new OutcomeEvaluationService(tenant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), audit, repo);

    await service.listForExperience(input.experienceId);

    expect(repo.experienceExists).toHaveBeenCalledWith('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', input.experienceId);
    expect(repo.listForExperience).toHaveBeenCalledWith('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', input.experienceId);
  });
});
