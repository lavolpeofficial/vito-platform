import { ConflictException, ForbiddenException } from '@nestjs/common';
import { HumanReleaseApprovalService } from './human-release-approval.service';

const ORG = 'org-1';
const RUN = 'run-1';
const STEP = 'step-gate-1';
const USER = 'user-1';

function buildService(overrides: {
  run?: any;
  step?: any;
  transition?: any;
} = {}) {
  const resolvedStep = Object.prototype.hasOwnProperty.call(overrides, 'step')
    ? overrides.step
    : { id: STEP };

  const prisma: any = {
    workflowRun: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.run ?? {
          id: RUN,
          status: 'RUNNING',
          currentStepType: 'HUMAN_RELEASE_GATE',
          correlationId: 'corr-1',
        },
      ),
    },
    workflowStepRun: {
      findFirst: jest.fn().mockResolvedValue(resolvedStep),
    },
  };

  const workflowRuntime: any = {
    completeStep: jest.fn().mockResolvedValue(
      overrides.transition ?? {
        idempotent: false,
        outcome: { kind: 'NEXT_STEP', nextStep: 'RELEASE_EXECUTION' },
      },
    ),
  };

  const auditService: any = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new HumanReleaseApprovalService(prisma, workflowRuntime, auditService),
    prisma,
    workflowRuntime,
    auditService,
  };
}

describe('HumanReleaseApprovalService', () => {
  it('advances a READY human gate only after explicit authenticated human approval', async () => {
    const { service, workflowRuntime, auditService } = buildService();

    const result = await service.approve({
      organizationId: ORG,
      workflowRunId: RUN,
      approvedByUserId: USER,
      isMachineIdentity: false,
    });

    expect(workflowRuntime.completeStep).toHaveBeenCalledWith({
      organizationId: ORG,
      workflowRunId: RUN,
      workflowStepRunId: STEP,
      stepStatus: 'SUCCEEDED',
      humanApproved: true,
      metadata: {
        source: 'HUMAN_RELEASE_APPROVAL',
        approvedByUserId: USER,
      },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        actorType: 'USER',
        actorId: USER,
        action: 'HUMAN_RELEASE_APPROVED',
        entityType: 'WorkflowRun',
        entityId: RUN,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        disposition: 'HUMAN_RELEASE_APPROVED',
        nextStep: 'RELEASE_EXECUTION',
        executionTriggered: false,
        authority: 'HUMAN_EXPLICIT',
      }),
    );
  });

  it('rejects machine identities before touching workflow state', async () => {
    const { service, prisma, workflowRuntime } = buildService();

    await expect(
      service.approve({
        organizationId: ORG,
        workflowRunId: RUN,
        approvedByUserId: USER,
        isMachineIdentity: true,
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.workflowRun.findFirst).not.toHaveBeenCalled();
    expect(workflowRuntime.completeStep).not.toHaveBeenCalled();
  });

  it('fails closed when the workflow is not actively waiting at HUMAN_RELEASE_GATE', async () => {
    const { service, workflowRuntime } = buildService({
      run: {
        id: RUN,
        status: 'RUNNING',
        currentStepType: 'VERIFY',
        correlationId: 'corr-1',
      },
    });

    await expect(
      service.approve({
        organizationId: ORG,
        workflowRunId: RUN,
        approvedByUserId: USER,
        isMachineIdentity: false,
      }),
    ).rejects.toThrow(ConflictException);

    expect(workflowRuntime.completeStep).not.toHaveBeenCalled();
  });

  it('fails closed when no READY gate step exists', async () => {
    const { service, workflowRuntime } = buildService({ step: null });

    await expect(
      service.approve({
        organizationId: ORG,
        workflowRunId: RUN,
        approvedByUserId: USER,
        isMachineIdentity: false,
      }),
    ).rejects.toThrow(ConflictException);

    expect(workflowRuntime.completeStep).not.toHaveBeenCalled();
  });

  it('does not report approval when the runtime transition does not advance to RELEASE_EXECUTION', async () => {
    const { service, auditService } = buildService({
      transition: {
        idempotent: true,
        outcome: null,
      },
    });

    await expect(
      service.approve({
        organizationId: ORG,
        workflowRunId: RUN,
        approvedByUserId: USER,
        isMachineIdentity: false,
      }),
    ).rejects.toThrow(ConflictException);

    expect(auditService.record).not.toHaveBeenCalled();
  });
});
