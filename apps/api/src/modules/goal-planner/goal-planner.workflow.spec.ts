import { EngineeringStepType } from '@vito/contracts';
import { GoalPlannerService } from './goal-planner.service';

describe('GoalPlannerService governed workflow bridge', () => {
  const capabilityForStep = jest.fn((step: EngineeringStepType) => {
    if ([EngineeringStepType.PARSE_VERDICT, EngineeringStepType.HUMAN_RELEASE_GATE, EngineeringStepType.RELEASE_EXECUTION].includes(step)) return null;
    return `CAP_${step}`;
  });
  const search = jest.fn().mockResolvedValue([]);
  const createTask = jest.fn().mockResolvedValue({
    id: 'task-1',
    title: 'Ship governed engineering workflow',
    status: 'OPEN',
  });
  const updateTask = jest.fn();
  const createRun = jest.fn().mockResolvedValue({
    id: 'run-1',
    taskId: 'task-1',
    status: 'CREATED',
    assuranceLevel: 'AL4',
    workflowDefinitionCode: 'ENGINEERING_CHANGE',
    workflowDefinitionVersion: '1',
  });

  const service = new GoalPlannerService(
    { capabilityForStep } as any,
    { search } as any,
    undefined,
    { create: createTask, update: updateTask } as any,
    { createRun } as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('creates task identity and a CREATED governed workflow without starting or granting execution authority', async () => {
    const result = await service.materializeEngineeringWorkflow(
      'org-1',
      'Ship governed engineering workflow safely and preserve human release control.',
      'AL4',
    );

    expect(createTask).toHaveBeenCalledWith('org-1', expect.objectContaining({
      description: 'Ship governed engineering workflow safely and preserve human release control.',
    }));
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1',
      taskId: 'task-1',
      workflowDefinitionCode: 'ENGINEERING_CHANGE',
      workflowDefinitionVersion: '1',
      assuranceLevel: 'AL4',
      maxCorrectionLoops: 3,
    }));
    expect(result.workflowRun.status).toBe('CREATED');
    expect(result.started).toBe(false);
    expect(result.executionAuthorityGranted).toBe(false);
    expect(result.providerSelection).toBe('DEFERRED_TO_PROVIDER_ROUTER');
    expect(result.requiresHumanReleaseApproval).toBe(true);
    expect(result.nextAction).toBe('START_GOVERNED_WORKFLOW');
  });

  it('cancels the created task if workflow creation fails', async () => {
    createRun.mockRejectedValueOnce(new Error('workflow persistence failed'));
    updateTask.mockResolvedValueOnce({ id: 'task-1', status: 'CANCELLED' });

    await expect(service.materializeEngineeringWorkflow(
      'org-1',
      'Create a governed workflow while preserving failure compensation boundaries.',
    )).rejects.toThrow('workflow persistence failed');

    expect(updateTask).toHaveBeenCalledWith('org-1', 'task-1', { status: 'CANCELLED' });
  });
});
