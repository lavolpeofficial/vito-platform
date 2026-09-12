import { NotFoundException } from '@nestjs/common';
import { WorkflowObserverService } from './workflow-observer.service';

describe('WorkflowObserverService', () => {
  const workflowRun = {
    findFirst: jest.fn(),
  };
  const auditEvent = {
    findMany: jest.fn(),
  };
  const prisma = { workflowRun, auditEvent } as any;
  const service = new WorkflowObserverService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a tenant-scoped read-only snapshot and bounded timeline', async () => {
    const startedAt = new Date('2026-09-12T05:00:00.000Z');
    workflowRun.findFirst.mockResolvedValue({
      id: 'run-1',
      organizationId: 'org-1',
      correlationId: 'corr-1',
      status: 'RUNNING',
      currentStepType: 'TEST',
      blockReasonCode: null,
      failureReasonCode: null,
      correctionLoopCount: 0,
      maxCorrectionLoops: 3,
      startedAt,
      completedAt: null,
      stepRuns: [
        {
          id: 'step-1',
          stepType: 'TEST',
          status: 'READY',
          attemptNumber: 1,
          causationId: null,
          startedAt,
          finishedAt: null,
        },
      ],
    });
    auditEvent.findMany.mockResolvedValue([
      {
        id: 'event-1',
        actorType: 'SYSTEM',
        actorId: null,
        action: 'WORKFLOW_STEP_ACTIVATED',
        entityType: 'WorkflowStepRun',
        entityId: 'step-1',
        metadata: {},
        createdAt: startedAt,
      },
    ]);

    const result = await service.observe('org-1', 'run-1');

    expect(workflowRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run-1', organizationId: 'org-1' } }),
    );
    expect(auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-1',
          entityId: { in: ['run-1', 'step-1'] },
        },
        take: 200,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        workflowRunId: 'run-1',
        organizationId: 'org-1',
        boundary: 'ACTIVE',
        nextAction: 'EXECUTE_CURRENT_STEP',
        authority: 'READ_ONLY',
        timelineTruncated: false,
      }),
    );
  });

  it('classifies provider blocks as an explicit resume boundary without mutating the run', async () => {
    workflowRun.findFirst.mockResolvedValue({
      id: 'run-2',
      organizationId: 'org-1',
      correlationId: 'corr-2',
      status: 'BLOCKED',
      currentStepType: 'BUILD',
      blockReasonCode: 'PROVIDER_BLOCKED',
      failureReasonCode: null,
      correctionLoopCount: 0,
      maxCorrectionLoops: 3,
      startedAt: new Date(),
      completedAt: null,
      stepRuns: [],
    });
    auditEvent.findMany.mockResolvedValue([]);

    const result = await service.observe('org-1', 'run-2');

    expect(result.boundary).toBe('BLOCKED');
    expect(result.nextAction).toBe('RESUME_RUN');
  });

  it('fails closed when the workflow is not visible in the tenant', async () => {
    workflowRun.findFirst.mockResolvedValue(null);

    await expect(service.observe('org-2', 'run-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(auditEvent.findMany).not.toHaveBeenCalled();
  });
});
