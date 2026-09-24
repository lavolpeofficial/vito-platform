import { EngineeringProviderProvisioningService } from './engineering-provider-provisioning.service';

describe('EngineeringProviderProvisioningService transaction rollback', () => {
  it('does not commit provider, capability or audit rows if a capability audit fails', async () => {
    const committed = {
      providers: [] as Array<{ id: string }>,
      capabilities: [] as Array<{ id: string }>,
      audits: [] as Array<{ action: string }>,
    };
    let stagedAudits: Array<{ action: string }> = [];
    let transactionClient: unknown;
    const transaction = jest.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const staged = {
        providers: [] as Array<{ id: string }>,
        capabilities: [] as Array<{ id: string }>,
        audits: [] as Array<{ action: string }>,
      };
      stagedAudits = staged.audits;
      const tx = {
        agentProvider: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(async ({ data }: any) => {
            const provider = { id: 'provider-1', ...data };
            staged.providers.push(provider);
            return provider;
          }),
        },
        providerCapability: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(async ({ data }: any) => {
            const capability = { id: 'capability-1', ...data };
            staged.capabilities.push(capability);
            return capability;
          }),
        },
      };
      transactionClient = tx;
      const result = await callback(tx);
      committed.providers.push(...staged.providers);
      committed.capabilities.push(...staged.capabilities);
      committed.audits.push(...staged.audits);
      return result;
    });
    const audit = {
      record: jest.fn(async (event: { action: string }, tx: unknown) => {
        expect(tx).toBe(transactionClient);
        stagedAudits.push({ action: event.action });
        if (event.action === 'PROVIDER_CAPABILITY_ASSIGNED') {
          throw new Error('simulated capability audit write failure');
        }
      }),
    };
    const tenant = {
      getOrThrow: jest.fn(() => 'org-1'),
      getUserId: jest.fn(() => 'human-1'),
      getAuthenticationMethod: jest.fn(() => 'jwt'),
    };
    const service = new EngineeringProviderProvisioningService(
      { $transaction: transaction } as any,
      tenant as any,
      audit as any,
    );

    await expect(service.provision()).rejects.toThrow(
      'simulated capability audit write failure',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(stagedAudits).toEqual([
      { action: 'PROVIDER_REGISTERED' },
      { action: 'PROVIDER_CAPABILITY_ASSIGNED' },
    ]);
    expect(committed).toEqual({ providers: [], capabilities: [], audits: [] });
  });
});
