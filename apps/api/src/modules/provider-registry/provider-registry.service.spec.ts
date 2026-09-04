/**
 * Unit Tests für den ProviderRegistryService (EO-01.3 Correction 02).
 *
 * Fokus:
 *  - Durable ProviderCapability Assignments (Create/Enable/Disable/List)
 *  - Duplicate-Prevention: Schema-Unique-Constraint (P2002) => ConflictException
 *  - Tenant-Scoping aller Capability-Operationen
 *  - Explizite estimatedCostMinorUnits Persistenz (create/update)
 */

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProviderRegistryService } from './provider-registry.service';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function buildService() {
  const tx = {
    agentProvider: {
      create: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: randomUUID(), ...args.data, createdAt: new Date(), updatedAt: new Date() }),
      ),
      update: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: args.where.id, providerCode: 'TEST_PROVIDER', ...args.data, updatedAt: new Date() }),
      ),
    },
    providerCapability: {
      create: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: randomUUID(), ...args.data, createdAt: new Date(), updatedAt: new Date() }),
      ),
      update: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({
          id: args.where.id,
          organizationId: ORG_A,
          agentProviderId: 'provider-1',
          capabilityCode: 'CODE_BUILD',
          isEnabled: args.data.isEnabled,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    },
  };

  const prisma: any = {
    $transaction: jest.fn((cb: any) => cb(tx)),
    agentProvider: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    providerCapability: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const auditService: any = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ProviderRegistryService(prisma, auditService);
  return { service, prisma, auditService, tx };
}

// ===========================================================================
// Durable ProviderCapability assignment
// ===========================================================================
describe('ProviderCapability assignment', () => {
  it('creates a durable enabled assignment and audits it', async () => {
    const providerRow = { id: 'provider-1', organizationId: ORG_A, providerCode: 'TEST_PROVIDER' };
    const { service, prisma, auditService, tx } = buildService();
    prisma.agentProvider.findFirst.mockResolvedValue(providerRow);

    const result = await service.assignCapability({
      organizationId: ORG_A,
      agentProviderId: 'provider-1',
      capabilityCode: 'CODE_BUILD',
    });

    expect(tx.providerCapability.create).toHaveBeenCalledWith({
      data: {
        organizationId: ORG_A,
        agentProviderId: 'provider-1',
        capabilityCode: 'CODE_BUILD',
        isEnabled: true,
      },
    });
    expect(result.capabilityCode).toBe('CODE_BUILD');
    expect(result.isEnabled).toBe(true);

    expect(auditService.record).toHaveBeenCalledTimes(1);
    const auditCall = auditService.record.mock.calls[0][0];
    expect(auditCall.action).toBe('PROVIDER_CAPABILITY_ASSIGNED');
    expect(auditCall.entityType).toBe('ProviderCapability');
    expect(auditCall.metadata.capabilityCode).toBe('CODE_BUILD');
  });

  it('rejects duplicate assignment with ConflictException (P2002 unique constraint)', async () => {
    const providerRow = { id: 'provider-1', organizationId: ORG_A, providerCode: 'TEST_PROVIDER' };
    const { service, prisma, tx } = buildService();
    prisma.agentProvider.findFirst.mockResolvedValue(providerRow);

    const duplicateError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the constraint: `provider_capabilities_organizationId_agentProviderId_capabilityCode_key`',
      { code: 'P2002', clientVersion: 'test' },
    );
    tx.providerCapability.create.mockRejectedValue(duplicateError);

    await expect(
      service.assignCapability({
        organizationId: ORG_A,
        agentProviderId: 'provider-1',
        capabilityCode: 'CODE_BUILD',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('assignment is tenant-scoped: unknown provider in org => NotFoundException', async () => {
    const { service, prisma } = buildService();
    prisma.agentProvider.findFirst.mockResolvedValue(null);

    await expect(
      service.assignCapability({
        organizationId: ORG_B,
        agentProviderId: 'provider-1',
        capabilityCode: 'CODE_BUILD',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.agentProvider.findFirst).toHaveBeenCalledWith({
      where: { id: 'provider-1', organizationId: ORG_B },
    });
  });

  it('can disable an assignment (isEnabled=false) and audits the change', async () => {
    const existing = {
      id: 'cap-1',
      organizationId: ORG_A,
      agentProviderId: 'provider-1',
      capabilityCode: 'CODE_BUILD',
      isEnabled: true,
    };
    const { service, prisma, auditService } = buildService();
    prisma.providerCapability.findFirst.mockResolvedValue(existing);

    const result = await service.setCapabilityEnabled(ORG_A, 'cap-1', false);

    expect(result.isEnabled).toBe(false);
    expect(auditService.record).toHaveBeenCalledTimes(1);
    expect(auditService.record.mock.calls[0][0].action).toBe('PROVIDER_CAPABILITY_UPDATED');
  });

  it('disable is tenant-scoped', async () => {
    const { service, prisma } = buildService();
    prisma.providerCapability.findFirst.mockResolvedValue(null);

    await expect(
      service.setCapabilityEnabled(ORG_B, 'cap-1', false),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.providerCapability.findFirst).toHaveBeenCalledWith({
      where: { id: 'cap-1', organizationId: ORG_B },
    });
  });

  it('listCapabilities is always organization-scoped', async () => {
    const { service, prisma } = buildService();

    await service.listCapabilities(ORG_A);
    expect(prisma.providerCapability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG_A } }),
    );

    await service.listCapabilities(ORG_A, 'provider-1');
    expect(prisma.providerCapability.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_A, agentProviderId: 'provider-1' },
      }),
    );
  });
});

// ===========================================================================
// Explicit estimated monetary cost persistence
// ===========================================================================
describe('estimatedCostMinorUnits persistence', () => {
  it('createProvider persists explicit estimatedCostMinorUnits', async () => {
    const { service, tx, auditService } = buildService();

    const result = await service.createProvider({
      organizationId: ORG_A,
      providerCode: 'TEST_PROVIDER',
      displayName: 'Test Provider',
      supportedCapabilities: ['CODE_BUILD'],
      estimatedCostMinorUnits: 250,
    });

    expect(tx.agentProvider.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ estimatedCostMinorUnits: 250 }),
    });
    expect(result.estimatedCostMinorUnits).toBe(250);
    expect(auditService.record).toHaveBeenCalledTimes(1);
  });

  it('createProvider defaults to null (unknown cost)', async () => {
    const { service, tx } = buildService();

    await service.createProvider({
      organizationId: ORG_A,
      providerCode: 'TEST_PROVIDER',
      displayName: 'Test Provider',
      supportedCapabilities: [],
    });

    expect(tx.agentProvider.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ estimatedCostMinorUnits: null }),
    });
  });

  it('updateProvider persists estimatedCostMinorUnits changes', async () => {
    const { service, prisma, tx } = buildService();
    prisma.agentProvider.findFirst.mockResolvedValue({ id: 'provider-1', organizationId: ORG_A });

    await service.updateProvider({
      organizationId: ORG_A,
      providerId: 'provider-1',
      estimatedCostMinorUnits: 300,
    });

    expect(tx.agentProvider.update).toHaveBeenCalledWith({
      where: { id: 'provider-1' },
      data: expect.objectContaining({ estimatedCostMinorUnits: 300 }),
    });
  });
});
