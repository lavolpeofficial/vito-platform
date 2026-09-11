import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkflowExecutionIdentityService } from './workflow-execution-identity.service';

describe('WorkflowExecutionIdentityService', () => {
  const findUniqueStep = jest.fn();
  const findTask = jest.fn();
  const findDigitalEmployee = jest.fn();
  const prisma = {
    workflowStepRun: { findUnique: findUniqueStep },
    task: { findFirst: findTask },
    digitalEmployee: { findFirst: findDigitalEmployee },
  } as any;

  const service = new WorkflowExecutionIdentityService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('preserves synthetic non-workflow correlation IDs as a compatibility path', async () => {
    findUniqueStep.mockResolvedValue(null);
    await expect(service.resolve('org-1', 'synthetic-run', 'synthetic-step')).resolves.toBeNull();
    expect(findTask).not.toHaveBeenCalled();
  });

  it('resolves a persisted workflow to its server-owned DigitalEmployee identity', async () => {
    findUniqueStep.mockResolvedValue({
      id: 'step-1',
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      stepType: 'BUILD',
      attemptNumber: 2,
      workflowRun: {
        id: 'run-1',
        organizationId: 'org-1',
        taskId: 'task-1',
        assuranceLevel: 'AL-4',
        correlationId: 'corr-persisted',
      },
    });
    findTask.mockResolvedValue({ id: 'task-1', assignedDigitalEmployeeId: 'agent-1' });
    findDigitalEmployee.mockResolvedValue({ id: 'agent-1' });

    await expect(service.resolve('org-1', 'run-1', 'step-1')).resolves.toEqual({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      stepType: 'BUILD',
      attemptNumber: 2,
      assuranceLevel: 'AL-4',
      correlationId: 'corr-persisted',
    });
    expect(findTask).toHaveBeenCalledWith({
      where: { id: 'task-1', organizationId: 'org-1' },
      select: { id: true, assignedDigitalEmployeeId: true },
    });
    expect(findDigitalEmployee).toHaveBeenCalledWith({
      where: { id: 'agent-1', organizationId: 'org-1' },
      select: { id: true },
    });
  });

  it('rejects a persisted workflow step from another tenant', async () => {
    findUniqueStep.mockResolvedValue({
      id: 'step-foreign',
      organizationId: 'org-2',
      workflowRunId: 'run-foreign',
      stepType: 'BUILD',
      attemptNumber: 1,
      workflowRun: {
        id: 'run-foreign',
        organizationId: 'org-2',
        taskId: 'task-foreign',
        assuranceLevel: 'AL-3',
        correlationId: 'corr-foreign',
      },
    });
    await expect(service.resolve('org-1', 'run-foreign', 'step-foreign'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects mismatched run/step identity and persisted workflows without a DigitalEmployee task assignment', async () => {
    findUniqueStep.mockResolvedValueOnce({
      id: 'step-1',
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      stepType: 'BUILD',
      attemptNumber: 1,
      workflowRun: {
        id: 'run-1',
        organizationId: 'org-1',
        taskId: 'task-1',
        assuranceLevel: 'AL-3',
        correlationId: 'corr-1',
      },
    });
    await expect(service.resolve('org-1', 'wrong-run', 'step-1'))
      .rejects.toBeInstanceOf(BadRequestException);

    findUniqueStep.mockResolvedValueOnce({
      id: 'step-1',
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      stepType: 'BUILD',
      attemptNumber: 1,
      workflowRun: {
        id: 'run-1',
        organizationId: 'org-1',
        taskId: 'task-1',
        assuranceLevel: 'AL-3',
        correlationId: 'corr-1',
      },
    });
    findTask.mockResolvedValueOnce({ id: 'task-1', assignedDigitalEmployeeId: null });
    await expect(service.resolve('org-1', 'run-1', 'step-1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
