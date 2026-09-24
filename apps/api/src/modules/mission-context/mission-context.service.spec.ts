import { NotFoundException } from '@nestjs/common';

import { MissionContextService } from './mission-context.service';

describe('MissionContextService', () => {
  const workflowRun = {
    findFirst: jest.fn(),
  };
  const task = {
    findFirst: jest.fn(),
  };
  const auditEvent = {
    findMany: jest.fn(),
  };
  const queryRaw = jest.fn();

  const service = new MissionContextService({
    workflowRun,
    task,
    auditEvent,
    $queryRaw: queryRaw,
  } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    workflowRun.findFirst.mockResolvedValue({
      id: 'run-1',
      organizationId: 'org-1',
      taskId: 'task-1',
      workflowDefinitionCode: 'ENGINEERING_CHANGE',
      workflowDefinitionVersion: '1',
      assuranceLevel: 'AL4',
      status: 'RUNNING',
      currentStepType: 'TEST',
      correctionLoopCount: 1,
      maxCorrectionLoops: 3,
      blockReasonCode: null,
      failureReasonCode: null,
      stepRuns: [
        { id: 'step-1', stepType: 'PLAN', status: 'SUCCEEDED', attemptNumber: 1, causationId: null, startedAt: new Date(), finishedAt: new Date() },
        { id: 'step-2', stepType: 'TEST', status: 'READY', attemptNumber: 1, causationId: 'step-1', startedAt: new Date(), finishedAt: null },
      ],
    });
    task.findFirst.mockResolvedValue({
      id: 'task-1',
      title: 'Ship VITO safely',
      description: 'Finish the bounded VITO release candidate.',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignedDigitalEmployeeId: 'agent-1',
    });
    auditEvent.findMany.mockResolvedValue([
      { id: 'audit-1', actorType: 'SYSTEM', actorId: null, action: 'WORKFLOW_STEP_ACTIVATED', entityType: 'WorkflowStepRun', entityId: 'step-2', createdAt: new Date('2026-09-24T08:00:00Z') },
    ]);
    queryRaw.mockResolvedValue([
      { id: 'memory-1', kind: 'ORGANIZATIONAL', title: 'Release rule', sourceType: 'POLICY', sourceRef: 'policy-1', confidence: 1, createdAt: new Date() },
    ]);
  });

  it('projects one tenant-scoped workflow into a bounded advisory mission context', async () => {
    const result = await service.snapshot('org-1', 'run-1');

    expect(workflowRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-1', organizationId: 'org-1' },
    }));
    expect(result.missionId).toBe('run-1');
    expect(result.objective).toBe('Finish the bounded VITO release candidate.');
    expect(result.progress.completedSteps).toEqual(['PLAN']);
    expect(result.workflow.currentStepType).toBe('TEST');
    expect(result.memoryRefs).toEqual([expect.objectContaining({ id: 'memory-1', sourceType: 'POLICY' })]);
    expect(result.authority).toBe('ADVISORY_CONTEXT');
    expect(result.semantics.contextIsAuthority).toBe(false);
    expect(result.semantics.memoryCanOverrideGovernance).toBe(false);
  });

  it('fails closed across tenant boundaries', async () => {
    workflowRun.findFirst.mockResolvedValueOnce(null);

    await expect(service.snapshot('org-other', 'run-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(task.findFirst).not.toHaveBeenCalled();
    expect(auditEvent.findMany).not.toHaveBeenCalled();
  });
});
