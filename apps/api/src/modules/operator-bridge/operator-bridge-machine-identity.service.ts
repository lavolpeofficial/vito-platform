import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user.interface';
import { VITO_BRIDGE_MACHINE_SCOPE } from '../../common/decorators/machine-scope.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const BRIDGE_EMAIL = 'vito-bridge@machine.invalid';
const BRIDGE_FIRST_NAME = 'VITO';
const BRIDGE_LAST_NAME = 'Bridge';

export interface VitoBridgeMachineIdentityProvisioningResult {
  readonly userId: string;
  readonly email: string;
  readonly role: typeof UserRole.MEMBER;
  readonly status: typeof UserStatus.ACTIVE;
  readonly machineScope: typeof VITO_BRIDGE_MACHINE_SCOPE;
  readonly created: boolean;
}

@Injectable()
export class OperatorBridgeMachineIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async provision(
    organizationId: string,
    actor: AuthenticatedUser,
  ): Promise<VitoBridgeMachineIdentityProvisioningResult> {
    if (
      actor.organizationId !== organizationId ||
      actor.isMachineIdentity ||
      (actor.role !== UserRole.OWNER && actor.role !== UserRole.ADMIN)
    ) {
      throw new ForbiddenException('An active human OWNER or ADMIN identity is required.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
      const approver = await tx.user.findFirst({
        where: {
          id: actor.userId,
          organizationId,
          status: UserStatus.ACTIVE,
          deletedAt: null,
          isMachineIdentity: false,
          role: { in: [UserRole.OWNER, UserRole.ADMIN] },
        },
        select: { id: true, role: true },
      });
      if (!approver) {
        throw new ForbiddenException('An active human OWNER or ADMIN identity is required.');
      }
      const existing = await tx.user.findMany({
        where: {
          organizationId,
          OR: [
            { machineScope: VITO_BRIDGE_MACHINE_SCOPE },
            { email: BRIDGE_EMAIL },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 2,
      });

      if (existing.length > 1) {
        throw new ConflictException('Multiple VITO bridge machine identities exist; manual remediation is required.');
      }

      if (existing[0]) {
        return this.assertCanonical(existing[0]);
      }

      const machine = await tx.user.create({
        data: {
          organizationId,
          email: BRIDGE_EMAIL,
          firstName: BRIDGE_FIRST_NAME,
          lastName: BRIDGE_LAST_NAME,
          role: UserRole.MEMBER,
          status: UserStatus.ACTIVE,
          isMachineIdentity: true,
          machineScope: VITO_BRIDGE_MACHINE_SCOPE,
          passwordHash: null,
        },
      });
      await this.audit.record(
        {
          organizationId,
          actorType: 'USER',
          actorId: approver.id,
          action: 'VITO_BRIDGE_MACHINE_IDENTITY_PROVISIONED',
          entityType: 'User',
          entityId: machine.id,
          metadata: {
            role: machine.role,
            status: machine.status,
            machineScope: machine.machineScope,
            credentialMode: 'EXTERNAL_OR_INTERNAL_JWT_ONLY',
            interactivePasswordConfigured: false,
          },
        },
        tx,
      );

      return Object.freeze({
        userId: machine.id,
        email: machine.email,
        role: UserRole.MEMBER,
        status: UserStatus.ACTIVE,
        machineScope: VITO_BRIDGE_MACHINE_SCOPE,
        created: true,
      });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.user.findMany({
          where: {
            organizationId,
            OR: [
              { machineScope: VITO_BRIDGE_MACHINE_SCOPE },
              { email: BRIDGE_EMAIL },
            ],
          },
          orderBy: { createdAt: 'asc' },
          take: 2,
        });
        if (existing.length > 1) {
          throw new ConflictException('Multiple VITO bridge machine identities exist; manual remediation is required.');
        }
        if (existing[0]) return this.assertCanonical(existing[0]);
      }
      throw error;
    }
  }

  private assertCanonical(user: {
    id: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    isMachineIdentity: boolean;
    machineScope: string | null;
    deletedAt: Date | null;
  }): VitoBridgeMachineIdentityProvisioningResult {
    if (
      user.deletedAt !== null ||
      user.email !== BRIDGE_EMAIL ||
      user.role !== UserRole.MEMBER ||
      user.status !== UserStatus.ACTIVE ||
      user.isMachineIdentity !== true ||
      user.machineScope !== VITO_BRIDGE_MACHINE_SCOPE
    ) {
      throw new ConflictException(
        'Existing VITO bridge identity is not canonical; explicit lifecycle remediation is required.',
      );
    }

    return Object.freeze({
      userId: user.id,
      email: user.email,
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      machineScope: VITO_BRIDGE_MACHINE_SCOPE,
      created: false,
    });
  }
}
