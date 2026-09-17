import { EngineeringProviderProvisioningService } from './engineering-provider-provisioning.service';

describe('EngineeringProviderProvisioningService transaction rollback', () => {
  it('does not commit provider, capability or audit rows if a capability audit fails', async () => {
    const committed = {
      providers: [] as Array<{ id: string }>,
      capabilities: [] as Array<{ id: string }>,
      audits: [] as Array<{ action: string }>,
    };
    const transaction = jest.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const staged = {
        providers: [] as Array<{ id: string }>,
        capabilities: [] as Array<{ id: string }>,
        audits: [] as Array<{ action: string }>,
      };
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
      const result = await callback(tx);
      committed.providers.push(...staged.providers);
      committed.capabilities.push(...staged.capabilities);
      committed.audits.push(...staged.audits);
      return result;
    });
    let auditCalls = 0;
    const audit = {
      record: jest.fn(async (event: { action: string }, tx: unknown) => {
        expect(tx).toBeDefined();
        auditCalls += 1;
        if (auditCalls === 2) throw new Error('simulated capability audit write failure');
        // The first audit write is staged by the transaction, never committed on rejection.
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
    expect(committed).toEqual({ providers: [], capabilities: [], audits: [] });
  });
});
