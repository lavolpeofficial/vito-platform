import { ConflictException, ForbiddenException } from '@nestjs/common';
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
  const resolveForWorkflowDispatch = jest.fn();
  const resolveRedTeamEvidence = jest.fn();
  const resolveCorrectionContext = jest.fn();

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
    undefined,
    { resolveForWorkflowDispatch } as any,
    { resolve: resolveRedTeamEvidence } as any,
    { resolve: resolveCorrectionContext } as any,
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
    resolveRedTeamEvidence.mockResolvedValue({
      schemaVersion: 'RED_TEAM_EVIDENCE_V1', workflowRunId: 'run-1', redTeamStepRunId: 'step-red',
      testedRevisionSha: 'a'.repeat(40), entries: [], manifestSha256: 'f'.repeat(64),
    });
    resolveCorrectionContext.mockResolvedValue({
      schemaVersion: 'CORRECTION_CONTEXT_V1', workflowRunId: 'run-1', correctionStepRunId: 'step-correction',
      parseVerdictStepRunId: 'step-parse', redTeamStepRunId: 'step-red', reviewerExecutionId: 'inv-red', verdict: 'D',
      blockingFindings: [{ id: 'RT-001', severity: 'HIGH', category: 'TESTING', summary: 'Fix evidence handoff.', evidenceRefs: [], blocking: true }],
      governedExecutionReference: 'gov://execution/inv-red', policyDecisionReference: 'policy-red', manifestSha256: 'c'.repeat(64),
    });
    resolveForWorkflowDispatch.mockResolvedValue({
      approvalId: 'approval-1',
      machineUserId: 'machine-1',
      scope: {
        missionId: 'run-1',
        repository: 'lavolpeofficial/vito-platform',
        branch: 'feat/workflow-build',
        requestKey: 'workflow-step:step-1',
      },
    });
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
      codeBuildApproval: expect.objectContaining({
        approvalId: 'approval-1',
        machineUserId: 'machine-1',
        scope: expect.objectContaining({
          missionId: 'run-1',
          branch: 'feat/workflow-build',
          requestKey: 'workflow-step:step-1',
        }),
      }),
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


  it('persists revision and bounded result evidence for TEST execution', async () => {
    findRun.mockResolvedValueOnce({
      id: 'run-1', taskId: 'task-1', status: 'RUNNING',
      currentStepType: EngineeringStepType.TEST, assuranceLevel: 'AL-3', correlationId: 'corr-1',
    });
    findStep.mockResolvedValueOnce({ id: 'step-test', stepType: EngineeringStepType.TEST, attemptNumber: 1 });
    capabilityForStep.mockReturnValueOnce(EngineeringCapability.TEST_EXECUTION);
    dispatch.mockResolvedValueOnce({
      routingDecisionId: 'route-test', selectedProviderId: 'provider-1', selectedProviderCode: 'cloud.openai.main', experienceId: 'exp-test',
      execution: {
        status: AgentExecutionStatus.SUCCEEDED, invocationId: 'inv-test', outputReference: 'gov://execution/inv-test',
        providerExecutionMetadata: {
          stdout: '42 tests passed', exitCode: 0,
          governedResultSettling: { baseSha: '[REDACTED]', changedFiles: [] },
        },
        usageMetadata: { governedEvidenceBinding: { revisionReference: `gov://revision/${'a'.repeat(40)}`, stdoutSha256Reference: `gov://evidence/stdout-sha256/${'0'.repeat(64)}`, exitCode: 0 } },
      },
    });
    await service.executeCurrentStep('org-1', 'run-1');
    const evidence = completeStep.mock.calls[0][0].metadata.executionEvidence;
    expect(evidence.revision).toEqual({ baseSha: 'a'.repeat(40), changedFiles: [] });
    expect(evidence.resultSummary).toEqual(expect.objectContaining({ content: '42 tests passed', truncated: false }));
    expect(evidence.resultSummary.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('injects only the server-resolved evidence manifest into RED_TEAM prompt and persists the binding', async () => {
    findRun.mockResolvedValueOnce({
      id: 'run-1', taskId: 'task-1', status: 'RUNNING',
      currentStepType: EngineeringStepType.RED_TEAM, assuranceLevel: 'AL-3', correlationId: 'corr-1',
    });
    findStep.mockResolvedValueOnce({ id: 'step-red', stepType: EngineeringStepType.RED_TEAM, attemptNumber: 1 });
    capabilityForStep.mockReturnValueOnce(EngineeringCapability.RED_TEAM);
    dispatch.mockResolvedValueOnce({
      routingDecisionId: 'route-red', selectedProviderId: 'provider-1', selectedProviderCode: 'cloud.openai.main', experienceId: 'exp-red',
      execution: {
        status: AgentExecutionStatus.SUCCEEDED, invocationId: 'inv-red', outputReference: 'gov://execution/inv-red',
        artifactReferences: [], providerExecutionMetadata: { stdout: '{"verdict":"A","findings":[]}' },
      },
    });
    await service.executeCurrentStep('org-1', 'run-1');
    expect(resolveRedTeamEvidence).toHaveBeenCalledWith('org-1', 'run-1', 'step-red');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('RED_TEAM_EVIDENCE_MANIFEST_SHA256: ' + 'f'.repeat(64)),
    }));
    expect(dispatch.mock.calls[0][0].prompt).toContain('Do not traverse external workflow directories');
    expect(completeStep).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ redTeamEvidenceManifest: expect.objectContaining({ schemaVersion: 'RED_TEAM_EVIDENCE_V1' }) }),
    }));
  });

  it('fails closed before CODE_BUILD dispatch when server-side approval resolution fails', async () => {
    resolveForWorkflowDispatch.mockRejectedValueOnce(new ForbiddenException('CODE_BUILD_APPROVAL_REQUIRED'));

    await expect(service.executeCurrentStep('org-1', 'run-1')).rejects.toBeInstanceOf(ForbiddenException);

    expect(resolveForWorkflowDispatch).toHaveBeenCalledWith('org-1', 'run-1', 'step-1');
    expect(dispatch).not.toHaveBeenCalled();
    expect(completeStep).not.toHaveBeenCalled();
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
  it('injects only the server-resolved correction context into CORRECTION prompt and persists the binding', async () => {
    findRun.mockResolvedValueOnce({
      id: 'run-1', taskId: 'task-1', status: 'RUNNING',
      currentStepType: EngineeringStepType.CORRECTION, assuranceLevel: 'AL-3', correlationId: 'corr-1',
    });
    findStep.mockResolvedValueOnce({ id: 'step-correction', stepType: EngineeringStepType.CORRECTION, attemptNumber: 1 });
    capabilityForStep.mockReturnValueOnce(EngineeringCapability.CODE_BUILD);
    dispatch.mockResolvedValueOnce({
      routingDecisionId: 'route-correction', selectedProviderId: 'provider-1', selectedProviderCode: 'cloud.openai.main', experienceId: 'exp-correction',
      execution: {
        status: AgentExecutionStatus.SUCCEEDED, invocationId: 'inv-correction', outputReference: 'gov://execution/inv-correction',
        providerExecutionMetadata: { governedResultSettling: { baseSha: '[REDACTED]', changedFiles: [] } },
      },
    });
    await service.executeCurrentStep('org-1', 'run-1');
    expect(resolveCorrectionContext).toHaveBeenCalledWith('org-1', 'run-1', 'step-correction');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('CORRECTION_CONTEXT_MANIFEST_SHA256: ' + 'c'.repeat(64)),
    }));
    expect(dispatch.mock.calls.at(-1)?.[0].prompt).toContain('RT-001');
    expect(completeStep).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        correctionContextManifest: expect.objectContaining({ manifestSha256: 'c'.repeat(64) }),
      }),
    }));
  });

});
