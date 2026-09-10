import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { ExperienceStoreService } from './experience-store.service';
import { ReflectionService } from './reflection.service';
import {
  LearningCandidateRecord,
  LearningMaturityRepository,
  PromoteLearningCandidateInput,
} from './learning-maturity.types';
import { LearningMaturityService } from './learning-maturity.service';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const experienceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reflectionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const candidateId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function tenant(jwt = false): TenantContext {
  const context = new TenantContext();
  context.set({
    organizationId,
    userId: jwt ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' : null,
    role: null,
    authenticationMethod: jwt ? 'jwt' : 'insecure-header',
  });
  return context;
}

function candidate(maturity: LearningCandidateRecord['maturity'] = 'OBSERVATION'): LearningCandidateRecord {
  return {
    id: candidateId,
    organizationId,
    experienceId,
    reflectionId,
    statement: 'Reuse governed results when applicability remains valid.',
    applicability: { workflow: 'research' },
    maturity,
    confidence: 0.8,
    status: 'ACTIVE',
    createdAt: new Date('2026-09-10T20:10:00Z'),
    updatedAt: new Date('2026-09-10T20:10:00Z'),
  };
}

function build(options: { jwt?: boolean; maturity?: LearningCandidateRecord['maturity']; reflected?: boolean; changed?: boolean } = {}) {
  const experiences = {
    get: jest.fn().mockResolvedValue({ id: experienceId, status: options.reflected === false ? 'EVALUATED' : 'REFLECTED' }),
  } as unknown as jest.Mocked<ExperienceStoreService>;
  const reflections = {
    listForExperience: jest.fn().mockResolvedValue([{ id: reflectionId }]),
  } as unknown as jest.Mocked<ReflectionService>;
  const repository: jest.Mocked<LearningMaturityRepository> = {
    createCandidate: jest.fn().mockResolvedValue(candidate()),
    getCandidate: jest.fn().mockResolvedValue(candidate(options.maturity ?? 'OBSERVATION')),
    createPromotion: jest.fn().mockImplementation(async (orgId, current, input) => ({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      organizationId: orgId,
      candidateId: current.id,
      fromMaturity: current.maturity,
      toMaturity: input.toMaturity,
      evidence: input.evidence,
      reason: input.reason,
      actorType: input.actorType ?? 'SYSTEM',
      actorId: input.actorId ?? null,
      approvalRef: input.approvalRef ?? null,
      createdAt: new Date('2026-09-10T20:11:00Z'),
    })),
    setMaturity: jest.fn().mockResolvedValue(options.changed ?? true),
    listPromotions: jest.fn().mockResolvedValue([]),
  };
  const audit = { record: jest.fn().mockResolvedValue({}) } as unknown as jest.Mocked<AuditService>;
  return {
    service: new LearningMaturityService(tenant(options.jwt), audit, experiences, reflections, repository),
    repository,
    audit,
  };
}

const promotion: PromoteLearningCandidateInput = {
  candidateId,
  toMaturity: 'HYPOTHESIS',
  evidence: { repeatCount: 2 },
  reason: 'Observed twice with the same positive outcome.',
};

describe('LearningMaturityService', () => {
  it('creates an OBSERVATION only from a reflected experience and matching reflection', async () => {
    const { service, repository, audit } = build();
    const result = await service.createCandidate({
      experienceId,
      reflectionId,
      statement: 'Reuse governed results when applicability remains valid.',
      confidence: 0.8,
    });
    expect(result.maturity).toBe('OBSERVATION');
    expect(repository.createCandidate).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'LEARNING_CANDIDATE_CREATED' }));
  });

  it('refuses candidate creation before reflection', async () => {
    const { service, repository } = build({ reflected: false });
    await expect(service.createCandidate({ experienceId, reflectionId, statement: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createCandidate).not.toHaveBeenCalled();
  });

  it('allows exactly one forward or backward maturity step', async () => {
    const { service, repository } = build({ maturity: 'HYPOTHESIS' });
    await service.promote({ ...promotion, toMaturity: 'PATTERN' });
    expect(repository.setMaturity).toHaveBeenCalledWith(organizationId, candidateId, 'HYPOTHESIS', 'PATTERN');

    await expect(service.promote({ ...promotion, toMaturity: 'POLICY' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires authenticated human approval for POLICY promotion', async () => {
    const unauthenticated = build({ maturity: 'PATTERN' });
    await expect(unauthenticated.service.promote({ ...promotion, toMaturity: 'POLICY', approvalRef: 'approval-1' }))
      .rejects.toBeInstanceOf(BadRequestException);

    const authenticated = build({ jwt: true, maturity: 'PATTERN' });
    await authenticated.service.promote({ ...promotion, toMaturity: 'POLICY', approvalRef: 'approval-1' });
    expect(authenticated.repository.setMaturity).toHaveBeenCalled();
  });

  it('requires evidence and detects concurrent maturity changes', async () => {
    const { service } = build({ changed: false });
    await expect(service.promote({ ...promotion, evidence: {} })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.promote(promotion)).rejects.toBeInstanceOf(ConflictException);
  });

  it('fails closed when a candidate is outside the current organization', async () => {
    const { service, repository } = build();
    repository.getCandidate.mockResolvedValueOnce(null);
    await expect(service.promote(promotion)).rejects.toBeInstanceOf(NotFoundException);
  });
});
