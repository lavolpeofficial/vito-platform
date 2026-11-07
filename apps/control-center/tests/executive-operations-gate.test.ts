import assert from 'node:assert/strict';
import test from 'node:test';
import { projectExecutiveOperations } from '../lib/executive/operations-gate.ts';
import type { OperationsSummary } from '../lib/operations/contracts.ts';

const now = Date.parse('2026-11-07T12:00:00.000Z');
const base: OperationsSummary = {
  organizationId: 'org-owner',
  authority: 'READ_ONLY',
  observedAt: '2026-11-07T11:59:30.000Z',
  workflows: {
    total: 7,
    byStatus: { BLOCKED: 2, FAILED: 1, RUNNING: 1, PENDING: 1, COMPLETED: 2 },
    attentionCount: 3,
    attentionLimit: 10,
    recentAttention: [
      { id: 'run-1', status: 'BLOCKED', currentStepType: 'WAIT', blockReasonCode: 'HUMAN_GATE',
        failureReasonCode: null, correlationId: null, updatedAt: '2026-11-07T11:59:00Z' },
      { id: 'run-2', status: 'FAILED', currentStepType: null, blockReasonCode: null,
        failureReasonCode: 'PROVIDER_TIMEOUT', correlationId: null, updatedAt: '2026-11-07T11:58:00Z' },
    ],
  },
  workforce: { total: 4, byStatus: { ACTIVE: 4 } },
  knowledge: { sources: { total: 0, byIngestionStatus: {} }, knowledgeUnits: 0 },
  memory: { total: 0, byStatus: {} },
  governance: { pendingSkillPromotionReviews: 2 },
  providers: { registeredCount: 2, routingWindowDecisionCount: 0,
    capabilityGapCount: 1, capabilityGaps: [{ capabilityCode: 'MODEL', readiness: 'MISSING', enabledProviderCount: 0 }] },
};

test('read-only fresh tenant data yields bounded and truthful attention signals', () => {
  const got = projectExecutiveOperations(base, 'org-owner', now);
  assert.ok(got);
  assert.equal(got.totalWorkflows, 7);
  assert.equal(got.blocked, 2);
  assert.equal(got.failed, 1);
  assert.equal(got.governanceReviews, 2);
  assert.equal(got.recentAttention[0].reason, 'HUMAN_GATE');
  assert.equal(got.recentAttention[1].reason, 'PROVIDER_TIMEOUT');
  assert.equal('completed' in got, false); // No inference of semantic success
});

test('cross-tenant, empty tenant, and write-authority data fail closed', () => {
  assert.equal(projectExecutiveOperations(base, 'other', now), null);
  assert.equal(projectExecutiveOperations(base, '', now), null);
  assert.equal(projectExecutiveOperations({...base, authority: 'WRITE' as 'READ_ONLY'}, 'org-owner', now), null);
});

test('stale, invalid and future-skewed timestamps fail closed', () => {
  assert.equal(projectExecutiveOperations({...base, observedAt: '2026-11-07T11:54:00Z'}, 'org-owner', now), null);
  assert.equal(projectExecutiveOperations({...base, observedAt: 'not a timestamp'}, 'org-owner', now), null);
  assert.equal(projectExecutiveOperations({...base, observedAt: '2026-11-07T12:02:00Z'}, 'org-owner', now), null);
});

test('inconsistent workflow totals and invalid status counts fail closed', () => {
  assert.equal(projectExecutiveOperations({...base, workflows: {...base.workflows, total: 8}}, 'org-owner', now), null);
  assert.equal(projectExecutiveOperations({...base, workflows: {...base.workflows, byStatus: {...base.workflows.byStatus, FAILED: -1}}}, 'org-owner', now), null);
  assert.equal(projectExecutiveOperations({...base, workflows: {...base.workflows, attentionCount: 8}}, 'org-owner', now), null);
  assert.equal(projectExecutiveOperations({...base, workflows: {...base.workflows, attentionLimit: 1}}, 'org-owner', now), null);
});

test('no events and no attention is a valid verified zero, not a source outage', () => {
  const source = {...base, workflows: {...base.workflows, total: 0, byStatus: {}, attentionCount: 0, recentAttention: []}};
  const got=projectExecutiveOperations(source,'org-owner',now);
  assert.ok(got);
  assert.equal(got.blocked,0);
  assert.deepEqual(got.recentAttention,[]);
});
