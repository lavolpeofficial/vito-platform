import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { OperatorBridgeMachineIdentityService } from './operator-bridge-machine-identity.service';

const actor = {
  userId: 'human-1',
  organizationId: 'org-1',
  role: UserRole.OWNER,
  email: 'owner@example.com',
  isMachineIdentity: false,
  machineScope: null,
};

const canonicalMachine = {
  id: 'machine-1',
  organizationId: 'org-1',
  email: 'vito-bridge@machine.invalid',
  firstName: 'VITO',
  lastName: 'Bridge',
  role: UserRole.MEMBER,
  status: UserStatus.ACTIVE,
  passwordHash: null,
  lastLoginAt: null,
  tokenVersion: 1,
  isMachineIdentity: true,
  machineScope: 'vito-bridge',
  deletedAt: null,
  deletedByUserId: null,
  createdAt: new Date('2026-09-26T00:00:00Z'),
  updatedAt: new Date('2026-09-26T00:00:00Z'),
};
describe('OperatorBridgeMachineIdentityService', () => {
  const findApprover = jest.fn();
  const findExisting = jest.fn();
  const createUser = jest.fn();
  const findPersisted = jest.fn();
  const auditRecord = jest.fn().mockResolvedValue(undefined);

  const tx = {
    user: {
      findFirst: findApprover,
      findMany: findExisting,
      create: createUser,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findApprover.mockResolvedValue({ id: actor.userId, role: actor.role });
    findExisting.mockResolvedValue([]);
    createUser.mockResolvedValue(canonicalMachine);
    findPersisted.mockResolvedValue([]);
  });

  function service() {
    return new OperatorBridgeMachineIdentityService(
      {
        $transaction: (fn: (transaction: typeof tx) => unknown) => fn(tx),
        user: { findMany: findPersisted },
      } as any,
      { record: auditRecord } as any,
    );
  }

  it('provisions exactly the least-privilege bridge identity and audits the human action', async () => {
    const result = await service().provision('org-1', actor as any);

    expect(createUser).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        email: 'vito-bridge@machine.invalid',
        role: UserRole.MEMBER,
        status: UserStatus.ACTIVE,
        isMachineIdentity: true,
        machineScope: 'vito-bridge',
        passwordHash: null,
      }),
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'USER',
        actorId: actor.userId,
        action: 'VITO_BRIDGE_MACHINE_IDENTITY_PROVISIONED',
        entityType: 'User',
        entityId: canonicalMachine.id,
      }),
      tx,
    );
    expect(result).toEqual(expect.objectContaining({
      userId: canonicalMachine.id,
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      machineScope: 'vito-bridge',
      created: true,
    }));
  });

  it('is idempotent for the exact existing canonical identity', async () => {
    findExisting.mockResolvedValueOnce([canonicalMachine]);

    const result = await service().provision('org-1', actor as any);

    expect(createUser).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
    expect(result.userId).toBe(canonicalMachine.id);
  });

  it('rejects machine callers and non-admin human callers before database mutation', async () => {
    await expect(service().provision('org-1', {
      ...actor,
      role: UserRole.MEMBER,
    } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findApprover).not.toHaveBeenCalled();
  });

  it('converges idempotently when a concurrent provisioner wins the unique-email race', async () => {
    createUser.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '5.22.0', meta: { target: ['organizationId', 'email'] } },
    ));
    findPersisted.mockResolvedValueOnce([canonicalMachine]);

    const result = await service().provision('org-1', actor as any);

    expect(result.created).toBe(false);
    expect(result.userId).toBe(canonicalMachine.id);
    expect(findPersisted).toHaveBeenCalledTimes(1);
  });

  it('fails closed when multiple bridge identities exist', async () => {
    findExisting.mockResolvedValueOnce([
      canonicalMachine,
      { ...canonicalMachine, id: 'machine-2', email: 'other@machine.invalid' },
    ]);

    await expect(service().provision('org-1', actor as any)).rejects.toBeInstanceOf(ConflictException);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('fails closed instead of reactivating or normalizing a non-canonical identity', async () => {
    findExisting.mockResolvedValueOnce([{
      ...canonicalMachine,
      status: UserStatus.SUSPENDED,
    }]);

    await expect(service().provision('org-1', actor as any)).rejects.toBeInstanceOf(ConflictException);
    expect(createUser).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('fails closed when the scoped identity does not use the canonical bridge email', async () => {
    findExisting.mockResolvedValueOnce([{
      ...canonicalMachine,
      email: 'other-machine@machine.invalid',
    }]);

    await expect(service().provision('org-1', actor as any)).rejects.toBeInstanceOf(ConflictException);
    expect(createUser).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('revalidates the human approver from persistence', async () => {
    findApprover.mockResolvedValueOnce(null);

    await expect(service().provision('org-1', actor as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findExisting).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });
});
