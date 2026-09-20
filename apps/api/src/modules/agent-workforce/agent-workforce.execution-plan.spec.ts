import { AgentExecutionStatus, ProviderType } from '@vito/contracts';
import { AgentWorkforceService } from './agent-workforce.service';

describe('AgentWorkforceService persisted workflow execution plan boundary', () => {
  it('rejects server-resolved CODE_BUILD before routing even when caller requests another capability', async () => {
    const route = jest.fn();
    const executeWorkspaceFileOperation = jest.fn();
    const resolve = jest.fn().mockResolvedValue({ capabilityCode: 'CODE_BUILD', correlationId: 'server-correlation' });
    const service = new AgentWorkforceService(
      { route } as any,
      { executeWorkspaceFileOperation } as any,
      { retrieve: jest.fn() } as any,
      { resolve } as any,
      { tryRecord: jest.fn() } as any,
    );
    await expect(service.dispatch({ organizationId: 'org-1', workflowRunId: 'run-1', workflowStepRunId: 'step-1', capabilityCode: 'CODE_PLAN', prompt: 'build' })).rejects.toMatchObject({ status: 403 });
    expect(route).not.toHaveBeenCalled();
    expect(executeWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('ignores caller capability and uses the server-owned persisted workflow capability', async () => {
    const route = jest.fn().mockResolvedValue({
      selectedProvider: {
        id: 'provider-1',
        providerCode: 'opencode-local',
        providerType: ProviderType.LOCAL_TOOL,
        metadata: { commandAlias: 'opencode', defaultArgs: [] },
      },
      routingDecisionId: 'route-1',
      rejectionReasons: {},
      decisionReason: 'selected',
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
      stepType: 'BUILD',
      capabilityCode: 'CODE_PLAN',
      attemptNumber: 1,
      assuranceLevel: 'AL-3',
      correlationId: 'corr-server',
    });
    const tryRecord = jest.fn().mockResolvedValue({ id: 'exp-1' });

    const service = new AgentWorkforceService(
      { route } as any,
      { executeWorkspaceFileOperation } as any,
      { retrieve } as any,
      { resolve } as any,
      { tryRecord } as any,
    );

    const result = await service.dispatch({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      capabilityCode: 'RED_TEAM',
      prompt: 'Build the requested change.',
      assuranceLevel: 'AL-1',
      correlationId: 'corr-caller',
    });

    expect(route).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'CODE_PLAN',
        assuranceLevel: 'AL-3',
        correlationId: 'corr-server',
      }),
    );
    expect(retrieve).toHaveBeenCalledWith({
      query: 'CODE_PLAN Build the requested change.',
      limit: 8,
    });
    expect(executeWorkspaceFileOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityCode: 'CODE_PLAN',
        correlationId: 'corr-server',
      }),
    );
    expect(tryRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ capabilityCode: 'CODE_PLAN' }),
        action: expect.objectContaining({ capabilityCode: 'CODE_PLAN' }),
      }),
    );
    expect(result.capabilityCode).toBe('CODE_PLAN');
  });
});
