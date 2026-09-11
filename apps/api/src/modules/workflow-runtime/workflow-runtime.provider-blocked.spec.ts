import { AgentExecutionStatus } from '@vito/contracts';
import { WorkflowRuntimeService } from './workflow-runtime.service';

const ORG = 'org-provider-blocked';

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-provider-blocked',
    organizationId: ORG,
    taskId: 'task-1',
    workflowDefinitionCode: 'engineering-loop',
    workflowDefinitionVersion: '0.1.0',
    assuranceLevel: 'AL2',
    status: 'RUNNING',
    currentStepType: 'BUILD',
    correctionLoopCount: 0,
    maxCorrectionLoops: 3,
    correlationId: 'corr-provider-blocked',
    blockReasonCode: null,
    failureReasonCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

function makeStep(runId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'step-provider-blocked',
    organizationId: ORG,
    workflowRunId: runId,
    stepType: 'BUILD',
    status: 'READY',
    attemptNumber: 1,
    causationId: null,
    metadata: {},
    startedAt: new Date(),
    finishedAt: null,
    ...overrides,
  };
}

describe('WorkflowRuntimeService provider-blocked propagation', () => {
  it('persists provider blocking as BLOCKED + WAITING while preserving the current step', async () => {
    const run = makeRun();
    const step = makeStep(run.id);
    const blockedRun = {
      ...run,
      status: 'BLOCKED',
      currentStepType: 'BUILD',
      blockReasonCode: 'PROVIDER_BLOCKED',
    };

    const tx = {
      workflowRun: {
        findFirst: jest.fn().mockResolvedValue(run),
        update: jest.fn().mockResolvedValue(blockedRun),
      },
      workflowStepRun: {
        findFirst: jest.fn().mockResolvedValue(step),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
    };
    const prisma: any = {
      workflowRun: { findFirst: jest.fn().mockResolvedValue(run) },
      workflowStepRun: { findFirst: jest.fn().mockResolvedValue(step) },
      $transaction: jest.fn((fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const audit: any = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new WorkflowRuntimeService(prisma, audit);

    const result = await service.completeStep({
      organizationId: ORG,
      workflowRunId: run.id,
      workflowStepRunId: step.id,
      stepStatus: 'FAILED',
      providerStatus: AgentExecutionStatus.POLICY_BLOCKED,
      metadata: { executionStatus: AgentExecutionStatus.POLICY_BLOCKED },
    });

    expect(result.outcome).toEqual({
      kind: 'BLOCKED',
      reason: {
        type: 'PROVIDER_BLOCKED',
        providerStatus: AgentExecutionStatus.POLICY_BLOCKED,
      },
    });
    expect(tx.workflowStepRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: step.id, status: 'READY' },
      data: expect.objectContaining({ status: 'WAITING', finishedAt: null }),
    }));
    expect(tx.workflowRun.update).toHaveBeenCalledWith({
      where: { id: run.id },
      data: expect.objectContaining({
        status: 'BLOCKED',
        currentStepType: 'BUILD',
        blockReasonCode: 'PROVIDER_BLOCKED',
      }),
    });
  });

  it('re-arms a provider-blocked WAITING step to READY when the run is resumed', async () => {
    const run = makeRun({ status: 'BLOCKED', blockReasonCode: 'PROVIDER_BLOCKED' });
    const workflowRunUpdate = jest.fn().mockResolvedValue({
      ...run,
      status: 'RUNNING',
      blockReasonCode: null,
    });
    const workflowStepUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      workflowRun: { update: workflowRunUpdate },
      workflowStepRun: { updateMany: workflowStepUpdateMany },
    };
    const prisma: any = {
      workflowRun: { findFirst: jest.fn().mockResolvedValue(run) },
      workflowStepRun: { findMany: jest.fn() },
      $transaction: jest.fn((fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const audit: any = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new WorkflowRuntimeService(prisma, audit);

    const resumed = await service.resumeRun(ORG, run.id);

    expect(resumed.status).toBe('RUNNING');
    expect(workflowRunUpdate).toHaveBeenCalledWith({
      where: { id: run.id },
      data: { status: 'RUNNING', blockReasonCode: null },
    });
    expect(workflowStepUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        workflowRunId: run.id,
        stepType: 'BUILD',
        status: 'WAITING',
      },
      data: { status: 'READY', finishedAt: null },
    });
  });
});
