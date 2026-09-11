import { RuntimeOutcomeEvaluationService } from './runtime-outcome-evaluation.service';

describe('RuntimeOutcomeEvaluationService', () => {
  const auditRecord = jest.fn();
  const experienceExists = jest.fn();
  const create = jest.fn();
  const listForExperience = jest.fn();
  const markExperienceEvaluated = jest.fn();

  const service = new RuntimeOutcomeEvaluationService(
    { record: auditRecord } as any,
    { experienceExists, create, listForExperience, markExperienceEvaluated } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    experienceExists.mockResolvedValue(true);
    listForExperience.mockResolvedValue([]);
    create.mockImplementation(async (_org: string, input: any) => ({
      id: 'outcome-1',
      organizationId: 'org-1',
      ...input,
      expectedValue: input.expectedValue ?? null,
      confidence: input.confidence ?? null,
      evaluatorId: null,
      evaluatedAt: new Date(),
      createdAt: new Date(),
    }));
  });

  const base = {
    organizationId: 'org-1',
    experienceId: 'exp-1',
    workflowRunId: 'run-1',
    workflowStepRunId: 'step-1',
    stepType: 'BUILD',
    capabilityCode: 'CODE_BUILD',
    executionStatus: 'SUCCEEDED',
    transitionKind: 'NEXT_STEP',
  };

  it('records direct execution evidence with deterministic score and confidence', async () => {
    const outcome = await service.record(base);
    expect(create).toHaveBeenCalledWith('org-1', expect.objectContaining({
      experienceId: 'exp-1',
      metricCode: 'workflow_step_execution_status',
      expectedValue: 'SUCCEEDED',
      observedValue: 'SUCCEEDED',
      score: 1,
      confidence: 1,
      evaluatorType: 'SYSTEM',
      evidence: expect.objectContaining({
        workflowRunId: 'run-1',
        workflowStepRunId: 'step-1',
        executionStatus: 'SUCCEEDED',
      }),
    }));
    expect(markExperienceEvaluated).toHaveBeenCalledWith('org-1', 'exp-1');
    expect(outcome.score).toBe(1);
  });

  it('scores objective execution failures negatively without inventing quality evidence', async () => {
    await service.record({ ...base, executionStatus: 'TIMED_OUT' });
    expect(create).toHaveBeenCalledWith('org-1', expect.objectContaining({ score: -1 }));
  });

  it('records blocked/incomplete statuses neutrally rather than pretending success or failure', async () => {
    await service.record({ ...base, executionStatus: 'POLICY_BLOCKED', transitionKind: null });
    expect(create).toHaveBeenCalledWith('org-1', expect.objectContaining({ score: 0 }));
  });

  it('is idempotent for an already-recorded runtime status outcome', async () => {
    listForExperience.mockResolvedValue([{ id: 'existing', metricCode: 'workflow_step_execution_status' }]);
    const outcome = await service.record(base);
    expect(outcome).toEqual(expect.objectContaining({ id: 'existing' }));
    expect(create).not.toHaveBeenCalled();
    expect(markExperienceEvaluated).not.toHaveBeenCalled();
  });

  it('fails open through tryRecord and emits a failure audit', async () => {
    experienceExists.mockRejectedValueOnce(new Error('db unavailable'));
    await expect(service.tryRecord(base)).resolves.toBeNull();
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LEARNING_RUNTIME_OUTCOME_CAPTURE_FAILED',
      entityId: 'exp-1',
    }));
  });
});
