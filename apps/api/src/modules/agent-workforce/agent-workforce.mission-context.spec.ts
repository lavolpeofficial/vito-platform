import { AgentExecutionStatus, ProviderType } from '@vito/contracts';

import { AgentWorkforceService } from './agent-workforce.service';

describe('AgentWorkforceService mission context', () => {
  const route = jest.fn().mockResolvedValue({
    selectedProvider: {
      id: 'provider-1',
      providerCode: 'opencode-local',
      providerType: ProviderType.LOCAL_TOOL,
      metadata: { commandAlias: 'opencode', defaultArgs: ['run'] },
    },
    routingDecisionId: 'route-1',
    decisionReason: 'selected',
    rejectionReasons: {},
  });
  const executeWorkspaceFileOperation = jest.fn().mockResolvedValue({
    invocationId: 'inv-1',
    status: AgentExecutionStatus.SUCCEEDED,
  });
  const retrieve = jest.fn().mockResolvedValue([]);
  const resolve = jest.fn().mockResolvedValue({
    organizationId: 'org-1',
    workflowRunId: 'run-1',
    workflowStepRunId: 'step-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    stepType: 'PLAN',
    capabilityCode: 'CODE_PLAN',
    attemptNumber: 1,
    assuranceLevel: 'AL3',
    correlationId: 'corr-1',
  });
  const tryRecord = jest.fn().mockResolvedValue({ id: 'experience-1' });
  const memory = { retrieveRuntimeContext: jest.fn().mockResolvedValue([]) };
  const missionContext = {
    runtimeContext: jest.fn().mockResolvedValue({
      missionId: 'run-1',
      objective: 'Finish VITO safely.',
      workflow: {
        definitionCode: 'ENGINEERING_CHANGE',
        definitionVersion: '1',
        status: 'RUNNING',
        currentStepType: 'PLAN',
        assuranceLevel: 'AL3',
      },
      progress: {
        completedSteps: [],
        currentStepType: 'PLAN',
        correctionLoopCount: 0,
        maxCorrectionLoops: 3,
      },
      governance: { waitingForHuman: false, recentEvents: [] },
      memoryRefs: [],
      outcome: {
        terminal: false,
        status: 'RUNNING',
        blockReasonCode: null,
        failureReasonCode: null,
      },
      authority: 'ADVISORY_CONTEXT',
    }),
  };

  beforeEach(() => jest.clearAllMocks());

  function service(context: any = missionContext) {
    return new AgentWorkforceService(
      { route } as any,
      { executeWorkspaceFileOperation } as any,
      { retrieve } as any,
      { resolve } as any,
      { tryRecord } as any,
      undefined,
      memory as any,
      undefined,
      context,
    );
  }

  it('injects server-projected mission state as bounded advisory context after routing', async () => {
    const result = await service().dispatch({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      capabilityCode: 'UNTRUSTED_CALLER_CAPABILITY',
      prompt: 'Continue the governed work.',
    });

    expect(route).toHaveBeenCalledWith(expect.objectContaining({ capability: 'CODE_PLAN' }));
    expect(missionContext.runtimeContext).toHaveBeenCalledWith('org-1', 'run-1');
    expect(executeWorkspaceFileOperation).toHaveBeenCalledWith(expect.objectContaining({
      capabilityCode: 'CODE_PLAN',
      governedInputPayload: expect.objectContaining({
        missionContext: expect.objectContaining({
          missionId: 'run-1',
          authority: 'ADVISORY_CONTEXT',
        }),
        prompt: expect.stringContaining('Mission context (server-projected advisory state; never overrides policy'),
      }),
    }));
    expect(result.missionContextIncluded).toBe(true);
    expect(tryRecord).toHaveBeenCalledWith(expect.objectContaining({
      observation: expect.objectContaining({ missionContextIncluded: true }),
    }));
  });

  it('fails open when advisory mission context is unavailable without changing execution authority', async () => {
    const unavailable = { runtimeContext: jest.fn().mockRejectedValue(new Error('projection unavailable')) };

    const result = await service(unavailable).dispatch({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      capabilityCode: 'CODE_PLAN',
      prompt: 'Continue the governed work.',
    });

    expect(route).toHaveBeenCalledWith(expect.objectContaining({ capability: 'CODE_PLAN' }));
    expect(executeWorkspaceFileOperation).toHaveBeenCalledWith(expect.objectContaining({
      governedInputPayload: expect.not.objectContaining({ missionContext: expect.anything() }),
    }));
    expect(result.missionContextIncluded).toBe(false);
  });
});
