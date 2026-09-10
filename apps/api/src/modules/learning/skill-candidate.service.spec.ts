import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';
import { LearningMaturityService } from './learning-maturity.service';
import { LearningCandidateRecord } from './learning-maturity.types';
import { SkillCandidateService } from './skill-candidate.service';
import { RecordSkillCandidateInput, SkillCandidateRepository } from './skill-candidate.types';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const learningCandidateId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const experienceId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const outcomeIds = [
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
];

function tenant(jwt = true): TenantContext {
  const context = new TenantContext();
  context.set({
    organizationId,
    userId: jwt ? userId : null,
    role: null,
    authenticationMethod: jwt ? 'jwt' : 'insecure-header',
  });
  return context;
}

function learningCandidate(
  maturity: LearningCandidateRecord['maturity'] = 'PATTERN',
  confidence: number | null = 0.85,
): LearningCandidateRecord {
  return {
    id: learningCandidateId,
    organizationId,
    experienceId,
    reflectionId: '11111111-1111-4111-8111-111111111111',
    statement: 'Reuse this governed research procedure.',
    applicability: { workflow: 'research' },
    maturity,
    confidence,
    status: 'ACTIVE',
    createdAt: new Date('2026-09-10T20:20:00Z'),
    updatedAt: new Date('2026-09-10T20:20:00Z'),
  };
}

const input: RecordSkillCandidateInput = {
  learningCandidateId,
  code: 'research.reuse',
  name: 'Governed research reuse',
  description: 'Reusable evidence-backed research procedure.',
  procedure: { steps: ['retrieve prior evidence', 'validate applicability', 'execute governed path'] },
  applicability: { workflow: 'research' },
  supportingOutcomeIds: outcomeIds,
  confidence: 0.85,
  approvalRef: 'approval-2026-09-10-01',
};

function build(options: { jwt?: boolean; maturity?: LearningCandidateRecord['maturity']; confidence?: number | null; outcomesValid?: boolean } = {}) {
  const maturity = {
    get: jest.fn().mockResolvedValue(learningCandidate(options.maturity ?? 'PATTERN', options.confidence === undefined ? 0.85 : options.confidence)),
  } as unknown as jest.Mocked<LearningMaturityService>;
  const repository: jest.Mocked<SkillCandidateRepository> = {
    outcomesBelongToExperience: jest.fn().mockResolvedValue(options.outcomesValid ?? true),
    create: jest.fn().mockImplementation(async (orgId, approvedByUserId, candidateInput) => ({
      id: '22222222-2222-4222-8222-222222222222',
      organizationId: orgId,
      learningCandidateId: candidateInput.learningCandidateId,
      code: candidateInput.code,
      name: candidateInput.name,
      description: candidateInput.description,
      procedure: candidateInput.procedure,
      applicability: candidateInput.applicability ?? {},
      supportingOutcomeIds: candidateInput.supportingOutcomeIds,
      confidence: candidateInput.confidence,
      approvalRef: candidateInput.approvalRef,
      approvedByUserId,
      status: 'RECORDED',
      createdAt: new Date('2026-09-10T20:21:00Z'),
      updatedAt: new Date('2026-09-10T20:21:00Z'),
    })),
    getById: jest.fn().mockResolvedValue(null),
    search: jest.fn().mockResolvedValue([]),
  };
  const audit = { record: jest.fn().mockResolvedValue({}) } as unknown as jest.Mocked<AuditService>;
  return { service: new SkillCandidateService(tenant(options.jwt ?? true), audit, maturity, repository), repository, audit };
}

describe('SkillCandidateService', () => {
  it('records only a governed, mature, evidence-backed skill candidate', async () => {
    const { service, repository, audit } = build();
    const result = await service.record(input);
    expect(result.status).toBe('RECORDED');
    expect(repository.outcomesBelongToExperience).toHaveBeenCalledWith(
      organizationId,
      experienceId,
      outcomeIds,
    );
    expect(repository.create).toHaveBeenCalledWith(organizationId, userId, expect.objectContaining({ approvalRef: input.approvalRef }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LEARNING_SKILL_CANDIDATE_RECORDED',
      actorType: 'USER',
      actorId: userId,
      metadata: expect.objectContaining({ sourceExperienceId: experienceId }),
    }));
  });

  it('requires authenticated human governance approval', async () => {
    const { service, repository } = build({ jwt: false });
    await expect(service.record(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('refuses immature or low-confidence learning evidence', async () => {
    await expect(build({ maturity: 'HYPOTHESIS' }).service.record(input)).rejects.toBeInstanceOf(BadRequestException);
    await expect(build({ confidence: 0.69 }).service.record(input)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires at least two distinct objective outcomes from the source experience', async () => {
    await expect(build().service.record({ ...input, supportingOutcomeIds: [outcomeIds[0], outcomeIds[0]] }))
      .rejects.toBeInstanceOf(BadRequestException);
    const { service, repository } = build({ outcomesValid: false });
    await expect(service.record(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.outcomesBelongToExperience).toHaveBeenCalledWith(
      organizationId,
      experienceId,
      outcomeIds,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('does not expose another tenant skill candidate', async () => {
    const { service, repository } = build();
    repository.getById.mockResolvedValueOnce(null);
    await expect(service.get('33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.getById).toHaveBeenCalledWith(organizationId, '33333333-3333-4333-8333-333333333333');
  });
});
