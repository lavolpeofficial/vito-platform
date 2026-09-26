import { ProviderRouterService } from './provider-router.service';

const now = new Date();
const capability = { capabilityCode: 'CODE_BUILD', isEnabled: true };

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-primary', organizationId: 'org-1', providerCode: 'cloud.primary',
    displayName: 'Primary', providerType: 'CLOUD_LLM', status: 'ACTIVE',
    modelFamily: 'openai', supportedCapabilities: ['CODE_BUILD'], capabilities: [capability],
    estimatedCostMinorUnits: 1, healthStatus: 'HEALTHY', healthCheckedAt: new Date(0),
    quotaStatus: 'EXHAUSTED', quotaCheckedAt: new Date(0), qualityScore: 1,
    latencyScore: 1, costScore: 1, costMetadata: {}, assuranceLevels: ['AL3'], metadata: {},
    credentialRequirement: 'REQUIRED', createdAt: now, updatedAt: now, ...overrides,
  } as any;
}

function service(initial: any[], refreshed: any[], runtimeOverrides: Record<string, unknown> = {}) {
  const prisma: any = {
    agentProvider: { findMany: jest.fn().mockResolvedValueOnce(initial).mockResolvedValue(refreshed) },
    providerRoutingDecision: { create: jest.fn(async ({ data }: any) => ({ id: 'route-1', ...data, createdAt: now })) },
  };
  const audit: any = { record: jest.fn().mockResolvedValue(undefined) };
  const runtime: any = {
    needsRefresh: jest.fn((p: any) => p.providerCode === 'cloud.primary'),
    isHealthFresh: jest.fn().mockReturnValue(true),
    isQuotaFresh: jest.fn().mockReturnValue(true), ...runtimeOverrides,
  };
  const probe: any = { refreshIfStale: jest.fn().mockResolvedValue({ attempted: true, refreshed: true, reasonCode: 'PROBE_SUCCEEDED' }) };
  return { router: new ProviderRouterService(prisma, audit, runtime, probe), probe };
}

describe('ProviderRouter Execution Fabric v1', () => {
  const request = { organizationId: 'org-1', capability: 'CODE_BUILD', assuranceLevel: 'AL3', correlationId: 'corr-1' };

  it('refreshes stale EXHAUSTED evidence before execution routing', async () => {
    const stale = provider();
    const fresh = provider({ quotaStatus: 'AVAILABLE', quotaCheckedAt: now, healthCheckedAt: now });
    const { router, probe } = service([stale], [fresh]);
    const result = await router.routeForExecution(request);
    expect(probe.refreshIfStale).toHaveBeenCalledTimes(1);
    expect(result.selectedProvider?.id).toBe('provider-primary');
    expect(result.runtimeRefreshedProviderIds).toEqual(['provider-primary']);
  });

  it('falls back when the refreshed primary remains exhausted', async () => {
    const primary = provider();
    const fallback = provider({ id: 'provider-fallback', providerCode: 'cloud.fallback', quotaStatus: 'AVAILABLE', quotaCheckedAt: now, healthCheckedAt: now, qualityScore: 0.2 });
    const primaryStillExhausted = provider({ quotaCheckedAt: now, healthCheckedAt: now });
    const { router } = service([primary, fallback], [primaryStillExhausted, fallback]);
    const result = await router.routeForExecution(request);
    expect(result.selectedProvider?.id).toBe('provider-fallback');
    expect(result.rejectionReasons['provider-primary']).toBe('QUOTA_EXHAUSTED');
  });

  it('keeps public route read-only and fail-closed on stale evidence', async () => {
    const stale = provider();
    const { router, probe } = service([stale], [stale], {
      isHealthFresh: jest.fn().mockReturnValue(false), isQuotaFresh: jest.fn().mockReturnValue(false),
    });
    const result = await router.route(request);
    expect(probe.refreshIfStale).not.toHaveBeenCalled();
    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons['provider-primary']).toBe('HEALTH_STATUS_STALE');
  });
});
