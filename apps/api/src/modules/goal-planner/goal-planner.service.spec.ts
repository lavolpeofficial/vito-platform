import { EngineeringStepType } from '@vito/contracts';
import { GoalPlannerService } from './goal-planner.service';

describe('GoalPlannerService', () => {
  const capabilityForStep = jest.fn((step: EngineeringStepType) => {
    if ([EngineeringStepType.PARSE_VERDICT, EngineeringStepType.HUMAN_RELEASE_GATE, EngineeringStepType.RELEASE_EXECUTION].includes(step)) return null;
    return `CAP_${step}`;
  });
  const search = jest.fn().mockResolvedValue([{ id: 'ku-1', sourcePublicId: 'SRC-1', locatorType: 'SECTION', locatorValue: 'section:1', content: 'Relevant evidence', rank: 1 }]);
  const service = new GoalPlannerService({ capabilityForStep } as any, { search } as any);

  beforeEach(() => jest.clearAllMocks());

  it('builds the official engineering path and preserves governance boundaries', async () => {
    const plan = await service.planEngineeringGoal('org-1', 'Ship the requested bounded engineering change safely.', 'AL4');
    expect(plan.goalClass).toBe('ENGINEERING_CHANGE');
    expect(plan.assuranceLevel).toBe('AL4');
    expect(plan.executable).toBe(false);
    expect(plan.steps.find((step) => step.stepType === EngineeringStepType.BUILD)?.executionAuthority).toBe('AGENT_WORKFORCE');
    expect(plan.steps.find((step) => step.stepType === EngineeringStepType.HUMAN_RELEASE_GATE)).toEqual(expect.objectContaining({ capabilityCode: null, humanBoundary: true, executionAuthority: 'WORKFLOW_GOVERNANCE' }));
    expect(plan.correctionLoop).toEqual(expect.objectContaining({ stepType: EngineeringStepType.CORRECTION, returnsTo: EngineeringStepType.TEST, maxLoops: 3 }));
    expect(plan.knowledgeEvidence).toHaveLength(1);
  });

  it('fails open to an empty knowledge evidence set without changing the plan authority', async () => {
    search.mockRejectedValueOnce(new Error('knowledge unavailable'));
    const plan = await service.planEngineeringGoal('org-1', 'Implement a tenant-safe workflow improvement.');
    expect(plan.knowledgeEvidence).toEqual([]);
    expect(plan.providerSelection).toBe('DEFERRED_TO_PROVIDER_ROUTER');
  });
});
