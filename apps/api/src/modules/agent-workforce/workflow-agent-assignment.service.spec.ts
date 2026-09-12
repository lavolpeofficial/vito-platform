import { BadRequestException } from '@nestjs/common';
import { EngineeringStepType } from '@vito/contracts';
import { WorkflowAgentAssignmentService } from './workflow-agent-assignment.service';

describe('WorkflowAgentAssignmentService', () => {
  const workflowFind = jest.fn();
  const employeeFind = jest.fn();
  const queryRaw = jest.fn();
  const tenant = {
    getOrThrow: jest.fn(() => 'org-1'),
    getUserId: jest.fn(() => 'user-1'),
    getAuthenticationMethod: jest.fn(() => 'jwt'),
  };
  const auditRecord = jest.fn().mockResolvedValue(undefined);
  const capabilityForStep = jest.fn((step: EngineeringStepType) =>
    step === EngineeringStepType.BUILD ? 'CODE_BUILD' : null,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tenant.getOrThrow.mockReturnValue('org-1');
    tenant.getUserId.mockReturnValue('user-1');
    tenant.getAuthenticationMethod.mockReturnValue('jwt');
    workflowFind.mockResolvedValue({ id: 'run-1' });
    employeeFind.mockResolvedValue({ id: 'agent-2', code: 'builder-2' });
  });

  function service() {
    return new WorkflowAgentAssignmentService(
      {
        workflowRun: { findFirst: workflowFind },
        digitalEmployee: { findFirst: employeeFind },
        $queryRaw: queryRaw,
      } as any,
      tenant as any,
      { record: auditRecord } as any,
      { capabilityForStep } as any,
    );
  }

  it('human-approves an active capability-eligible agent for one server-owned step capability', async () => {
    queryRaw.mockResolvedValueOnce([{
      id: 'assignment-1',
      organization_id: 'org-1',
      workflow_run_id: 'run-1',
      step_type: 'BUILD',
      capability_code: 'CODE_BUILD',
      digital_employee_id: 'agent-2',
      status: 'APPROVED',
      approved_by_user_id: 'user-1',
      approval_ref: 'change-42',
      created_at: new Date(),
      updated_at: new Date(),
    }]);

    const result = await service().approve({
      workflowRunId: 'run-1',
      stepType: EngineeringStepType.BUILD,
      digitalEmployeeId: 'agent-2',
      approvalRef: 'change-42',
    });

    expect(capabilityForStep).toHaveBeenCalledWith(EngineeringStepType.BUILD);
    expect(employeeFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'agent-2',
        organizationId: 'org-1',
        status: 'ACTIVE',
        capabilities: {
          some: {
            isEnabled: true,
            capability: { organizationId: 'org-1', code: 'CODE_BUILD' },
          },
        },
      }),
    }));
    expect(result.capabilityCode).toBe('CODE_BUILD');
    expect(result.digitalEmployeeId).toBe('agent-2');
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'WORKFLOW_AGENT_ASSIGNMENT_APPROVED',
      actorType: 'USER',
    }));
  });

  it('does not assign governance-boundary steps to agents', async () => {
    await expect(service().approve({
      workflowRunId: 'run-1',
      stepType: EngineeringStepType.HUMAN_RELEASE_GATE,
      digitalEmployeeId: 'agent-2',
      approvalRef: 'change-42',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(employeeFind).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('requires authenticated human governance', async () => {
    tenant.getAuthenticationMethod.mockReturnValueOnce('machine');
    tenant.getUserId.mockReturnValueOnce(null as any);
    await expect(service().approve({
      workflowRunId: 'run-1',
      stepType: EngineeringStepType.BUILD,
      digitalEmployeeId: 'agent-2',
      approvalRef: 'change-42',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(workflowFind).not.toHaveBeenCalled();
  });

  it('rejects agents without the exact enabled server-owned capability', async () => {
    employeeFind.mockResolvedValueOnce(null);
    await expect(service().approve({
      workflowRunId: 'run-1',
      stepType: EngineeringStepType.BUILD,
      digitalEmployeeId: 'agent-wrong',
      approvalRef: 'change-42',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
