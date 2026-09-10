import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { ExperienceRepository, RecordExperienceInput } from './experience-store.types';
import { ExperienceStoreService } from './experience-store.service';

const input: RecordExperienceInput = {
  agentId: '11111111-1111-4111-8111-111111111111',
  goal: 'Reduce duplicate work in the next governed execution.',
  context: { workflow: 'test' },
  observation: { duplicateDetected: true },
  decision: { strategy: 'reuse-known-result' },
  action: { type: 'RETRIEVE' },
  result: { reused: true },
  successScore: 1,
  confidence: 0.9,
};

function tenant(organizationId: string): TenantContext {
  const context = new TenantContext();
  context.set({ organizationId, userId: null, role: null, authenticationMethod: 'insecure-header' });
  return context;
}

function repository(overrides: Partial<ExperienceRepository> = {}): jest.Mocked<ExperienceRepository> {
  return {
    agentBelongsToOrganization: jest.fn().mockResolvedValue(true),
    create: jest.fn().mockImplementation(async (organizationId, value) => ({
      id: '22222222-2222-4222-8222-222222222222',
      organizationId,
      agentId: value.agentId,
      goal: value.goal,
      context: value.context,
      observation: value.observation,
      decision: value.decision,
      action: value.action,
      result: value.result,
      successScore: value.successScore ?? null,
      confidence: value.confidence ?? null,
      feedback: value.feedback ?? null,
      lesson: value.lesson ?? null,
      reusablePattern: value.reusablePattern ?? null,
      status: 'OBSERVED' as const,
      createdAt: new Date('2026-09-10T18:30:00Z'),
      updatedAt: new Date('2026-09-10T18:30:00Z'),
    })),
    getById: jest.fn().mockResolvedValue(null),
    search: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as jest.Mocked<ExperienceRepository>;
}

describe('ExperienceStoreService', () => {
  it('records an experience only inside the authenticated organization and audits it', async () => {
    const repo = repository();
    const audit = { record: jest.fn().mockResolvedValue({}) } as unknown as jest.Mocked<AuditService>;
    const service = new ExperienceStoreService(tenant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), audit, repo);

    const result = await service.record(input);

    expect(result.organizationId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(result.status).toBe('OBSERVED');
    expect(repo.agentBelongsToOrganization).toHaveBeenCalledWith(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      input.agentId,
    );
    expect(repo.create).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', input);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      action: 'LEARNING_EXPERIENCE_RECORDED',
      entityType: 'Experience',
      entityId: result.id,
    }));
  });

  it('refuses an agent that belongs to a different organization', async () => {
    const repo = repository({ agentBelongsToOrganization: jest.fn().mockResolvedValue(false) });
    const audit = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const service = new ExperienceStoreService(tenant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), audit, repo);

    await expect(service.record(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('scopes reads and searches to the current organization', async () => {
    const repo = repository();
    const audit = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const service = new ExperienceStoreService(tenant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), audit, repo);

    await service.search({ agentId: input.agentId, limit: 5 });
    await expect(service.get('33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(NotFoundException);

    expect(repo.search).toHaveBeenCalledWith('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      agentId: input.agentId,
      limit: 5,
    });
    expect(repo.getById).toHaveBeenCalledWith(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '33333333-3333-4333-8333-333333333333',
    );
  });

  it('rejects invalid learning scores before persistence', async () => {
    const repo = repository();
    const audit = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;
    const service = new ExperienceStoreService(tenant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), audit, repo);

    await expect(service.record({ ...input, successScore: 1.5 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.record({ ...input, confidence: -0.1 })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
