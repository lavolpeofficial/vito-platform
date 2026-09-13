import { BadRequestException, ConflictException } from '@nestjs/common';
import { DigitalEmployeeStatus, EmployeeType, RiskLevel } from '@prisma/client';
import { EngineeringCapability } from '@vito/contracts';
import { EngineeringAgentProvisioningService } from './engineering-agent-provisioning.service';

describe('EngineeringAgentProvisioningService', () => {
  const employeeFind = jest.fn();
  const employeeCreate = jest.fn();
  const capabilityFind = jest.fn();
  const capabilityCreate = jest.fn();
  const assignmentFind = jest.fn();
  const assignmentCreate = jest.fn();
  const auditRecord = jest.fn().mockResolvedValue(undefined);
  const tenant = {
    getOrThrow: jest.fn(() => 'org-1'),
    getUserId: jest.fn(() => 'user-1'),
    getAuthenticationMethod: jest.fn(() => 'jwt'),
  };

  const tx = {
    digitalEmployee: { findFirst: employeeFind, create: employeeCreate },
    capability: { findFirst: capabilityFind, create: capabilityCreate },
    digitalEmployeeCapability: { findUnique: assignmentFind, create: assignmentCreate },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tenant.getOrThrow.mockReturnValue('org-1');
    tenant.getUserId.mockReturnValue('user-1');
    tenant.getAuthenticationMethod.mockReturnValue('jwt');
    employeeFind.mockResolvedValue(null);
    employeeCreate.mockResolvedValue({
      id: 'employee-1',
      organizationId: 'org-1',
      code: 'vito-engineer',
      name: 'VITO Engineer',
      status: DigitalEmployeeStatus.DRAFT,
      employeeType: EmployeeType.SPECIALIST,
      version: '0.1.0',
    });
    capabilityFind.mockResolvedValue(null);
    let capabilityCounter = 0;
    capabilityCreate.mockImplementation(async ({ data }: any) => ({ id: `cap-${++capabilityCounter}`, ...data }));
    assignmentFind.mockResolvedValue(null);
    assignmentCreate.mockResolvedValue({ isEnabled: false });
  });

  function service() {
    return new EngineeringAgentProvisioningService(
      { $transaction: (fn: (transaction: typeof tx) => unknown) => fn(tx) } as any,
      tenant as any,
      { record: auditRecord } as any,
    );
  }

  it('creates a DRAFT engineering specialist with only disabled server-owned capabilities', async () => {
    const result = await service().provision();

    expect(employeeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        code: 'vito-engineer',
        employeeType: EmployeeType.SPECIALIST,
        status: DigitalEmployeeStatus.DRAFT,
      }),
    }));
    expect(capabilityCreate).toHaveBeenCalledTimes(4);
    expect(assignmentCreate).toHaveBeenCalledTimes(4);
    for (const call of assignmentCreate.mock.calls) {
      expect(call[0].data.isEnabled).toBe(false);
    }
    expect(result.capabilityCodes).toEqual([
      EngineeringCapability.CODE_PLAN,
      EngineeringCapability.CODE_BUILD,
      EngineeringCapability.TEST_EXECUTION,
      EngineeringCapability.REVIEW_PACKAGE,
    ]);
    expect(result.capabilitiesEnabled).toBe(false);
    expect(result.requiresActivationGate).toBe(true);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'USER', actorId: 'user-1', action: 'ENGINEERING_AGENT_PROVISIONED' }),
      tx,
    );
  });

  it('requires an authenticated human identity', async () => {
    tenant.getAuthenticationMethod.mockReturnValueOnce('machine');
    tenant.getUserId.mockReturnValueOnce(null as any);
    await expect(service().provision()).rejects.toBeInstanceOf(BadRequestException);
    expect(employeeFind).not.toHaveBeenCalled();
  });

  it('fails closed instead of mutating an already active engineering agent', async () => {
    employeeFind.mockResolvedValueOnce({
      id: 'employee-1',
      code: 'vito-engineer',
      name: 'VITO Engineer',
      status: DigitalEmployeeStatus.ACTIVE,
      employeeType: EmployeeType.SPECIALIST,
    });
    await expect(service().provision()).rejects.toBeInstanceOf(ConflictException);
    expect(capabilityCreate).not.toHaveBeenCalled();
  });

  it('fails closed when an existing engineering capability has incompatible governance', async () => {
    capabilityFind.mockResolvedValueOnce({
      id: 'cap-existing',
      code: EngineeringCapability.CODE_PLAN,
      riskLevel: RiskLevel.LOW,
      requiresApproval: false,
    });
    await expect(service().provision()).rejects.toBeInstanceOf(ConflictException);
    expect(assignmentCreate).not.toHaveBeenCalled();
  });

  it('is idempotent for an existing DRAFT agent with matching disabled capability links', async () => {
    employeeFind.mockResolvedValueOnce({
      id: 'employee-1',
      code: 'vito-engineer',
      name: 'VITO Engineer',
      status: DigitalEmployeeStatus.DRAFT,
      employeeType: EmployeeType.SPECIALIST,
    });
    const declarations = [
      [EngineeringCapability.CODE_PLAN, RiskLevel.MEDIUM, false],
      [EngineeringCapability.CODE_BUILD, RiskLevel.HIGH, true],
      [EngineeringCapability.TEST_EXECUTION, RiskLevel.MEDIUM, false],
      [EngineeringCapability.REVIEW_PACKAGE, RiskLevel.MEDIUM, false],
    ] as const;
    capabilityFind.mockImplementation(async ({ where }: any) => {
      const found = declarations.find(([code]) => code === where.code)!;
      return { id: `cap-${found[0]}`, code: found[0], riskLevel: found[1], requiresApproval: found[2] };
    });
    assignmentFind.mockResolvedValue({ isEnabled: false });

    const result = await service().provision();
    expect(employeeCreate).not.toHaveBeenCalled();
    expect(capabilityCreate).not.toHaveBeenCalled();
    expect(assignmentCreate).not.toHaveBeenCalled();
    expect(result.capabilitiesEnabled).toBe(false);
  });
});
