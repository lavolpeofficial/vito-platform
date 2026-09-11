import { ConflictException } from '@nestjs/common';
import { AgentExecutionStatus, EngineeringCapability, EngineeringStepType } from '@vito/contracts';
import { WorkflowAgentRuntimeService } from './workflow-agent-runtime.service';

describe('WorkflowAgentRuntimeService', () => {
  const findRun = jest.fn();
  const findStep = jest.fn();
  const findTask = jest.fn();
  const dispatch = jest.fn();
  const capabilityForStep = jest.fn();
  const completeStep = jest.fn();

  const prisma = {
    workflowRun: { findFirst: findRun },
    workflowStepRun: { findFirst: findStep },
    task: { findFirst: findTask },
  } as any;

  const service = new WorkflowAgentRuntimeService(
    prisma,
    { dispatch } as any,
    { capabilityForStep } as any,
    { completeStep } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findRun.mockResolvedValue({
      id: 'run-1',
      taskId: 'task-1',
      status: 'RUNNING',
      currentStepType: EngineeringStepType.BUILD,
      assuranceLevel: 'AL-3',
      correlationId: 'corr-1',
    });
    findStep.mockResolvedValue({
      id: 'step-1',
      stepType: EngineeringStepType.BUILD,
      attemptNumber: 1,
    });
    findTask.mockResolvedValue({
      id: 'task-1',
      title: 'Implement bounded change',
      description: 'Change only the requested component.',
      assignedDigitalEmployeeId: 'agent-1',
    });
    capabilityForStep.mockReturnValue(EngineeringCapability.CODE_BUILD);
    completeStep.mockResolvedValue({ idempotent: false, outcome: { kind: 'NEXT_STEP' } });
  });

  it('dispatches the persisted current step with a server-owned capability and advances on success', async () => {
    dispatch.mockResolvedValue({
      routingDecisionId: 'route-1',
      selectedProviderId: 'provider-1',
      selectedProviderCode: 'local-builder',
      experienceId: 'exp-1',
      execution: { status: AgentExecutionStatus.SUCCEEDED },
    });

    const result = await service.executeCurrentStep('org-1', 'run-1');

    expect(capabilityForStep).toHaveBeenCalledWith(EngineeringStepType.BUILD);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        workflowRunId: 'run-1',
        workflowStepRunId: 'step-1',
        capabilityCode: EngineeringCapability.CODE_BUILD,
        assuranceLevel: 'AL-3',
        correlationId: 'corr-1',
        prompt: expect.stringContaining('Implement bounded change'),
      }),
    );
    expect(completeStep).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        workflowRunId: 'run-1',
        workflowStepRunId: 'step-1',
        stepStatus: 'SUCCEEDED',
        metadata: expect.objectContaining({
          source: 'WORKFLOW_AGENT_RUNTIME',
          capabilityCode: EngineeringCapability.CODE_BUILD,
          experienceId: 'exp-1',
          executionStatus: AgentExecutionStatus.SUCCEEDED,
        }),
      }),
    );
    expect(result.disposition).toBe('TRANSITIONED');
  });

  it('advances the state machine with FAILED for an objective failed execution', async () => {
    dispatch.mockResolvedValue({
      routingDecisionId: 'route-1',
      selectedProviderId: 'provider-1',
      selectedProviderCode: 'local-builder',
      experienceId: 'exp-2',
      execution: { status: AgentExecutionStatus.FAILED },
    });

    await service.executeCurrentStep('org-1', 'run-1');

    expect(completeStep).toHaveBeenCalledWith(
      expect.objectContaining({ stepStatus: 'FAILED' }),
    );
  });

  it('does not falsely complete policy- or quota-blocked executions', async () => {
    dispatch.mockResolvedValue({
      routingDecisionId: 'route-1',
      selectedProviderId: 'provider-1',
      selectedProviderCode: 'local-builder',
      experienceId: 'exp-3',
      execution: { status: AgentExecutionStatus.POLICY_BLOCKED },
    });

    const result = await service.executeCurrentStep('org-1', 'run-1');

    expect(result.disposition).toBe('EXECUTION_BLOCKED');
    expect(completeStep).not.toHaveBeenCalled();
  });

  it('stops at non-agent workflow steps instead of inventing a capability', async () => {
    findRun.mockResolvedValueOnce({
      id: 'run-1',
      taskId: 'task-1',
      status: 'RUNNING',
      currentStepType: EngineeringStepType.HUMAN_RELEASE_GATE,
      assuranceLevel: 'AL-3',
      correlationId: 'corr-1',
    });
    findStep.mockResolvedValueOnce({
      id: 'step-human',
      stepType: EngineeringStepType.HUMAN_RELEASE_GATE,
      attemptNumber: 1,
    });
    capabilityForStep.mockReturnValueOnce(null);

    const result = await service.executeCurrentStep('org-1', 'run-1');

    expect(result.disposition).toBe('NON_AGENT_STEP');
    expect(findTask).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(completeStep).not.toHaveBeenCalled();
  });

  it('rejects non-running workflows before any dispatch', async () => {
    findRun.mockResolvedValueOnce({
      id: 'run-1',
      taskId: 'task-1',
      status: 'BLOCKED',
      currentStepType: EngineeringStepType.BUILD,
      assuranceLevel: 'AL-3',
      correlationId: 'corr-1',
    });

    await expect(service.executeCurrentStep('org-1', 'run-1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
