import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SkillPromotionService } from './skill-promotion.service';

describe('SkillPromotionService', () => {
  const tenantContext = {
    getOrThrow: jest.fn(() => 'org-1'),
    getUserId: jest.fn(() => 'user-1'),
    getAuthenticationMethod: jest.fn(() => 'jwt'),
  };
  const queryRaw = jest.fn();
  const auditRecord = jest.fn().mockResolvedValue(undefined);
  const candidateGet = jest.fn();

  const candidate = {
    id: 'skill-1',
    organizationId: 'org-1',
    learningCandidateId: 'learning-1',
    code: 'SAFE_DEPLOY',
    name: 'Safe deploy',
    description: 'Deploy safely.',
    procedure: { steps: ['verify'] },
    applicability: {},
    supportingOutcomeIds: ['outcome-1', 'outcome-2'],
    confidence: 0.92,
    approvalRef: 'approval-1',
    approvedByUserId: 'user-0',
    status: 'RECORDED',
    createdAt: new Date('2026-09-12T00:00:00Z'),
    updatedAt: new Date('2026-09-12T00:00:00Z'),
  } as const;

  beforeEach(() => {
    jest.clearAllMocks();
    tenantContext.getOrThrow.mockReturnValue('org-1');
    tenantContext.getUserId.mockReturnValue('user-1');
    tenantContext.getAuthenticationMethod.mockReturnValue('jwt');
    candidateGet.mockResolvedValue(candidate);
  });

  function service() {
    return new SkillPromotionService(
      tenantContext as any,
      { $queryRaw: queryRaw } as any,
      { record: auditRecord } as any,
      { get: candidateGet } as any,
    );
  }

  it('creates only a pending non-executable review from a RECORDED candidate', async () => {
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'review-1',
        organization_id: 'org-1',
        skill_candidate_id: 'skill-1',
        target_capability_code: 'CODE_DEPLOY_SAFE',
        evidence_snapshot: {
          learningCandidateId: 'learning-1',
          supportingOutcomeIds: ['outcome-1', 'outcome-2'],
          confidence: 0.92,
        },
        status: 'PENDING_REVIEW',
        requested_by_user_id: 'user-1',
        reviewed_by_user_id: null,
        review_rationale: null,
        created_at: new Date(),
        reviewed_at: null,
        updated_at: new Date(),
      }]);

    const review = await service().propose('skill-1', 'code_deploy_safe');

    expect(candidateGet).toHaveBeenCalledWith('skill-1');
    expect(review.status).toBe('PENDING_REVIEW');
    expect(review.targetCapabilityCode).toBe('CODE_DEPLOY_SAFE');
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SKILL_PROMOTION_REVIEW_PROPOSED',
      metadata: expect.objectContaining({ executionAuthorityGranted: false }),
    }));
  });

  it('rejects non-RECORDED skill candidates', async () => {
    candidateGet.mockResolvedValueOnce({ ...candidate, status: 'REJECTED' });
    await expect(service().propose('skill-1', 'CODE_DEPLOY_SAFE')).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects candidates not visible in the authenticated tenant', async () => {
    candidateGet.mockRejectedValueOnce(new NotFoundException('Skill candidate not found.'));
    await expect(service().propose('other-org-skill', 'CODE_DEPLOY_SAFE')).rejects.toBeInstanceOf(NotFoundException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('requires authenticated human governance', async () => {
    tenantContext.getAuthenticationMethod.mockReturnValueOnce('machine');
    tenantContext.getUserId.mockReturnValueOnce(null as any);
    await expect(service().propose('skill-1', 'CODE_DEPLOY_SAFE')).rejects.toBeInstanceOf(BadRequestException);
    expect(candidateGet).not.toHaveBeenCalled();
  });

  it('rejects duplicate pending reviews', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 'existing-review' }]);
    await expect(service().propose('skill-1', 'CODE_DEPLOY_SAFE')).rejects.toBeInstanceOf(ConflictException);
  });

  it('approval changes only governance review state and explicitly grants no execution authority', async () => {
    queryRaw.mockResolvedValueOnce([{
      id: 'review-1',
      organization_id: 'org-1',
      skill_candidate_id: 'skill-1',
      target_capability_code: 'CODE_DEPLOY_SAFE',
      evidence_snapshot: {},
      status: 'APPROVED_FOR_REGISTRATION',
      requested_by_user_id: 'user-0',
      reviewed_by_user_id: 'user-1',
      review_rationale: 'Evidence is sufficient for registration review.',
      created_at: new Date(),
      reviewed_at: new Date(),
      updated_at: new Date(),
    }]);

    const review = await service().approveForRegistration(
      'review-1',
      'Evidence is sufficient for registration review.',
    );

    expect(review.status).toBe('APPROVED_FOR_REGISTRATION');
    expect(candidateGet).not.toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SKILL_PROMOTION_APPROVED_FOR_REGISTRATION',
      metadata: expect.objectContaining({
        executionAuthorityGranted: false,
        capabilityCreated: false,
        providerBindingChanged: false,
      }),
    }));
  });

  it('does not allow a finalized review to transition again', async () => {
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'review-1',
        organization_id: 'org-1',
        skill_candidate_id: 'skill-1',
        target_capability_code: 'CODE_DEPLOY_SAFE',
        evidence_snapshot: {},
        status: 'REJECTED',
        requested_by_user_id: 'user-0',
        reviewed_by_user_id: 'user-1',
        review_rationale: 'Rejected.',
        created_at: new Date(),
        reviewed_at: new Date(),
        updated_at: new Date(),
      }]);

    await expect(service().approveForRegistration('review-1', 'Try again.')).rejects.toBeInstanceOf(ConflictException);
  });
});
