import { authorizePreGatePublication, PreGatePublicationRequest } from './pre-gate-publication.policy';
const valid: PreGatePublicationRequest = {
  action: 'COMMIT', organizationId: 'tenant-a', missionOrganizationId: 'tenant-a', missionId: 'mission-1',
  approvedMissionId: 'mission-1', codeBuildApprovedByHuman: true, codeBuildApprovalActive: true,
  repository: 'lavolpeofficial/vito-platform', approvedRepository: 'lavolpeofficial/vito-platform',
  branch: 'feat/self-build-1', approvedBranch: 'feat/self-build-1', actorIsMachine: true,
};
describe('pre-gate publication policy (not connected to mutation adapter)', () => {
  it.each(['COMMIT', 'PUSH', 'DRAFT_PR', 'CI_READ'] as const)('allows scoped %s only with evidence', (action) => {
    expect(authorizePreGatePublication({ ...valid, action, draft: true, expectedHeadSha: 'a'.repeat(40), ciHeadSha: 'a'.repeat(40), ciMatches: 1 })).toBe(true);
  });
  it.each(['MERGE', 'DEPLOY', 'ACTIVATE_PROVIDER', 'ACTIVATE_CAPABILITY', 'APPROVE_HUMAN_GATE'] as const)('denies %s unconditionally', (action) => {
    expect(authorizePreGatePublication({ ...valid, action })).toBe(false);
  });
  it.each([
    { organizationId: 'tenant-b' }, { missionId: 'other' }, { codeBuildApprovedByHuman: false },
    { codeBuildApprovalActive: false }, { repository: 'other/repo' }, { branch: 'main' },
    { branch: 'feat/other' }, { approvedBranch: 'feat/other' }, { approvedRepository: 'other/repo' },
    { organizationId: '' }, { missionId: '' },
  ])('denies missing or mismatched approval scope %#', (override) => {
    expect(authorizePreGatePublication({ ...valid, ...override })).toBe(false);
  });
  it('denies non-draft PR', () => expect(authorizePreGatePublication({ ...valid, action: 'DRAFT_PR', draft: false })).toBe(false));
  it.each([
    { expectedHeadSha: 'a'.repeat(40), ciHeadSha: 'b'.repeat(40), ciMatches: 1 },
    { expectedHeadSha: 'a'.repeat(40), ciHeadSha: 'a'.repeat(40), ciMatches: 0 },
    { expectedHeadSha: 'a'.repeat(40), ciHeadSha: 'a'.repeat(40), ciMatches: 2 },
    { expectedHeadSha: '', ciHeadSha: '', ciMatches: 1 },
  ])('denies missing, stale or ambiguous CI evidence %#', (override) => {
    expect(authorizePreGatePublication({ ...valid, action: 'CI_READ', ...override })).toBe(false);
  });
});
