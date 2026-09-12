import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWorkflowSnapshot } from '../lib/workflows/contracts.ts';

const BASE = {
  workflowRunId: 'run-1', organizationId: 'org-1', correlationId: 'corr-1', status: 'RUNNING', currentStepType: 'PLAN', boundary: 'ACTIVE', nextAction: 'EXECUTE_CURRENT_STEP', blockReasonCode: null, failureReasonCode: null,
  correctionLoopCount: 0, maxCorrectionLoops: 3, startedAt: '2026-09-12T14:00:00.000Z', completedAt: null,
  steps: [{ id: 'step-1', stepType: 'PLAN', status: 'READY', attemptNumber: 1, causationId: null, startedAt: '2026-09-12T14:00:00.000Z', finishedAt: null }],
  timeline: [{ id: 'event-1', actorType: 'SYSTEM', actorId: null, action: 'WORKFLOW_RUN_STARTED', entityType: 'WorkflowRun', entityId: 'run-1', metadata: {}, createdAt: '2026-09-12T14:00:00.000Z' }],
  timelineTruncated: false, observedAt: '2026-09-12T14:01:00.000Z', authority: 'READ_ONLY',
} as const;

test('accepts bounded read-only workflow observer snapshots', () => {
  const parsed = parseWorkflowSnapshot(BASE);
  assert.ok(parsed);
  assert.equal(parsed.nextAction, 'EXECUTE_CURRENT_STEP');
  assert.equal(parsed.steps[0]?.status, 'READY');
});

test('rejects authority escalation and unknown next actions', () => {
  assert.equal(parseWorkflowSnapshot({ ...BASE, authority: 'WRITE' }), null);
  assert.equal(parseWorkflowSnapshot({ ...BASE, nextAction: 'APPROVE_RELEASE' }), null);
});

test('rejects unbounded timelines', () => {
  assert.equal(parseWorkflowSnapshot({ ...BASE, timeline: Array.from({ length: 201 }, () => BASE.timeline[0]) }), null);
});
