import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCodeBuildApprovalStatus } from '../lib/workflows/code-build-approval-contracts.ts';

const VALID = {
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
} as const;

test('accepts one bounded read-only approval status', () => {
  const result = parseCodeBuildApprovalStatus(VALID);
  assert.ok(result);
  assert.equal(result.state, 'READY');
  assert.equal(result.approvals[0].branch, 'feat/vito-run');
});

test('rejects unknown authority states', () => {
  assert.equal(parseCodeBuildApprovalStatus({ ...VALID, state: 'AUTO_APPROVED' }), null);
});

test('rejects ungoverned repositories and invalid branches', () => {
  assert.equal(parseCodeBuildApprovalStatus({ ...VALID, repository: 'other/repo' }), null);
  assert.equal(parseCodeBuildApprovalStatus({
    ...VALID,
    approvals: [{ ...VALID.approvals[0], branch: 'main' }],
  }), null);
});
