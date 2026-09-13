import { ConflictException } from '@nestjs/common';
import { AgentExecutionStatus, EngineeringCapability, EngineeringStepType } from '@vito/contracts';
import { WorkflowAl4ReviewCoordinatorService } from './workflow-al4-review-coordinator.service';

function reviewExecution(invocationId: string, verdict = 'A') {
  return {
    status: AgentExecutionStatus.SUCCEEDED,
    invocationId,
    artifactReferences: [`gov://artifacts/${invocationId}`],
    providerExecutionMetadata: {
      stdout: JSON.stringify({ verdict, findings: [] }),
    },
  };
}

describe('WorkflowAl4ReviewCoordinatorService', () => {
  const workflowRunFindFirst = jest.fn();
  const workflowStepFindFirst = jest.fn();
  const taskFindFirst = jest.fn();
  const providerFindFirst = jest.fn();
  const dispatch = jest.fn();
  const capabilityForStep = jest.fn();
  const completeStep = jest.fn();

  const prisma = {
    workflowRun: { findFirst: workflowRunFindFirst },
    workflowStepRun: { findFirst: workflowStepFindFirst },
    task: { findFirst: taskFindFirst },
    agentProvider: { findFirst: providerFindFirst },
  } as any;

  const service = new WorkflowAl4ReviewCoordinatorService(
    prisma,
    { dispatch } as any,
    { capabilityForStep } as any,
    { completeStep } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    workflowRunFindFirst.mockResolvedValue({
      id: 'run-1', taskId: 'task-1', status: 'RUNNING',
      currentStepType: EngineeringStepType.RED_TEAM, assuranceLevel: 'AL4', correlationId: 'corr-1',
    });
    workflowStepFindFirst
      .mockResolvedValueOnce({ id: 'step-red', stepType: EngineeringStepType.RED_TEAM })
      .mockResolvedValueOnce({ metadata: { selectedProviderId: 'provider-builder' } });
    taskFindFirst.mockResolvedValue({ title: 'Build governed change', description: 'Keep authority server-side.' });
    capabilityForStep.mockReturnValue(EngineeringCapability.RED_TEAM);
    providerFindFirst
      .mockResolvedValueOnce({ id: 'provider-builder', modelFamily: 'builder-family' })
      .mockResolvedValueOnce({ id: 'provider-review-1', modelFamily: 'review-family-1' })
      .mockResolvedValueOnce({ id: 'provider-review-2', modelFamily: 'review-family-2' });
    dispatch
      .mockResolvedValueOnce({
        routingDecisionId: 'route-1', selectedProviderId: 'provider-review-1', selectedProviderCode: 'review-1',
        execution: reviewExecution('inv-1'),
      })
      .mockResolvedValueOnce({
        routingDecisionId: 'route-2', selectedProviderId: 'provider-review-2', selectedProviderCode: 'review-2',
        execution: reviewExecution('inv-2'),
      });
    completeStep.mockResolvedValue({ outcome: { kind: 'NEXT_STEP', nextStep: EngineeringStepType.PARSE_VERDICT } });
  });

  it('routes two AL4 reviews with cumulative authoritative independence context', async () => {
    const result = await service.coordinate('org-1', 'run-1');

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0][0].independenceContext).toEqual({
      builderProviderId: 'provider-builder',
      builderModelFamily: 'builder-family',
      previousReviewerProviderIds: [],
      previousReviewerModelFamilies: [],
    });
    expect(dispatch.mock.calls[1][0].independenceContext).toEqual({
      builderProviderId: 'provider-builder',
      builderModelFamily: 'builder-family',
      previousReviewerProviderIds: ['provider-review-1'],
      previousReviewerModelFamilies: ['review-family-1'],
    });
    expect(completeStep).toHaveBeenCalledWith(expect.objectContaining({
      workflowStepRunId: 'step-red',
      stepStatus: 'SUCCEEDED',
      metadata: expect.objectContaining({
        source: 'WORKFLOW_AL4_REVIEW_COORDINATOR',
        reviewProjectionStatus: 'VALID',
        reviewResults: [
          expect.objectContaining({ reviewerExecutionId: 'inv-1', assuranceLevel: 'AL4' }),
          expect.objectContaining({ reviewerExecutionId: 'inv-2', assuranceLevel: 'AL4' }),
        ],
        independenceContext: {
          builderProviderId: 'provider-builder',
          builderModelFamily: 'builder-family',
          previousReviewerProviderIds: ['provider-review-1', 'provider-review-2'],
          previousReviewerModelFamilies: ['review-family-1', 'review-family-2'],
        },
      }),
    }));
    expect(result.disposition).toBe('AL4_REVIEWS_COORDINATED');
  });

  it('fails closed before dispatch when builder model lineage cannot be proven', async () => {
    providerFindFirst.mockReset();
    providerFindFirst.mockResolvedValueOnce({ id: 'provider-builder', modelFamily: null });

    await expect(service.coordinate('org-1', 'run-1')).rejects.toBeInstanceOf(ConflictException);
    expect(dispatch).not.toHaveBeenCalled();
    expect(completeStep).not.toHaveBeenCalled();
  });

  it('fails closed if second reviewer lineage repeats the first model family', async () => {
    providerFindFirst.mockReset();
    providerFindFirst
      .mockResolvedValueOnce({ id: 'provider-builder', modelFamily: 'builder-family' })
      .mockResolvedValueOnce({ id: 'provider-review-1', modelFamily: 'review-family-1' })
      .mockResolvedValueOnce({ id: 'provider-review-2', modelFamily: 'review-family-1' });

    await expect(service.coordinate('org-1', 'run-1')).rejects.toBeInstanceOf(ConflictException);
    expect(completeStep).not.toHaveBeenCalled();
  });
});
