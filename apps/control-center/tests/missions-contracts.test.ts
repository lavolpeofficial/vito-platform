import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMissionContextSnapshot } from '../lib/missions/contracts.ts';

const VALID = {
  missionId: 'run-1',
  objective: 'Finish VITO safely.',
  workflow: {
    definitionCode: 'ENGINEERING_CHANGE',
    definitionVersion: '1',
    status: 'RUNNING',
    currentStepType: 'TEST',
    assuranceLevel: 'AL4',
  },
  progress: {
    completedSteps: ['PLAN', 'BUILD'],
    currentStepType: 'TEST',
    correctionLoopCount: 0,
    maxCorrectionLoops: 3,
  },
  governance: {
    waitingForHuman: false,
    recentEvents: [{ action: 'WORKFLOW_STEP_ACTIVATED', createdAt: '2026-09-24T08:00:00.000Z' }],
  },
  memoryRefs: [{
    id: 'memory-1',
    kind: 'ORGANIZATIONAL',
    title: 'Release rule',
    sourceType: 'POLICY',
    sourceRef: 'policy-1',
    confidence: 1,
  }],
  outcome: {
    terminal: false,
    status: 'RUNNING',
    blockReasonCode: null,
    failureReasonCode: null,
  },
  authority: 'ADVISORY_CONTEXT',
} as const;

test('accepts the bounded advisory mission projection', () => {
  const result = parseMissionContextSnapshot(VALID);
  assert.ok(result);
  assert.equal(result.missionId, 'run-1');
  assert.deepEqual(result.progress.completedSteps, ['PLAN', 'BUILD']);
  assert.equal(result.memoryRefs.length, 1);
});

test('rejects a mission projection that claims execution authority', () => {
  assert.equal(parseMissionContextSnapshot({ ...VALID, authority: 'EXECUTION_AUTHORITY' }), null);
});

test('rejects unbounded shared memory references', () => {
  assert.equal(parseMissionContextSnapshot({
    ...VALID,
    memoryRefs: Array.from({ length: 9 }, (_, index) => ({ ...VALID.memoryRefs[0], id: 'memory-' + index })),
  }), null);
});
