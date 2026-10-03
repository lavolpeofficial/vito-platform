import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { LoopExhaustedTestRecoveryService } from './loop-exhausted-test-recovery.service';

const ORG = 'org-1';
const RUN = 'run-1';
const USER = 'user-1';
const CORRECTION = 'correction-1';
const TEST = 'test-recovery-1';
const APPROVAL = 'FREIGABE GOLDEN RECOVERY #151';

function buildService(overrides: {
  run?: any;
  correctionStep?: any;
  staleSteps?: any[];
  claimCount?: number;
  cancelledCount?: number;
} = {}) {
  const run = overrides.run ?? {
    id: RUN,
    status: 'BLOCKED',
    currentStepType: null,
    correctionLoopCount: 3,
    maxCorrectionLoops: 3,
    correlationId: 'corr-1',
    blockReasonCode: 'LOOP_EXHAUSTED',
  };
  const correctionStep = Object.prototype.hasOwnProperty.call(overrides, 'correctionStep')
    ? overrides.correctionStep
    : { id: CORRECTION };
  const staleSteps = overrides.staleSteps ?? [
    { id: 'stale-test-1', stepType: 'TEST', status: 'WAITING' },
    { id: 'stale-correction-1', stepType: 'CORRECTION', status: 'READY' },
    { id: 'stale-test-2', stepType: 'TEST', status: 'READY' },
  ];
  const tx: any = {
    workflowRun: {
      findFirst: jest.fn().mockResolvedValue(run),
      updateMany: jest.fn().mockResolvedValue({ count: overrides.claimCount ?? 1 }),
    },
    workflowStepRun: {
      findFirst: jest.fn().mockResolvedValue(correctionStep),
      findMany: jest.fn().mockResolvedValue(staleSteps),
      updateMany: jest.fn().mockResolvedValue({ count: overrides.cancelledCount ?? staleSteps.length }),
      create: jest.fn().mockResolvedValue({ id: TEST }),
    },
  };
  const prisma: any = { $transaction: jest.fn((fn: (client: any) => unknown) => fn(tx)) };
  const auditService: any = { record: jest.fn().mockResolvedValue(undefined) };
  return { service: new LoopExhaustedTestRecoveryService(prisma, auditService), prisma, tx, auditService, staleSteps };
}

describe('LoopExhaustedTestRecoveryService', () => {
  it('creates one fresh READY TEST from the latest succeeded CORRECTION without resetting the loop counter or triggering execution', async () => {
    const { service, tx, auditService, staleSteps } = buildService();
    const result = await service.recover({
      organizationId: ORG,
      workflowRunId: RUN,
      approvedByUserId: USER,
      isMachineIdentity: false,
      approvalRef: APPROVAL,
    });

    expect(tx.workflowRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: RUN,
        organizationId: ORG,
        status: 'BLOCKED',
        currentStepType: null,
        blockReasonCode: 'LOOP_EXHAUSTED',
        correctionLoopCount: 3,
      }),
      data: {
        status: 'RUNNING',
        currentStepType: 'TEST',
        blockReasonCode: null,
        failureReasonCode: null,
      },
    });
    expect(tx.workflowStepRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: staleSteps.map((step) => step.id) } }),
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
    expect(tx.workflowStepRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        workflowRunId: RUN,
        stepType: 'TEST',
        status: 'READY',
        attemptNumber: 1,
        causationId: CORRECTION,
        metadata: expect.objectContaining({
          approvalRef: APPROVAL,
          preservedCorrectionLoopCount: 3,
          executionLimit: 1,
          authorizedExecutionStep: 'TEST',
        }),
      }),
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'USER', actorId: USER, action: 'LOOP_EXHAUSTED_TEST_RECOVERY_REQUESTED' }),
      tx,
    );
    expect(result).toEqual(expect.objectContaining({
      disposition: 'LOOP_EXHAUSTED_TEST_RECOVERY_CREATED',
      workflowStepRunId: TEST,
      causationId: CORRECTION,
      correctionLoopCount: 3,
      maxCorrectionLoops: 3,
      executionTriggered: false,
      authority: 'HUMAN_EXPLICIT',
    }));
  });

  it('rejects machine identities before opening a transaction', async () => {
    const { service, prisma } = buildService();
    await expect(service.recover({
      organizationId: ORG,
      workflowRunId: RUN,
      approvedByUserId: USER,
      isMachineIdentity: true,
      approvalRef: APPROVAL,
    })).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires a bounded non-empty approvalRef', async () => {
    const { service, prisma } = buildService();
    await expect(service.recover({
      organizationId: ORG,
      workflowRunId: RUN,
      approvedByUserId: USER,
      isMachineIdentity: false,
      approvalRef: '',
    })).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed unless the run is exactly BLOCKED by LOOP_EXHAUSTED at the correction limit', async () => {
    const { service, tx } = buildService({
      run: {
        id: RUN,
        status: 'BLOCKED',
        currentStepType: null,
        correctionLoopCount: 2,
        maxCorrectionLoops: 3,
        correlationId: 'corr-1',
        blockReasonCode: 'LOOP_EXHAUSTED',
      },
    });
    await expect(service.recover({
      organizationId: ORG, workflowRunId: RUN, approvedByUserId: USER,
      isMachineIdentity: false, approvalRef: APPROVAL,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowRun.updateMany).not.toHaveBeenCalled();
  });

  it('requires a succeeded CORRECTION causation source', async () => {
    const { service, tx } = buildService({ correctionStep: null });
    await expect(service.recover({
      organizationId: ORG, workflowRunId: RUN, approvedByUserId: USER,
      isMachineIdentity: false, approvalRef: APPROVAL,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowRun.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed if the atomic run claim is lost', async () => {
    const { service, tx } = buildService({ claimCount: 0 });
    await expect(service.recover({
      organizationId: ORG, workflowRunId: RUN, approvedByUserId: USER,
      isMachineIdentity: false, approvalRef: APPROVAL,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowStepRun.create).not.toHaveBeenCalled();
  });

  it('fails closed if any stale nonterminal step escapes cancellation', async () => {
    const { service, tx } = buildService({ cancelledCount: 2 });
    await expect(service.recover({
      organizationId: ORG, workflowRunId: RUN, approvedByUserId: USER,
      isMachineIdentity: false, approvalRef: APPROVAL,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowStepRun.create).not.toHaveBeenCalled();
  });
});
