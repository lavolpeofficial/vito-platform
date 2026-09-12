import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EngineeringCapability } from '@vito/contracts';
import { WorkflowExecutionIdentityService } from './workflow-execution-identity.service';

describe('WorkflowExecutionIdentityService', () => {
  const findUniqueStep = jest.fn();
  const findTask = jest.fn();
  const findDigitalEmployee = jest.fn();
  const resolveAndBind = jest.fn();
  const resolveApprovedAssignment = jest.fn();
  const prisma = {
    workflowStepRun: { findUnique: findUniqueStep },
    task: { findFirst: findTask },
    digitalEmployee: { findFirst: findDigitalEmployee },
  } as any;

  const legacyService = new WorkflowExecutionIdentityService(
    prisma,
    { resolveAndBind } as any,
  );
  const assignmentAwareService = new WorkflowExecutionIdentityService(
    prisma,
    { resolveAndBind } as any,
    { resolveApproved: resolveApprovedAssignment } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resolveAndBind.mockResolvedValue({ capabilityCode: EngineeringCapability.CODE_BUILD });
    resolveApprovedAssignment.mockResolvedValue(null);
  });

  it('preserves synthetic non-workflow correlation IDs as a compatibility path', async () => {
    findUniqueStep.mockResolvedValue(null);
    await expect(legacyService.resolve('org-1', 'synthetic-run', 'synthetic-step')).resolves.toBeNull();
    expect(findTask).not.toHaveBeenCalled();
    expect(resolveAndBind).not.toHaveBeenCalled();
  });

  it('resolves a persisted workflow to server-owned DigitalEmployee and capability identity', async () => {
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

    await expect(legacyService.resolve('org-1', 'run-1', 'step-1')).resolves.toEqual({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      stepType: 'BUILD',
      capabilityCode: EngineeringCapability.CODE_BUILD,
      attemptNumber: 2,
      assuranceLevel: 'AL-4',
      correlationId: 'corr-persisted',
    });
    expect(resolveAndBind).toHaveBeenCalledWith('org-1', 'run-1', 'BUILD');
    expect(findTask).toHaveBeenCalledWith({
      where: { id: 'task-1', organizationId: 'org-1' },
      select: { id: true, assignedDigitalEmployeeId: true },
    });
    expect(findDigitalEmployee).toHaveBeenCalledWith({
      where: { id: 'agent-1', organizationId: 'org-1' },
      select: { id: true, status: true },
    });
  });

  it('uses an approved persisted step assignment before the legacy task assignment', async () => {
    findUniqueStep.mockResolvedValue({
      id: 'step-1',
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      stepType: 'BUILD',
      attemptNumber: 1,
      workflowRun: {
        id: 'run-1',
        organizationId: 'org-1',
        taskId: 'task-1',
        assuranceLevel: 'AL-4',
        correlationId: 'corr-persisted',
      },
    });
    resolveApprovedAssignment.mockResolvedValue({
      id: 'assignment-1',
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      stepType: 'BUILD',
      capabilityCode: EngineeringCapability.CODE_BUILD,
      digitalEmployeeId: 'agent-2',
      status: 'APPROVED',
      approvedByUserId: 'user-1',
      approvalRef: 'change-42',
    });
    findTask.mockResolvedValue({ id: 'task-1', assignedDigitalEmployeeId: 'agent-legacy' });
    findDigitalEmployee.mockResolvedValue({ id: 'agent-2', status: 'ACTIVE' });

    const identity = await assignmentAwareService.resolve('org-1', 'run-1', 'step-1');

    expect(resolveApprovedAssignment).toHaveBeenCalledWith('org-1', 'run-1', 'BUILD');
    expect(identity?.agentId).toBe('agent-2');
    expect(identity?.capabilityCode).toBe(EngineeringCapability.CODE_BUILD);
    expect(findDigitalEmployee).toHaveBeenCalledWith({
      where: { id: 'agent-2', organizationId: 'org-1' },
      select: { id: true, status: true },
    });
  });

  it('rejects an approved assignment whose capability no longer matches the server-owned plan', async () => {
    findUniqueStep.mockResolvedValue({
      id: 'step-1',
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      stepType: 'BUILD',
      attemptNumber: 1,
      workflowRun: {
        id: 'run-1',
        organizationId: 'org-1',
        taskId: 'task-1',
        assuranceLevel: 'AL-4',
        correlationId: 'corr-persisted',
      },
    });
    resolveApprovedAssignment.mockResolvedValue({
      id: 'assignment-1',
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      stepType: 'BUILD',
      capabilityCode: EngineeringCapability.TEST_EXECUTION,
      digitalEmployeeId: 'agent-2',
      status: 'APPROVED',
      approvedByUserId: 'user-1',
      approvalRef: 'change-42',
    });

    await expect(assignmentAwareService.resolve('org-1', 'run-1', 'step-1'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(findTask).not.toHaveBeenCalled();
  });

  it('rejects an inactive DigitalEmployee from an explicit approved step assignment', async () => {
    findUniqueStep.mockResolvedValue({
      id: 'step-1',
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      stepType: 'BUILD',
      attemptNumber: 1,
      workflowRun: {
        id: 'run-1',
        organizationId: 'org-1',
        taskId: 'task-1',
        assuranceLevel: 'AL-4',
        correlationId: 'corr-persisted',
      },
    });
    resolveApprovedAssignment.mockResolvedValue({
      id: 'assignment-1',
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      stepType: 'BUILD',
      capabilityCode: EngineeringCapability.CODE_BUILD,
      digitalEmployeeId: 'agent-2',
      status: 'APPROVED',
      approvedByUserId: 'user-1',
      approvalRef: 'change-42',
    });
    findTask.mockResolvedValue({ id: 'task-1', assignedDigitalEmployeeId: 'agent-legacy' });
    findDigitalEmployee.mockResolvedValue({ id: 'agent-2', status: 'PAUSED' });

    await expect(assignmentAwareService.resolve('org-1', 'run-1', 'step-1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a persisted workflow step from another tenant before plan resolution', async () => {
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
    await expect(legacyService.resolve('org-1', 'run-foreign', 'step-foreign'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(resolveAndBind).not.toHaveBeenCalled();
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
    await expect(legacyService.resolve('org-1', 'wrong-run', 'step-1'))
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
    await expect(legacyService.resolve('org-1', 'run-1', 'step-1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
