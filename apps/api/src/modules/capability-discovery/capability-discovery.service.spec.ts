import { CapabilityDiscoveryService } from './capability-discovery.service';

describe('CapabilityDiscoveryService', () => {
  const prisma = {
    capability: { findFirst: jest.fn() },
    providerCapability: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const service = new CapabilityDiscoveryService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('reports AVAILABLE when an enabled active provider can execute the capability', async () => {
    prisma.capability.findFirst.mockResolvedValueOnce(null);
    prisma.providerCapability.findMany.mockResolvedValueOnce([
      { agentProviderId: 'provider-1', agentProvider: { providerCode: 'openai', healthStatus: 'HEALTHY', quotaStatus: 'AVAILABLE' } },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const result = await service.assess('org-1', 'code_build');

    expect(result.code).toBe('CODE_BUILD');
    expect(result.availability).toBe('AVAILABLE');
    expect(result.gap).toBeNull();
  });

  it('reports CANDIDATE_ONLY without treating a skill candidate as executable', async () => {
    prisma.capability.findFirst.mockResolvedValueOnce(null);
    prisma.providerCapability.findMany.mockResolvedValueOnce([]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'skill-1', code: 'QUALIFY_LEAD', name: 'Qualify Lead', status: 'RECORDED', confidence: 0.82 },
    ]);

    const result = await service.assess('org-1', 'QUALIFY_LEAD');

    expect(result.availability).toBe('CANDIDATE_ONLY');
    expect(result.gap?.suggestedNextState).toBe('HUMAN_GOVERNANCE_REVIEW');
  });

  it('reports MISSING when no registered, provider, official or governed candidate evidence exists', async () => {
    prisma.capability.findFirst.mockResolvedValueOnce(null);
    prisma.providerCapability.findMany.mockResolvedValueOnce([]);
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const result = await service.assess('org-1', 'UNKNOWN_NEED');

    expect(result.availability).toBe('MISSING');
    expect(result.gap?.type).toBe('CAPABILITY_MISSING');
  });
});
