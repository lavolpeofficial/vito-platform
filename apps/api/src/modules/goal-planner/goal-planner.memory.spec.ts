import { EngineeringStepType } from '@vito/contracts';

import { GoalPlannerService } from './goal-planner.service';

describe('GoalPlannerService memory evidence', () => {
  const capabilityForStep = jest.fn((step: EngineeringStepType) =>
    step === EngineeringStepType.HUMAN_RELEASE_GATE ? null : `CAP_${step}`,
  );
  const knowledgeSearch = jest.fn().mockResolvedValue([]);
  const memorySearch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    knowledgeSearch.mockResolvedValue([]);
    memorySearch.mockResolvedValue([{
      id: 'memory-1',
      organizationId: 'org-1',
      kind: 'ORGANIZATIONAL',
      scope: 'ORGANIZATION',
      scopeId: null,
      title: 'Release policy',
      content: 'Production release requires explicit human approval.',
      sourceType: 'POLICY',
      sourceRef: 'release-policy-v1',
      confidence: null,
      status: 'ACTIVE',
      metadata: {},
      createdAt: new Date('2026-09-12T00:00:00Z'),
      updatedAt: new Date('2026-09-12T00:00:00Z'),
    }]);
  });

  function service() {
    return new GoalPlannerService(
      { capabilityForStep } as any,
      { search: knowledgeSearch } as any,
      { search: memorySearch } as any,
    );
  }

  it('keeps organizational memory separate from knowledge evidence and preserves human governance', async () => {
    const goal = 'Deploy the bounded engineering change safely to production.';
    const plan = await service().planEngineeringGoal('org-1', goal, 'AL4');

    expect(memorySearch).toHaveBeenCalledWith(
      'org-1',
      goal,
      5,
      [{ scope: 'GLOBAL' }, { scope: 'ORGANIZATION' }],
    );
    expect(plan.knowledgeEvidence).toEqual([]);
    expect(plan.memoryEvidence).toEqual([expect.objectContaining({
      memoryEntryId: 'memory-1',
      kind: 'ORGANIZATIONAL',
      scope: 'ORGANIZATION',
      sourceType: 'POLICY',
      sourceRef: 'release-policy-v1',
    })]);
    expect(plan.executable).toBe(false);
    expect(plan.requiresHumanReleaseApproval).toBe(true);
    expect(plan.steps.find((step) => step.stepType === EngineeringStepType.HUMAN_RELEASE_GATE)?.humanBoundary).toBe(true);
  });

  it('fails open when memory is unavailable without changing plan authority', async () => {
    memorySearch.mockRejectedValueOnce(new Error('memory unavailable'));

    const plan = await service().planEngineeringGoal(
      'org-1',
      'Implement a bounded workflow change with governance preserved.',
    );

    expect(plan.memoryEvidence).toEqual([]);
    expect(plan.executable).toBe(false);
    expect(plan.providerSelection).toBe('DEFERRED_TO_PROVIDER_ROUTER');
  });
});
