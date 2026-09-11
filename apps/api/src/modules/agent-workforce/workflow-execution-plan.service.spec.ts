import { BadRequestException, ConflictException } from '@nestjs/common';
import { EngineeringCapability, EngineeringStepType } from '@vito/contracts';
import { WorkflowExecutionPlanService } from './workflow-execution-plan.service';

describe('WorkflowExecutionPlanService', () => {
  const queryRaw = jest.fn();
  const executeRaw = jest.fn();
  const prisma = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
  } as any;

  const service = new WorkflowExecutionPlanService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    executeRaw.mockResolvedValue(1);
  });

  it('maps only server-owned provider-independent engineering capabilities', () => {
    expect(service.capabilityForStep(EngineeringStepType.PLAN)).toBe(EngineeringCapability.CODE_PLAN);
    expect(service.capabilityForStep(EngineeringStepType.BUILD)).toBe(EngineeringCapability.CODE_BUILD);
    expect(service.capabilityForStep(EngineeringStepType.TEST)).toBe(EngineeringCapability.TEST_EXECUTION);
    expect(service.capabilityForStep(EngineeringStepType.PACKAGE)).toBe(EngineeringCapability.REVIEW_PACKAGE);
    expect(service.capabilityForStep(EngineeringStepType.RED_TEAM)).toBe(EngineeringCapability.RED_TEAM);
    expect(service.capabilityForStep(EngineeringStepType.CORRECTION)).toBe(EngineeringCapability.CODE_BUILD);
    expect(service.capabilityForStep(EngineeringStepType.VERIFY)).toBe(EngineeringCapability.RELEASE_VERIFICATION);
    expect(service.capabilityForStep(EngineeringStepType.REMOTE_VERIFY)).toBe(EngineeringCapability.RELEASE_VERIFICATION);
    expect(service.capabilityForStep(EngineeringStepType.HUMAN_RELEASE_GATE)).toBeNull();
    expect(service.capabilityForStep(EngineeringStepType.RELEASE_EXECUTION)).toBeNull();
    expect(service.capabilityForStep(EngineeringStepType.PARSE_VERDICT)).toBeNull();
  });

  it('returns an existing immutable binding without rewriting it', async () => {
    queryRaw.mockResolvedValueOnce([
      {
        organizationId: 'org-1',
        workflowRunId: 'run-1',
        stepType: EngineeringStepType.BUILD,
        capabilityCode: EngineeringCapability.CODE_BUILD,
      },
    ]);

    await expect(
      service.resolveAndBind('org-1', 'run-1', EngineeringStepType.BUILD),
    ).resolves.toEqual({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      stepType: EngineeringStepType.BUILD,
      capabilityCode: EngineeringCapability.CODE_BUILD,
    });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('persists the server-owned mapping when no binding exists yet', async () => {
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          organizationId: 'org-1',
          workflowRunId: 'run-1',
          stepType: EngineeringStepType.TEST,
          capabilityCode: EngineeringCapability.TEST_EXECUTION,
        },
      ]);

    const result = await service.resolveAndBind('org-1', 'run-1', EngineeringStepType.TEST);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(result.capabilityCode).toBe(EngineeringCapability.TEST_EXECUTION);
  });

  it('fails closed when persisted data conflicts with the server-owned mapping', async () => {
    queryRaw.mockResolvedValueOnce([
      {
        organizationId: 'org-1',
        workflowRunId: 'run-1',
        stepType: EngineeringStepType.BUILD,
        capabilityCode: EngineeringCapability.RED_TEAM,
      },
    ]);

    await expect(
      service.resolveAndBind('org-1', 'run-1', EngineeringStepType.BUILD),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not invent capabilities for non-agent workflow steps', async () => {
    await expect(
      service.resolveAndBind('org-1', 'run-1', EngineeringStepType.HUMAN_RELEASE_GATE),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
