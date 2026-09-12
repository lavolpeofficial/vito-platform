import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOperationsSummary } from '../lib/operations/contracts.ts';

const validPayload = {
  organizationId: 'org-1',
  observedAt: '2026-09-12T12:00:00.000Z',
  authority: 'READ_ONLY',
  workflows: {
    total: 4,
    byStatus: { RUNNING: 1, BLOCKED: 1, FAILED: 1, SUCCEEDED: 1 },
    attentionCount: 2,
    recentAttention: [
      {
        id: 'run-1',
        status: 'BLOCKED',
        currentStepType: 'TEST',
        blockReasonCode: 'PROVIDER_BLOCKED',
        failureReasonCode: null,
        correlationId: 'corr-1',
        updatedAt: '2026-09-12T11:59:00.000Z',
      },
    ],
    attentionLimit: 20,
  },
  workforce: { total: 2, byStatus: { ACTIVE: 2 } },
  knowledge: {
    sources: { total: 3, byIngestionStatus: { READY: 3 } },
    knowledgeUnits: 42,
  },
  memory: { total: 7, byStatus: { ACTIVE: 6, RETRACTED: 1 } },
  governance: { pendingSkillPromotionReviews: 1 },
  providers: {
    registeredCount: 2,
    routingWindowDecisionCount: 8,
    selectionRate: {},
    capabilityGapCount: 1,
    capabilityGaps: [
      { capabilityCode: 'SECURITY_REVIEW', readiness: 'REGISTERED_UNROUTABLE', enabledProviderCount: 0 },
    ],
    costVisibility: { semantics: 'CURRENT_PROVIDER_ESTIMATE_NOT_BILLED_COST' },
  },
};

test('parseOperationsSummary accepts the governed read-only operations contract', () => {
  const parsed = parseOperationsSummary(validPayload);
  assert.ok(parsed);
  assert.equal(parsed.authority, 'READ_ONLY');
  assert.equal(parsed.workflows.recentAttention[0]?.blockReasonCode, 'PROVIDER_BLOCKED');
  assert.equal(parsed.providers.capabilityGaps[0]?.capabilityCode, 'SECURITY_REVIEW');
});

test('parseOperationsSummary rejects malformed counts and authority escalation', () => {
  assert.equal(parseOperationsSummary({ ...validPayload, authority: 'EXECUTE' }), null);
  assert.equal(parseOperationsSummary({ ...validPayload, workflows: { ...validPayload.workflows, total: -1 } }), null);
  assert.equal(parseOperationsSummary({ ...validPayload, knowledge: { ...validPayload.knowledge, knowledgeUnits: 1.5 } }), null);
});

test('parseOperationsSummary rejects unbounded attention responses and malformed dates', () => {
  const tooMany = Array.from({ length: 21 }, (_, index) => ({
    ...validPayload.workflows.recentAttention[0],
    id: `run-${index}`,
  }));
  assert.equal(parseOperationsSummary({ ...validPayload, workflows: { ...validPayload.workflows, recentAttention: tooMany } }), null);
  assert.equal(parseOperationsSummary({ ...validPayload, observedAt: 'not-a-date' }), null);
});
