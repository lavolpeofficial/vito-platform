import { authorizeCiReviewProgression, CiPromotionEvidence } from './ci-attestation.policy';

const valid: CiPromotionEvidence = {
  organizationId: 'tenant-a', executionOrganizationId: 'tenant-a',
  repository: 'lavolpeofficial/vito-platform', executionRepository: 'lavolpeofficial/vito-platform',
  expectedBranch: 'feat/self-build-1', observedBranch: 'feat/self-build-1', pullRequestBranch: 'feat/self-build-1',
  expectedHeadSha: 'a'.repeat(40), observedHeadSha: 'a'.repeat(40), pullRequestHeadSha: 'a'.repeat(40),
  workflowPath: '.github/workflows/ci.yml', expectedWorkflowPath: '.github/workflows/ci.yml',
  event: 'pull_request', status: 'completed', conclusion: 'success', matchingRunCount: 1, runId: 123,
  pullRequestDraft: true,
};

describe('inactive CI review progression attestation', () => {
  it('accepts one successful, exact tenant/PR/SHA/workflow match for review only', () => {
    expect(authorizeCiReviewProgression(valid)).toBe(true);
  });

  it.each([
    { organizationId: 'tenant-b' }, { executionOrganizationId: '' },
    { repository: 'other/repo' }, { executionRepository: 'other/repo' },
    { expectedBranch: 'main' }, { observedBranch: 'feat/other' }, { pullRequestBranch: 'feat/other' },
    { expectedHeadSha: 'invalid' }, { observedHeadSha: 'b'.repeat(40) }, { pullRequestHeadSha: 'b'.repeat(40) },
    { workflowPath: '.github/workflows/other.yml' }, { expectedWorkflowPath: '' },
    { event: 'push' }, { status: 'queued' }, { status: 'in_progress' },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: null },
    { matchingRunCount: 0 }, { matchingRunCount: 2 }, { runId: 0 }, { runId: NaN },
    { pullRequestDraft: false },
  ])('fails closed for invalid evidence %#', (override) => {
    expect(authorizeCiReviewProgression({ ...valid, ...override })).toBe(false);
  });
});
