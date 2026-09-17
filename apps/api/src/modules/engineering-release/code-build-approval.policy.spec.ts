import { hasValidCodeBuildApproval, type CodeBuildApprovalEvidence } from './code-build-approval.policy';

const valid = (): CodeBuildApprovalEvidence => ({
  approvalId: 'approval-1', organizationId: 'org-1', executionOrganizationId: 'org-1',
  missionId: 'mission-1', executionMissionId: 'mission-1',
  repository: 'lavolpeofficial/vito-platform', executionRepository: 'lavolpeofficial/vito-platform',
  branch: 'feat/approved-build', executionBranch: 'feat/approved-build',
  approvedByHuman: true, approverIsMachine: false, revokedAt: null,
  approvedAt: new Date('2026-09-17T10:00:00Z'), expiresAt: new Date('2026-09-17T11:00:00Z'),
  evaluatedAt: new Date('2026-09-17T10:30:00Z'),
});

describe('CODE_BUILD approval evidence (inactive policy)', () => {
  it('accepts an in-scope, unrevoked, unexpired human approval', () => {
    expect(hasValidCodeBuildApproval(valid())).toBe(true);
  });

  it.each([
    { approvalId: '' }, { organizationId: '' }, { executionOrganizationId: 'other' },
    { missionId: '' }, { executionMissionId: 'other' },
    { repository: 'other/repo' }, { executionRepository: 'other/repo' },
    { branch: 'main', executionBranch: 'main' }, { executionBranch: 'feat/other' },
    { approvedByHuman: false }, { approverIsMachine: true },
    { revokedAt: new Date('2026-09-17T10:15:00Z') },
    { approvedAt: new Date('2026-09-17T10:31:00Z') },
    { expiresAt: new Date('2026-09-17T10:30:00Z') },
    { expiresAt: new Date('2026-09-17T09:59:00Z') },
    { evaluatedAt: new Date('invalid') }, { approvedAt: new Date('invalid') },
    { expiresAt: new Date('invalid') },
  ])('rejects missing, mismatched or invalid approval evidence: %p', (change) => {
    expect(hasValidCodeBuildApproval({ ...valid(), ...change })).toBe(false);
  });
});
