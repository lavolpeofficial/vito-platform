import { EngineeringCapability } from '@vito/contracts';
import { ProviderIntelligenceService } from './provider-intelligence.service';

describe('ProviderIntelligenceService', () => {
  const agentProvider = { findMany: jest.fn() };
  const providerRoutingDecision = { findMany: jest.fn() };
  const prisma = { agentProvider, providerRoutingDecision } as any;
  const service = new ProviderIntelligenceService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds tenant-scoped provider readiness and labels cost as current estimate, not billed spend', async () => {
    const capability = Object.values(EngineeringCapability)[0];
    agentProvider.findMany.mockResolvedValue([
      {
        id: 'provider-1',
        providerCode: 'p1',
        displayName: 'Provider One',
        status: 'ACTIVE',
        healthStatus: 'HEALTHY',
        healthCheckedAt: new Date(),
        quotaStatus: 'AVAILABLE',
        quotaCheckedAt: new Date(),
        estimatedCostMinorUnits: 12,
        qualityScore: 0.9,
        latencyScore: 100,
        costScore: 10,
        capabilities: [
          { capabilityCode: capability, isEnabled: true },
        ],
      },
    ]);
    providerRoutingDecision.findMany.mockResolvedValue([
      {
        id: 'decision-1',
        requestedCapability: capability,
        selectedProviderId: 'provider-1',
        decisionReason: 'selected',
        routingPolicyVersion: 'v1',
        createdAt: new Date(),
      },
    ]);

    const result = await service.snapshot('org-1');

    expect(agentProvider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } }),
    );
    expect(providerRoutingDecision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' }, take: 100 }),
    );
    expect(result.authority).toBe('READ_ONLY');
    expect(result.providers[0]).toEqual(
      expect.objectContaining({ providerCode: 'p1', staticallyRoutable: true }),
    );
    expect(result.capabilityCoverage).toContainEqual(
      expect.objectContaining({
        capabilityCode: capability,
        staticallyRoutableProviderCount: 1,
        readiness: 'ROUTABLE_BASELINE',
      }),
    );
    expect(result.costVisibility).toEqual(
      expect.objectContaining({
        basis: 'CURRENT_PROVIDER_ESTIMATE_NOT_BILLED_COST',
        coveredSelectionCount: 1,
        currentEstimateTotalMinorUnits: 12,
      }),
    );
  });

  it('does not classify unknown health or quota as statically routable', async () => {
    agentProvider.findMany.mockResolvedValue([
      {
        id: 'provider-2',
        providerCode: 'p2',
        displayName: 'Provider Two',
        status: 'ACTIVE',
        healthStatus: 'UNKNOWN',
        healthCheckedAt: null,
        quotaStatus: 'UNKNOWN',
        quotaCheckedAt: null,
        estimatedCostMinorUnits: null,
        qualityScore: null,
        latencyScore: null,
        costScore: null,
        capabilities: [],
      },
    ]);
    providerRoutingDecision.findMany.mockResolvedValue([]);

    const result = await service.snapshot('org-1');

    expect(result.providers[0].staticallyRoutable).toBe(false);
    expect(result.routing.selectionRate).toBeNull();
    expect(result.costVisibility.coverageRate).toBeNull();
  });
});
