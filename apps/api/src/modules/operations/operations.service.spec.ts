import { OperationsService } from './operations.service';

describe('OperationsService', () => {
  const workflowRun = {
    groupBy: jest.fn(),
    findMany: jest.fn(),
  };
  const digitalEmployee = { groupBy: jest.fn() };
  const source = { groupBy: jest.fn() };
  const queryRaw = jest.fn();
  const prisma = {
    workflowRun,
    digitalEmployee,
    source,
    $queryRaw: queryRaw,
  } as any;
  const providerIntelligence = { snapshot: jest.fn() } as any;
  const service = new OperationsService(prisma, providerIntelligence);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns tenant-scoped read-only telemetry without quality or billing claims', async () => {
    workflowRun.groupBy.mockResolvedValue([
      { status: 'RUNNING', _count: { _all: 2 } },
      { status: 'BLOCKED', _count: { _all: 1 } },
    ]);
    workflowRun.findMany.mockResolvedValue([
      {
        id: 'run-1',
        status: 'BLOCKED',
        currentStepType: 'BUILD',
        blockReasonCode: 'PROVIDER_BLOCKED',
        failureReasonCode: null,
        correlationId: 'corr-1',
        updatedAt: new Date(),
      },
    ]);
    digitalEmployee.groupBy.mockResolvedValue([
      { status: 'ACTIVE', _count: { _all: 3 } },
    ]);
    source.groupBy.mockResolvedValue([
      { ingestionStatus: 'INGESTED', _count: { _all: 4 } },
    ]);
    queryRaw
      .mockResolvedValueOnce([
        { status: 'ACTIVE', count: 5n },
        { status: 'RETRACTED', count: 1n },
      ])
      .mockResolvedValueOnce([{ count: 12n }])
      .mockResolvedValueOnce([{ count: 2n }]);
    providerIntelligence.snapshot.mockResolvedValue({
      providers: [{ id: 'provider-1' }],
      capabilityCoverage: [
        {
          capabilityCode: 'CODE_BUILD',
          readiness: 'ROUTABLE_BASELINE',
          enabledProviderCount: 1,
        },
        {
          capabilityCode: 'RED_TEAM',
          readiness: 'NO_PROVIDER_ASSIGNMENT',
          enabledProviderCount: 0,
        },
      ],
      routing: {
        observedDecisionCount: 10,
        selectionRate: 0.8,
      },
      costVisibility: {
        basis: 'CURRENT_PROVIDER_ESTIMATE_NOT_BILLED_COST',
        selectedDecisionCount: 8,
        coveredSelectionCount: 6,
        coverageRate: 0.75,
        currentEstimateTotalMinorUnits: 100,
      },
    });

    const result = await service.summary('org-1');

    expect(workflowRun.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } }),
    );
    expect(workflowRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-1',
          status: { in: ['BLOCKED', 'FAILED'] },
        },
        take: 20,
      }),
    );
    expect(providerIntelligence.snapshot).toHaveBeenCalledWith('org-1');
    expect(result).toEqual(
      expect.objectContaining({
        organizationId: 'org-1',
        authority: 'READ_ONLY',
        semantics: {
          executionSuccessIsNotTaskQuality: true,
          providerCostIsEstimateNotBilling: true,
        },
        workflows: expect.objectContaining({ total: 3, attentionCount: 1 }),
        workforce: { total: 3, byStatus: { ACTIVE: 3 } },
        knowledge: {
          sources: { total: 4, byIngestionStatus: { INGESTED: 4 } },
          knowledgeUnits: 12,
        },
        memory: { byStatus: { ACTIVE: 5, RETRACTED: 1 }, total: 6 },
        governance: { pendingSkillPromotionReviews: 2 },
        providers: expect.objectContaining({
          registeredCount: 1,
          routingWindowDecisionCount: 10,
          selectionRate: 0.8,
          capabilityGapCount: 1,
        }),
      }),
    );
    expect(result.providers.costVisibility.basis).toBe(
      'CURRENT_PROVIDER_ESTIMATE_NOT_BILLED_COST',
    );
  });
});
