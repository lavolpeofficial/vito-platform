import {
  AgentExecutionStatus,
  ProviderHealthStatus,
  ProviderQuotaStatus,
} from '@vito/contracts';
import { ProviderRuntimeStateService } from './provider-runtime-state.service';

describe('ProviderRuntimeStateService', () => {
  const previousTtl = process.env.VITO_PROVIDER_STATE_TTL_MS;
  const previousBackoff = process.env.VITO_PROVIDER_FAILURE_BACKOFF_MS;

  afterEach(() => {
    process.env.VITO_PROVIDER_STATE_TTL_MS = previousTtl;
    process.env.VITO_PROVIDER_FAILURE_BACKOFF_MS = previousBackoff;
    jest.restoreAllMocks();
  });

  function build() {
    const tx = {
      agentProvider: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    return { service: new ProviderRuntimeStateService(prisma, audit), tx, audit };
  }

  it('treats old EXHAUSTED evidence as stale instead of permanent truth', () => {
    process.env.VITO_PROVIDER_FAILURE_BACKOFF_MS = '900000';
    const { service } = build();
    const provider = {
      healthStatus: ProviderHealthStatus.HEALTHY,
      healthCheckedAt: new Date(Date.now() - 20 * 60_000),
      quotaStatus: ProviderQuotaStatus.EXHAUSTED,
      quotaCheckedAt: new Date(Date.now() - 20 * 60_000),
    } as any;

    expect(service.needsRefresh(provider)).toBe(true);
    expect(service.isQuotaFresh(provider)).toBe(false);
  });

  it('keeps a recent negative result inside the bounded circuit cooldown', () => {
    process.env.VITO_PROVIDER_FAILURE_BACKOFF_MS = '900000';
    const { service } = build();
    const provider = {
      healthStatus: ProviderHealthStatus.HEALTHY,
      healthCheckedAt: new Date(),
      quotaStatus: ProviderQuotaStatus.EXHAUSTED,
      quotaCheckedAt: new Date(),
    } as any;

    expect(service.needsRefresh(provider)).toBe(false);
    expect(service.isQuotaFresh(provider)).toBe(true);
  });

  it('persists one coherent health/quota observation with audit evidence', async () => {
    const { service, tx, audit } = build();
    await service.recordProbe('org-1', 'provider-1', {
      healthStatus: ProviderHealthStatus.HEALTHY,
      quotaStatus: ProviderQuotaStatus.AVAILABLE,
      reasonCode: 'PROBE_SUCCEEDED',
      durationMs: 123,
      observedProviderId: 'openai',
      observedModelId: 'gpt-test',
    });

    expect(tx.agentProvider.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'provider-1', organizationId: 'org-1' },
      data: expect.objectContaining({
        healthStatus: ProviderHealthStatus.HEALTHY,
        quotaStatus: ProviderQuotaStatus.AVAILABLE,
      }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PROVIDER_RUNTIME_PROBED',
      entityId: 'provider-1',
      metadata: expect.objectContaining({ reasonCode: 'PROBE_SUCCEEDED' }),
    }), tx);
  });

  it('feeds successful governed execution back as fresh AVAILABLE evidence', async () => {
    const { service } = build();
    const spy = jest.spyOn(service, 'recordProbe').mockResolvedValue(undefined);
    await service.observeExecution('org-1', 'provider-1', {
      status: AgentExecutionStatus.SUCCEEDED,
      durationMs: 250,
      providerExecutionMetadata: {
        providerIdentityPostcondition: {
          observedProviderId: 'openrouter',
          observedModelId: 'model-a',
        },
      },
    } as any);

    expect(spy).toHaveBeenCalledWith('org-1', 'provider-1', expect.objectContaining({
      healthStatus: ProviderHealthStatus.HEALTHY,
      quotaStatus: ProviderQuotaStatus.AVAILABLE,
      reasonCode: 'EXECUTION_SUCCEEDED',
    }));
  });
});
