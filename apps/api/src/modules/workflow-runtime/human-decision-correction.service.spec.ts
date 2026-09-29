import { ConflictException, ForbiddenException } from '@nestjs/common';
import { HumanDecisionCorrectionService } from './human-decision-correction.service';

const ORG = 'org-1';
const RUN = 'run-1';
const USER = 'user-1';
const PARSE = 'parse-1';
const CORRECTION = 'correction-1';

function buildService(overrides: {
  run?: any;
  parseStep?: any;
  claimCount?: number;
} = {}) {
  const run = overrides.run ?? {
    id: RUN,
    status: 'BLOCKED',
    currentStepType: null,
    correctionLoopCount: 0,
    maxCorrectionLoops: 3,
    correlationId: 'corr-1',
    blockReasonCode: 'HUMAN_DECISION_REQUIRED',
  };
  const parseStep = Object.prototype.hasOwnProperty.call(overrides, 'parseStep')
    ? overrides.parseStep
    : {
        id: PARSE,
        metadata: { source: 'WORKFLOW_REVIEW_VERDICT_RUNTIME', verdict: 'D' },
      };
  const tx: any = {
    workflowRun: {
      findFirst: jest.fn().mockResolvedValue(run),
      updateMany: jest.fn().mockResolvedValue({ count: overrides.claimCount ?? 1 }),
    },
    workflowStepRun: {
      findFirst: jest.fn().mockResolvedValue(parseStep),
      create: jest.fn().mockResolvedValue({ id: CORRECTION }),
    },
  };
  const prisma: any = {
    $transaction: jest.fn((fn: (client: any) => unknown) => fn(tx)),
  };
  const auditService: any = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new HumanDecisionCorrectionService(prisma, auditService),
    tx,
    prisma,
    auditService,
  };
}

describe('HumanDecisionCorrectionService', () => {
  it('atomically converts HUMAN_DECISION_REQUIRED into one READY CORRECTION step', async () => {
    const { service, tx, auditService } = buildService();

    const result = await service.requestCorrection({
      organizationId: ORG,
      workflowRunId: RUN,
      decidedByUserId: USER,
      isMachineIdentity: false,
    });

    expect(tx.workflowRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: RUN,
        organizationId: ORG,
        status: 'BLOCKED',
        currentStepType: null,
        blockReasonCode: 'HUMAN_DECISION_REQUIRED',
        correctionLoopCount: 0,
      }),
      data: {
        status: 'RUNNING',
        currentStepType: 'CORRECTION',
        blockReasonCode: null,
        correctionLoopCount: { increment: 1 },
      },
    });
    expect(tx.workflowStepRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        workflowRunId: RUN,
        stepType: 'CORRECTION',
        status: 'READY',
        attemptNumber: 1,
        causationId: PARSE,
      }),
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'USER',
        actorId: USER,
        action: 'HUMAN_DECISION_CORRECTION_REQUESTED',
      }),
      tx,
    );
    expect(result).toEqual(expect.objectContaining({
      disposition: 'HUMAN_DECISION_CORRECTION_CREATED',
      workflowStepRunId: CORRECTION,
      causationId: PARSE,
      nextStep: 'CORRECTION',
      correctionLoopCount: 1,
      executionTriggered: false,
      authority: 'HUMAN_EXPLICIT',
    }));
  });

  it('rejects machine identities before opening a transaction', async () => {
    const { service, prisma } = buildService();
    await expect(service.requestCorrection({
      organizationId: ORG, workflowRunId: RUN, decidedByUserId: USER, isMachineIdentity: true,
    })).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed for any block reason other than HUMAN_DECISION_REQUIRED', async () => {
    const { service, tx } = buildService({
      run: {
        id: RUN, status: 'BLOCKED', currentStepType: null, correctionLoopCount: 0,
        maxCorrectionLoops: 3, correlationId: 'corr-1', blockReasonCode: 'PROVIDER_BLOCKED',
      },
    });
    await expect(service.requestCorrection({
      organizationId: ORG, workflowRunId: RUN, decidedByUserId: USER, isMachineIdentity: false,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowRun.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed when the correction limit is exhausted', async () => {
    const { service, tx } = buildService({
      run: {
        id: RUN, status: 'BLOCKED', currentStepType: null, correctionLoopCount: 3,
        maxCorrectionLoops: 3, correlationId: 'corr-1', blockReasonCode: 'HUMAN_DECISION_REQUIRED',
      },
    });
    await expect(service.requestCorrection({
      organizationId: ORG, workflowRunId: RUN, decidedByUserId: USER, isMachineIdentity: false,
    })).rejects.toThrow('LOOP_EXHAUSTED');
    expect(tx.workflowRun.updateMany).not.toHaveBeenCalled();
  });

  it('requires an authoritative succeeded PARSE_VERDICT predecessor', async () => {
    const { service, tx } = buildService({ parseStep: null });
    await expect(service.requestCorrection({
      organizationId: ORG, workflowRunId: RUN, decidedByUserId: USER, isMachineIdentity: false,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowRun.updateMany).not.toHaveBeenCalled();
  });

  it('rejects PARSE_VERDICT metadata from an untrusted source', async () => {
    const { service, tx } = buildService({
      parseStep: { id: PARSE, metadata: { source: 'MANUAL_OVERRIDE', verdict: 'D' } },
    });
    await expect(service.requestCorrection({
      organizationId: ORG, workflowRunId: RUN, decidedByUserId: USER, isMachineIdentity: false,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowRun.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a non-D persisted verdict when a verdict projection is present', async () => {
    const { service, tx } = buildService({
      parseStep: { id: PARSE, metadata: { source: 'WORKFLOW_REVIEW_VERDICT_RUNTIME', verdict: 'C' } },
    });
    await expect(service.requestCorrection({
      organizationId: ORG, workflowRunId: RUN, decidedByUserId: USER, isMachineIdentity: false,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowRun.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed if the atomic state claim is lost', async () => {
    const { service, tx } = buildService({ claimCount: 0 });
    await expect(service.requestCorrection({
      organizationId: ORG, workflowRunId: RUN, decidedByUserId: USER, isMachineIdentity: false,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowStepRun.create).not.toHaveBeenCalled();
  });
});
