import { BadRequestException, ConflictException } from '@nestjs/common';
import { EngineeringCapability } from '@vito/contracts';
import { EngineeringProviderProvisioningService } from './engineering-provider-provisioning.service';

describe('EngineeringProviderProvisioningService', () => {
  const findProviderByCode = jest.fn();
  const createProvider = jest.fn();
  const listCapabilities = jest.fn();
  const assignCapability = jest.fn();
  const auditRecord = jest.fn().mockResolvedValue(undefined);
  const tx = {
    agentProvider: { findFirst: findProviderByCode, create: createProvider },
    providerCapability: {
      findMany: listCapabilities,
      create: assignCapability,
    },
  };
  const tenant = {
    getOrThrow: jest.fn(() => 'org-1'),
    getUserId: jest.fn(() => 'user-1'),
    getAuthenticationMethod: jest.fn(() => 'jwt'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tenant.getOrThrow.mockReturnValue('org-1');
    tenant.getUserId.mockReturnValue('user-1');
    tenant.getAuthenticationMethod.mockReturnValue('jwt');
    findProviderByCode.mockResolvedValue(null);
    createProvider.mockResolvedValue({
      id: 'provider-1',
      organizationId: 'org-1',
      providerCode: 'cloud.openai.main',
      displayName: 'OpenAI Cloud Coding',
      providerType: 'CLOUD_LLM',
      status: 'DISABLED',
      modelFamily: 'openai',
      supportedCapabilities: [
        EngineeringCapability.CODE_PLAN,
        EngineeringCapability.CODE_BUILD,
        EngineeringCapability.TEST_EXECUTION,
        EngineeringCapability.REVIEW_PACKAGE,
      ],
    });
    listCapabilities.mockResolvedValue([]);
    assignCapability.mockImplementation(async ({ data }: any) => ({
      id: `pc-${data.capabilityCode}`,
      ...data,
    }));
  });

  function service() {
    return new EngineeringProviderProvisioningService(
      {
        $transaction: (fn: (transaction: typeof tx) => unknown) => fn(tx),
      } as any,
      tenant as any,
      { record: auditRecord } as any,
    );
  }

  it('creates only a DISABLED provider with disabled engineering capabilities', async () => {
    const result = await service().provision();

    expect(createProvider).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        providerCode: 'cloud.openai.main',
        providerType: 'CLOUD_LLM',
        status: 'DISABLED',
        modelFamily: 'openai',
      }),
    });
    expect(assignCapability).toHaveBeenCalledTimes(4);
    for (const call of assignCapability.mock.calls) {
      expect(call[0].data.isEnabled).toBe(false);
    }
    expect(result.status).toBe('DISABLED');
    expect(result.capabilitiesEnabled).toBe(false);
    expect(result.cloudProfileEnabled).toBe(false);
    expect(result.requiresExplicitProviderActivation).toBe(true);
    expect(result.requiresCredentialAuthorization).toBe(true);
    expect(auditRecord).toHaveBeenCalledTimes(5);
    for (const call of auditRecord.mock.calls) expect(call[1]).toBe(tx);
  });

  it('requires authenticated human governance', async () => {
    tenant.getAuthenticationMethod.mockReturnValueOnce('machine');
    tenant.getUserId.mockReturnValueOnce(null as any);

    await expect(service().provision()).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(findProviderByCode).not.toHaveBeenCalled();
  });

  it('keeps provider creation, capability assignments and audits in one transaction', async () => {
    const transaction = jest.fn(
      async (fn: (transaction: typeof tx) => unknown) => fn(tx),
    );
    const instance = new EngineeringProviderProvisioningService(
      { $transaction: transaction } as any,
      tenant as any,
      { record: auditRecord } as any,
    );

    await instance.provision();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledTimes(5);
    expect(createProvider.mock.invocationCallOrder[0]).toBeLessThan(
      assignCapability.mock.invocationCallOrder[0],
    );
  });

  it('is idempotent for the exact disabled provider and disabled links', async () => {
    findProviderByCode.mockResolvedValueOnce({
      id: 'provider-1',
      providerCode: 'cloud.openai.main',
      providerType: 'CLOUD_LLM',
      status: 'DISABLED',
      modelFamily: 'openai',
      supportedCapabilities: [
        EngineeringCapability.CODE_PLAN,
        EngineeringCapability.CODE_BUILD,
        EngineeringCapability.TEST_EXECUTION,
        EngineeringCapability.REVIEW_PACKAGE,
      ],
    });
    listCapabilities.mockResolvedValueOnce([
      { capabilityCode: EngineeringCapability.CODE_PLAN, isEnabled: false },
      { capabilityCode: EngineeringCapability.CODE_BUILD, isEnabled: false },
      {
        capabilityCode: EngineeringCapability.TEST_EXECUTION,
        isEnabled: false,
      },
      {
        capabilityCode: EngineeringCapability.REVIEW_PACKAGE,
        isEnabled: false,
      },
    ]);

    const result = await service().provision();
    expect(createProvider).not.toHaveBeenCalled();
    expect(assignCapability).not.toHaveBeenCalled();
    expect(result.capabilitiesEnabled).toBe(false);
  });

  it('fails closed for an active or otherwise mismatched provider', async () => {
    findProviderByCode.mockResolvedValueOnce({
      id: 'provider-1',
      providerCode: 'cloud.openai.main',
      providerType: 'CLOUD_LLM',
      status: 'ACTIVE',
      modelFamily: 'openai',
      supportedCapabilities: [
        EngineeringCapability.CODE_PLAN,
        EngineeringCapability.CODE_BUILD,
        EngineeringCapability.TEST_EXECUTION,
        EngineeringCapability.REVIEW_PACKAGE,
      ],
    });

    await expect(service().provision()).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(assignCapability).not.toHaveBeenCalled();
  });

  it('fails closed when any provider capability is already enabled', async () => {
    findProviderByCode.mockResolvedValueOnce({
      id: 'provider-1',
      providerCode: 'cloud.openai.main',
      providerType: 'CLOUD_LLM',
      status: 'DISABLED',
      modelFamily: 'openai',
      supportedCapabilities: [
        EngineeringCapability.CODE_PLAN,
        EngineeringCapability.CODE_BUILD,
        EngineeringCapability.TEST_EXECUTION,
        EngineeringCapability.REVIEW_PACKAGE,
      ],
    });
    listCapabilities.mockResolvedValueOnce([
      { capabilityCode: EngineeringCapability.CODE_BUILD, isEnabled: true },
    ]);

    await expect(service().provision()).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(assignCapability).not.toHaveBeenCalled();
  });
});
