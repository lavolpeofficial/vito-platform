import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHumanReleaseApprovalResult, parseWorkflowCancellationResult, parseWorkflowSnapshot } from '../lib/workflows/contracts.ts';

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

test('accepts server-owned explicit human release action', () => {
  const parsed = parseWorkflowSnapshot({ ...BASE, currentStepType: 'HUMAN_RELEASE_GATE', nextAction: 'APPROVE_HUMAN_RELEASE' });
  assert.ok(parsed);
  assert.equal(parsed.nextAction, 'APPROVE_HUMAN_RELEASE');
});

test('accepts server-owned AL4 review coordination without browser provider data', () => {
  const parsed = parseWorkflowSnapshot({ ...BASE, currentStepType: 'RED_TEAM', nextAction: 'COORDINATE_AL4_REVIEWS' });
  assert.ok(parsed);
  assert.equal(parsed.nextAction, 'COORDINATE_AL4_REVIEWS');
});

test('accepts server-owned review verdict processing without browser verdict data', () => {
  const parsed = parseWorkflowSnapshot({ ...BASE, currentStepType: 'PARSE_VERDICT', nextAction: 'PROCESS_REVIEW_VERDICT' });
  assert.ok(parsed);
  assert.equal(parsed.nextAction, 'PROCESS_REVIEW_VERDICT');
});

test('rejects authority escalation and unknown next actions', () => {
  assert.equal(parseWorkflowSnapshot({ ...BASE, authority: 'WRITE' }), null);
  assert.equal(parseWorkflowSnapshot({ ...BASE, nextAction: 'APPROVE_RELEASE' }), null);
  assert.equal(parseWorkflowSnapshot({ ...BASE, nextAction: 'SUBMIT_BROWSER_VERDICT' }), null);
  assert.equal(parseWorkflowSnapshot({ ...BASE, nextAction: 'SELECT_REVIEW_PROVIDERS' }), null);
});

test('accepts only a non-executing explicit human approval response', () => {
  const valid = { disposition: 'HUMAN_RELEASE_APPROVED', workflowRunId: 'run-1', workflowStepRunId: 'step-gate', approvedByUserId: 'user-1', nextStep: 'RELEASE_EXECUTION', executionTriggered: false, authority: 'HUMAN_EXPLICIT' };
  assert.ok(parseHumanReleaseApprovalResult(valid));
  assert.equal(parseHumanReleaseApprovalResult({ ...valid, executionTriggered: true }), null);
  assert.equal(parseHumanReleaseApprovalResult({ ...valid, authority: 'SYSTEM' }), null);
  assert.equal(parseHumanReleaseApprovalResult({ ...valid, nextStep: 'REMOTE_VERIFY' }), null);
});

test('rejects unbounded timelines', () => {
  assert.equal(parseWorkflowSnapshot({ ...BASE, timeline: Array.from({ length: 201 }, () => BASE.timeline[0]) }), null);
});

test('accepts only an explicit human live-cancellation response', () => {
  const parsed = parseWorkflowCancellationResult({
    idempotent: false,
    executionTriggered: false,
    executionCancellationRequested: true,
    authority: 'HUMAN_EXPLICIT',
    executionCancellation: {
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      matchedExecutionCount: 1,
      signalAttemptCount: 1,
      signalFailureCount: 0,
      signalledExecutionIds: ['exec-1'],
      deferredCancellationArmed: true,
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.executionCancellation.signalAttemptCount, 1);
});

test('rejects cancellation responses that claim execution or inconsistent signal counts', () => {
  const base = {
    idempotent: false,
    executionTriggered: false,
    executionCancellationRequested: true,
    authority: 'HUMAN_EXPLICIT',
    executionCancellation: {
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      matchedExecutionCount: 1,
      signalAttemptCount: 1,
      signalFailureCount: 0,
      signalledExecutionIds: ['exec-1'],
      deferredCancellationArmed: true,
    },
  } as const;

  assert.equal(parseWorkflowCancellationResult({ ...base, executionTriggered: true }), null);
  assert.equal(parseWorkflowCancellationResult({
    ...base,
    executionCancellation: { ...base.executionCancellation, signalAttemptCount: 2 },
  }), null);
});
