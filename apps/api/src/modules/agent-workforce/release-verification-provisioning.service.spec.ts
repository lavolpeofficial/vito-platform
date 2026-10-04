import { BadRequestException, ConflictException } from '@nestjs/common';
import { RiskLevel } from '@prisma/client';
import { EngineeringCapability } from '@vito/contracts';
import { ReleaseVerificationProvisioningService } from './release-verification-provisioning.service';

describe('ReleaseVerificationProvisioningService', () => {
  const employeeFind = jest.fn();
  const providerFind = jest.fn();
  const providerUpdate = jest.fn();
  const capabilityFind = jest.fn();
  const capabilityCreate = jest.fn();
  const employeeLinkFind = jest.fn();
  const employeeLinkCreate = jest.fn();
  const providerLinkFind = jest.fn();
  const providerLinkCreate = jest.fn();
  const auditRecord = jest.fn().mockResolvedValue(undefined);

  const tenant = {
    getOrThrow: jest.fn(() => 'org-1'),
    getUserId: jest.fn(() => 'user-1'),
    getAuthenticationMethod: jest.fn(() => 'jwt'),
  };

  const baseCapabilities = [
    EngineeringCapability.CODE_PLAN,
    EngineeringCapability.CODE_BUILD,
    EngineeringCapability.TEST_EXECUTION,
    EngineeringCapability.REVIEW_PACKAGE,
    EngineeringCapability.RED_TEAM,
  ];

  const tx = {
    digitalEmployee: { findFirst: employeeFind },
    agentProvider: { findFirst: providerFind, update: providerUpdate },
    capability: { findFirst: capabilityFind, create: capabilityCreate },
    digitalEmployeeCapability: { findUnique: employeeLinkFind, create: employeeLinkCreate },
    providerCapability: { findUnique: providerLinkFind, create: providerLinkCreate },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tenant.getOrThrow.mockReturnValue('org-1');
    tenant.getUserId.mockReturnValue('user-1');
    tenant.getAuthenticationMethod.mockReturnValue('jwt');

    employeeFind.mockResolvedValue({
      id: 'employee-1',
      organizationId: 'org-1',
      code: 'vito-engineer',
      name: 'VITO Engineer',
      status: 'ACTIVE',
      employeeType: 'SPECIALIST',
    });
    providerFind.mockResolvedValue({
      id: 'provider-1',
      organizationId: 'org-1',
      providerCode: 'cloud.openai.main',
      providerType: 'CLOUD_LLM',
      status: 'ACTIVE',
      modelFamily: 'openai',
      supportedCapabilities: [...baseCapabilities],
    });
    capabilityFind.mockResolvedValue(null);
    capabilityCreate.mockResolvedValue({
      id: 'cap-release',
      organizationId: 'org-1',
      code: EngineeringCapability.RELEASE_VERIFICATION,
      name: 'Release verification',
      riskLevel: RiskLevel.MEDIUM,
      requiresApproval: false,
    });
    employeeLinkFind.mockResolvedValue(null);
    employeeLinkCreate.mockResolvedValue({
      digitalEmployeeId: 'employee-1',
      capabilityId: 'cap-release',
      isEnabled: false,
      configuration: {},
    });
    providerLinkFind.mockResolvedValue(null);
    providerLinkCreate.mockResolvedValue({
      id: 'provider-cap-release',
      organizationId: 'org-1',
      agentProviderId: 'provider-1',
      capabilityCode: EngineeringCapability.RELEASE_VERIFICATION,
      isEnabled: false,
    });
    providerUpdate.mockResolvedValue({});
  });

  function service() {
    return new ReleaseVerificationProvisioningService(
      { $transaction: (fn: (transaction: typeof tx) => unknown) => fn(tx) } as any,
      tenant as any,
      { record: auditRecord } as any,
    );
  }

  it('adds RELEASE_VERIFICATION disabled while preserving an ACTIVE employee/provider', async () => {
    const result = await service().provision();

    expect(capabilityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        code: EngineeringCapability.RELEASE_VERIFICATION,
        riskLevel: RiskLevel.MEDIUM,
        requiresApproval: false,
      }),
    }));
    expect(employeeLinkCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isEnabled: false }),
    }));
    expect(providerLinkCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        capabilityCode: EngineeringCapability.RELEASE_VERIFICATION,
        isEnabled: false,
      }),
    }));
    expect(providerUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'provider-1' },
      data: {
        supportedCapabilities: [
          ...baseCapabilities,
          EngineeringCapability.RELEASE_VERIFICATION,
        ],
      },
    }));
    expect(result).toEqual(expect.objectContaining({
      digitalEmployeeStatus: 'ACTIVE',
      employeeCapabilityEnabled: false,
      providerStatus: 'ACTIVE',
      providerCapabilityEnabled: false,
      providerMetadataUpdated: true,
      existingAuthorityPreserved: true,
    }));
  });

  it('is idempotent when the disabled extension and metadata already exist', async () => {
    providerFind.mockResolvedValueOnce({
      id: 'provider-1',
      organizationId: 'org-1',
      providerCode: 'cloud.openai.main',
      providerType: 'CLOUD_LLM',
      status: 'ACTIVE',
      modelFamily: 'openai',
      supportedCapabilities: [...baseCapabilities, EngineeringCapability.RELEASE_VERIFICATION],
    });
    capabilityFind.mockResolvedValueOnce({
      id: 'cap-release',
      code: EngineeringCapability.RELEASE_VERIFICATION,
      riskLevel: RiskLevel.MEDIUM,
      requiresApproval: false,
    });
    employeeLinkFind.mockResolvedValueOnce({ isEnabled: false });
    providerLinkFind.mockResolvedValueOnce({ id: 'provider-cap-release', isEnabled: false });

    const result = await service().provision();

    expect(capabilityCreate).not.toHaveBeenCalled();
    expect(employeeLinkCreate).not.toHaveBeenCalled();
    expect(providerLinkCreate).not.toHaveBeenCalled();
    expect(providerUpdate).not.toHaveBeenCalled();
    expect(result.providerMetadataUpdated).toBe(false);
  });

  it('fails closed if RELEASE_VERIFICATION authority is already enabled', async () => {
    capabilityFind.mockResolvedValueOnce({
      id: 'cap-release',
      code: EngineeringCapability.RELEASE_VERIFICATION,
      riskLevel: RiskLevel.MEDIUM,
      requiresApproval: false,
    });
    employeeLinkFind.mockResolvedValueOnce({ isEnabled: true });

    await expect(service().provision()).rejects.toBeInstanceOf(ConflictException);
    expect(providerLinkCreate).not.toHaveBeenCalled();
    expect(providerUpdate).not.toHaveBeenCalled();
  });

  it('fails closed on unexpected provider capability metadata', async () => {
    providerFind.mockResolvedValueOnce({
      id: 'provider-1',
      providerCode: 'cloud.openai.main',
      providerType: 'CLOUD_LLM',
      status: 'ACTIVE',
      modelFamily: 'openai',
      supportedCapabilities: [...baseCapabilities, 'UNEXPECTED_CAPABILITY'],
    });

    await expect(service().provision()).rejects.toBeInstanceOf(ConflictException);
    expect(capabilityCreate).not.toHaveBeenCalled();
  });

  it('requires authenticated human governance', async () => {
    tenant.getAuthenticationMethod.mockReturnValueOnce('machine');
    tenant.getUserId.mockReturnValueOnce(null as any);

    await expect(service().provision()).rejects.toBeInstanceOf(BadRequestException);
    expect(employeeFind).not.toHaveBeenCalled();
  });
});
