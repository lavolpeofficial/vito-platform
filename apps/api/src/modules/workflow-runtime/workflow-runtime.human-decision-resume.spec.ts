import { ConflictException } from '@nestjs/common';
import { WorkflowRuntimeService } from './workflow-runtime.service';

describe('WorkflowRuntimeService human-decision resume boundary', () => {
  it('rejects generic resume for HUMAN_DECISION_REQUIRED before opening a transaction', async () => {
    const run = {
      id: 'run-1',
      status: 'BLOCKED',
      currentStepType: null,
      correctionLoopCount: 0,
      maxCorrectionLoops: 3,
      correlationId: 'corr-1',
      blockReasonCode: 'HUMAN_DECISION_REQUIRED',
    };
    const prisma: any = {
      workflowRun: { findFirst: jest.fn().mockResolvedValue(run) },
      $transaction: jest.fn(),
    };
    const auditService: any = { record: jest.fn() };
    const service = new WorkflowRuntimeService(prisma, auditService);

    await expect(service.resumeRun('org-1', run.id)).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
