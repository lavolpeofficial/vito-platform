import { parseMissionContextSnapshot } from '../lib/missions/contracts';

describe('mission context contracts', () => {
  const valid = {
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
  };

  it('accepts the bounded advisory mission projection', () => {
    const result = parseMissionContextSnapshot(valid);
    expect(result?.missionId).toBe('run-1');
    expect(result?.progress.completedSteps).toEqual(['PLAN', 'BUILD']);
    expect(result?.memoryRefs).toHaveLength(1);
  });

  it('rejects a mission projection that claims execution authority', () => {
    expect(parseMissionContextSnapshot({ ...valid, authority: 'EXECUTION_AUTHORITY' })).toBeNull();
  });

  it('rejects unbounded shared memory references', () => {
    expect(parseMissionContextSnapshot({
      ...valid,
      memoryRefs: Array.from({ length: 9 }, (_, index) => ({ ...valid.memoryRefs[0], id: `memory-${index}` })),
    })).toBeNull();
  });
});
