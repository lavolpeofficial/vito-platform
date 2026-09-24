import { parseCodeBuildApprovalStatus } from '../lib/workflows/code-build-approval-contracts';

describe('CODE_BUILD approval status contract', () => {
  const valid = {
    missionId: 'run-1',
    repository: 'lavolpeofficial/vito-platform',
    state: 'READY',
    machineIdentityCount: 1,
    approvals: [{
      id: '123e4567-e89b-42d3-a456-426614174000',
      branch: 'feat/vito-run',
      approvedAt: '2026-09-24T08:00:00.000Z',
      expiresAt: '2026-09-24T08:30:00.000Z',
      approvedByUserId: 'human-1',
    }],
    authority: 'READ_ONLY',
  };

  it('accepts one bounded read-only approval status', () => {
    const result = parseCodeBuildApprovalStatus(valid);
    expect(result?.state).toBe('READY');
    expect(result?.approvals[0].branch).toBe('feat/vito-run');
  });

  it('rejects unknown authority states', () => {
    expect(parseCodeBuildApprovalStatus({ ...valid, state: 'AUTO_APPROVED' })).toBeNull();
  });

  it('rejects ungoverned repositories and invalid branches', () => {
    expect(parseCodeBuildApprovalStatus({ ...valid, repository: 'other/repo' })).toBeNull();
    expect(parseCodeBuildApprovalStatus({
      ...valid,
      approvals: [{ ...valid.approvals[0], branch: 'main' }],
    })).toBeNull();
  });
});
