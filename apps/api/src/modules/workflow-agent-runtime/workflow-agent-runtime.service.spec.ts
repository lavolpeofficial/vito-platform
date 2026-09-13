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
  const tryRecordOutcome = jest.fn();

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
    { tryRecord: tryRecordOutcome } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findRun.mockResolvedValue({
      id: 'run-1', taskId: 'task-1', status: 'RUNNING',
      currentStepType: EngineeringStepType.BUILD, assuranceLevel: 'AL-3', correlationId: 'corr-1',
    });
    findStep.mockResolvedValue({ id: 'step-1', stepType: EngineeringStepType.BUILD, attemptNumber: 1 });
    findTask.mockResolvedValue({
      id: 'task-1', title: 'Implement bounded change',
      description: 'Change only the requested component.', assignedDigitalEmployeeId: 'agent-1',
    });
    capabilityForStep.mockReturnValue(EngineeringCapability.CODE_BUILD);
    completeStep.mockResolvedValue({ idempotent: false, outcome: { kind: 'NEXT_STEP' } });
    tryRecordOutcome.mockResolvedValue({ id: 'outcome-1', score: 1 });
  });

  it('dispatches, binds governed evidence references, transitions, then objectively evaluates the persisted runtime Experience', async () => {
    dispatch.mockResolvedValue({
      routingDecisionId: 'route-1', selectedProviderId: 'provider-1', selectedProviderCode: 'local-builder',
      experienceId: 'exp-1',
      execution: {
        status: AgentExecutionStatus.SUCCEEDED,
        invocationId: 'invocation-1',
        outputReference: 'artifact://review/output.json',
        artifactReferences: ['artifact://review/report.json'],
        evidenceReferences: ['evidence://review/trace-1'],
        providerExecutionMetadata: { shouldNotPersist: true },
      },
    });

    const result = await service.executeCurrentStep('org-1', 'run-1');

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', workflowRunId: 'run-1', workflowStepRunId: 'step-1',
      capabilityCode: EngineeringCapability.CODE_BUILD, assuranceLevel: 'AL-3', correlationId: 'corr-1',
      prompt: expect.stringContaining('Implement bounded change'),
    }));
    expect(completeStep).toHaveBeenCalledWith(expect.objectContaining({
      stepStatus: 'SUCCEEDED',
      metadata: expect.objectContaining({
        experienceId: 'exp-1',
        executionStatus: AgentExecutionStatus.SUCCEEDED,
        executionEvidence: {
          invocationId: 'invocation-1',
          outputReference: 'artifact://review/output.json',
          artifactReferences: ['artifact://review/report.json'],
          evidenceReferences: ['evidence://review/trace-1'],
        },
      }),
    }));
    const completion = completeStep.mock.calls[0][0];
    expect(completion.metadata.executionEvidence.providerExecutionMetadata).toBeUndefined();
    expect(tryRecordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', experienceId: 'exp-1', workflowStepRunId: 'step-1',
      executionStatus: AgentExecutionStatus.SUCCEEDED, transitionKind: 'NEXT_STEP',
    }));
    expect(result.disposition).toBe('TRANSITIONED');
    if (result.disposition !== 'TRANSITIONED') throw new Error('expected transitioned result');
    expect(result.outcomeEvaluation).toEqual(expect.objectContaining({ id: 'outcome-1' }));
  });

  it('bounds execution evidence instead of persisting arbitrary or oversized provider output', async () => {
    const validRefs = Array.from({ length: 40 }, (_, index) => `evidence://review/${index}`);
    dispatch.mockResolvedValue({
      routingDecisionId: 'route-1', selectedProviderId: 'provider-1', selectedProviderCode: 'local-builder',
      experienceId: 'exp-bounded',
      execution: {
        status: AgentExecutionStatus.SUCCEEDED,
        invocationId: 'x'.repeat(257),
        outputReference: 'y'.repeat(2049),
        artifactReferences: ['artifact://valid', 123, '', 'z'.repeat(2049)],
        evidenceReferences: validRefs,
        providerExecutionMetadata: { unrestricted: 'metadata' },
      },
    });

    await service.executeCurrentStep('org-1', 'run-1');

    const evidence = completeStep.mock.calls[0][0].metadata.executionEvidence;
    expect(evidence.invocationId).toBeUndefined();
    expect(evidence.outputReference).toBeUndefined();
    expect(evidence.artifactReferences).toEqual(['artifact://valid']);
    expect(evidence.evidenceReferences).toHaveLength(32);
    expect(evidence.providerExecutionMetadata).toBeUndefined();
  });

  it('records objective failure evidence after failed execution transition', async () => {
    dispatch.mockResolvedValue({
      routingDecisionId: 'route-1', selectedProviderId: 'provider-1', selectedProviderCode: 'local-builder',
      experienceId: 'exp-2', execution: { status: AgentExecutionStatus.FAILED },
    });
    await service.executeCurrentStep('org-1', 'run-1');
    expect(completeStep).toHaveBeenCalledWith(expect.objectContaining({ stepStatus: 'FAILED' }));
    expect(tryRecordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      experienceId: 'exp-2', executionStatus: AgentExecutionStatus.FAILED,
    }));
  });

  it('propagates provider blocking into WorkflowRuntime without falsely failing the step', async () => {
    dispatch.mockResolvedValue({
      routingDecisionId: 'route-1', selectedProviderId: 'provider-1', selectedProviderCode: 'local-builder',
      experienceId: 'exp-3',
      execution: {
        status: AgentExecutionStatus.POLICY_BLOCKED,
        invocationId: 'invocation-blocked',
        evidenceReferences: ['evidence://policy/decision'],
      },
    });
    completeStep.mockResolvedValueOnce({ idempotent: false, outcome: { kind: 'BLOCKED' } });

    const result = await service.executeCurrentStep('org-1', 'run-1');

    expect(result.disposition).toBe('EXECUTION_BLOCKED');
    expect(completeStep).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: 'run-1', workflowStepRunId: 'step-1',
      stepStatus: 'FAILED', providerStatus: AgentExecutionStatus.POLICY_BLOCKED,
      metadata: expect.objectContaining({
        experienceId: 'exp-3',
        executionStatus: AgentExecutionStatus.POLICY_BLOCKED,
        executionEvidence: {
          invocationId: 'invocation-blocked',
          evidenceReferences: ['evidence://policy/decision'],
        },
      }),
    }));
    expect(tryRecordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      experienceId: 'exp-3', executionStatus: AgentExecutionStatus.POLICY_BLOCKED, transitionKind: 'BLOCKED',
    }));
  });

  it('stops at non-agent workflow steps instead of inventing a capability', async () => {
    findRun.mockResolvedValueOnce({
      id: 'run-1', taskId: 'task-1', status: 'RUNNING',
      currentStepType: EngineeringStepType.HUMAN_RELEASE_GATE, assuranceLevel: 'AL-3', correlationId: 'corr-1',
    });
    findStep.mockResolvedValueOnce({ id: 'step-human', stepType: EngineeringStepType.HUMAN_RELEASE_GATE, attemptNumber: 1 });
    capabilityForStep.mockReturnValueOnce(null);
    const result = await service.executeCurrentStep('org-1', 'run-1');
    expect(result.disposition).toBe('NON_AGENT_STEP');
    expect(dispatch).not.toHaveBeenCalled();
    expect(tryRecordOutcome).not.toHaveBeenCalled();
  });

  it('rejects non-running workflows before any dispatch', async () => {
    findRun.mockResolvedValueOnce({
      id: 'run-1', taskId: 'task-1', status: 'BLOCKED',
      currentStepType: EngineeringStepType.BUILD, assuranceLevel: 'AL-3', correlationId: 'corr-1',
    });
    await expect(service.executeCurrentStep('org-1', 'run-1')).rejects.toBeInstanceOf(ConflictException);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
