import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { normalizeEmail } from '../../common/utils/normalize-email';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto, DEFAULT_USERS_TAKE, MAX_USERS_TAKE } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SAFE_USER_SELECT } from './users.select';

const PASSWORD_HASH_COST = 12;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
  ) {}

  // -----------------------------------------------------------------
  // POST /users (unverändert aus Sprint 2, bleibt bis Sprint-3B-Cutover
  // bestehen — siehe docs/design/sprint-3-user-management-design.md,
  // Kap. 4/D5). Sprint-3A-Ergänzung: zentrale E-Mail-Normalisierung.
  // -----------------------------------------------------------------
  async create(organizationId: string, dto: CreateUserDto) {
    const normalizedEmail = normalizeEmail(dto.email);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            organizationId,
            email: normalizedEmail,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: dto.role,
            status: dto.status,
          },
          select: SAFE_USER_SELECT,
        });

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'USER_CREATED',
            entityType: 'User',
            entityId: user.id,
            metadata: { email: user.email, role: user.role },
          },
          tx,
        );

        return user;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ein User mit dieser E-Mail existiert bereits in dieser Organization.');
      }
      throw err;
    }
  }

  // -----------------------------------------------------------------
  // GET /users (Sprint 3A: Pagination, Filter, includeDisabled, nie
  // passwordHash).
  // -----------------------------------------------------------------
  async findAll(organizationId: string, query: ListUsersQueryDto) {
    const take = Math.min(query.take ?? DEFAULT_USERS_TAKE, MAX_USERS_TAKE);
    const skip = query.skip ?? 0;

    const where: Prisma.UserWhereInput = { organizationId };

    if (query.status) {
      // Explizite Statusfilterung hat Vorrang vor der Default-Ausblendung.
      where.status = query.status;
    } else if (!query.includeDisabled) {
      where.status = { not: 'DISABLED' };
    }

    if (query.role) {
      where.role = query.role;
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take,
        skip,
        select: SAFE_USER_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, take, skip };
  }

  async findByIdOrFail(organizationId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId },
      select: SAFE_USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException('User nicht gefunden.');
    }
    return user;
  }

  /**
   * Prüft, dass ein User existiert und derselben Organization angehört,
   * ohne das gesamte Objekt zu laden. Wird von anderen Modulen (z. B.
   * Tasks) für Zuweisungsvalidierung genutzt.
   */
  async assertBelongsToOrganization(organizationId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Zugewiesener User existiert nicht in dieser Organization.');
    }
  }

  // -----------------------------------------------------------------
  // PATCH /users/:id (Sprint 3A)
  // -----------------------------------------------------------------
  async update(
    organizationId: string,
    targetUserId: string,
    dto: UpdateUserDto,
    currentUserRole: UserRole,
    currentUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // T1 (siehe docs/design/.../Kap. 9): Row-Lock auf die Organization
      // als Serialisierungspunkt für alle rollen-/statuskritischen
      // Änderungen dieser Organisation. Read Committed genügt, der
      // explizite Lock übernimmt die Serialisierung.
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;

      const existing = await tx.user.findFirst({ where: { id: targetUserId, organizationId } });
      if (!existing) {
        throw new NotFoundException('User nicht gefunden.');
      }

      // ADMIN darf keine OWNER-Rolle vergeben oder entziehen.
      const grantsOwner = dto.role === UserRole.OWNER && existing.role !== UserRole.OWNER;
      const revokesOwner = dto.role !== undefined && dto.role !== UserRole.OWNER && existing.role === UserRole.OWNER;
      if (currentUserRole !== UserRole.OWNER && (grantsOwner || revokesOwner)) {
        throw new ForbiddenException('Nur OWNER darf die OWNER-Rolle vergeben oder entziehen.');
      }

      const roleChanged = dto.role !== undefined && dto.role !== existing.role;
      const statusChanged = dto.status !== undefined && dto.status !== existing.status;
      const losesActiveOwnerStatus =
        existing.role === UserRole.OWNER &&
        existing.status === 'ACTIVE' &&
        ((roleChanged && dto.role !== UserRole.OWNER) || (statusChanged && dto.status !== 'ACTIVE'));

      if (losesActiveOwnerStatus) {
        const otherActiveOwners = await tx.user.count({
          where: {
            organizationId,
            role: UserRole.OWNER,
            status: 'ACTIVE',
            deletedAt: null,
            id: { not: targetUserId },
          },
        });
        if (otherActiveOwners === 0) {
          throw new ConflictException(
            'Der letzte verbleibende OWNER dieser Organization kann nicht degradiert oder suspendiert werden.',
          );
        }
      }

      // Rollenänderung ODER Suspendierung erhöht tokenVersion (siehe
      // docs/design/.../Kap. 4A.2).
      const statusChangedToSuspended = dto.status === 'SUSPENDED' && existing.status !== 'SUSPENDED';
      const shouldBumpTokenVersion = roleChanged || statusChangedToSuspended;

      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: dto.role,
          status: dto.status,
          tokenVersion: shouldBumpTokenVersion ? { increment: 1 } : undefined,
        },
        select: SAFE_USER_SELECT,
      });

      if (dto.firstName !== undefined || dto.lastName !== undefined) {
        await this.auditService.record(
          {
            organizationId,
            actorType: 'USER',
            actorId: currentUserId,
            action: 'USER_UPDATED',
            entityType: 'User',
            entityId: targetUserId,
            metadata: { firstName: dto.firstName, lastName: dto.lastName },
          },
          tx,
        );
      }
      if (roleChanged) {
        await this.auditService.record(
          {
            organizationId,
            actorType: 'USER',
            actorId: currentUserId,
            action: 'USER_ROLE_CHANGED',
            entityType: 'User',
            entityId: targetUserId,
            metadata: { from: existing.role, to: updated.role },
          },
          tx,
        );
      }
      if (statusChanged) {
        await this.auditService.record(
          {
            organizationId,
            actorType: 'USER',
            actorId: currentUserId,
            action: 'USER_STATUS_CHANGED',
            entityType: 'User',
            entityId: targetUserId,
            metadata: { from: existing.status, to: updated.status },
          },
          tx,
        );
      }

      return updated;
    });
  }

  // -----------------------------------------------------------------
  // DELETE /users/:id — Soft Delete (Sprint 3A)
  // -----------------------------------------------------------------
  async softDelete(organizationId: string, targetUserId: string, currentUserId: string) {
    if (targetUserId === currentUserId) {
      throw new ForbiddenException('Ein User kann sich nicht selbst deaktivieren.');
    }

    return this.prisma.$transaction(async (tx) => {
      // T1: identischer Row-Lock-Mechanismus wie in update().
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;

      const existing = await tx.user.findFirst({ where: { id: targetUserId, organizationId } });
      if (!existing) {
        throw new NotFoundException('User nicht gefunden.');
      }

      if (existing.role === UserRole.OWNER && existing.status === 'ACTIVE') {
        const otherActiveOwners = await tx.user.count({
          where: {
            organizationId,
            role: UserRole.OWNER,
            status: 'ACTIVE',
            deletedAt: null,
            id: { not: targetUserId },
          },
        });
        if (otherActiveOwners === 0) {
          throw new ConflictException(
            'Der letzte verbleibende OWNER dieser Organization kann nicht deaktiviert werden.',
          );
        }
      }

      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: {
          status: 'DISABLED',
          deletedAt: new Date(),
          deletedByUserId: currentUserId,
          tokenVersion: { increment: 1 },
        },
        select: SAFE_USER_SELECT,
      });

      await this.auditService.record(
        {
          organizationId,
          actorType: 'USER',
          actorId: currentUserId,
          action: 'USER_DISABLED',
          entityType: 'User',
          entityId: targetUserId,
          metadata: {},
        },
        tx,
      );

      return updated;
    });
  }

  // -----------------------------------------------------------------
  // PATCH /users/me/password (Sprint 3A)
  // -----------------------------------------------------------------
  async changeOwnPassword(organizationId: string, userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!user || !user.passwordHash) {
      // Sollte praktisch nie eintreten (User ist bereits authentifiziert),
      // aber sicherheitshalber keine unterschiedliche Fehlermeldung.
      throw new BadRequestException('Aktuelles Passwort ist falsch.');
    }

    const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!matches) {
      throw new BadRequestException('Aktuelles Passwort ist falsch.');
    }

    const newHash = await bcrypt.hash(dto.newPassword, PASSWORD_HASH_COST);

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { passwordHash: newHash, tokenVersion: { increment: 1 } },
      });

      // Niemals Passwort/Hash in Audit-Metadata (siehe
      // docs/design/.../Kap. 7).
      await this.auditService.record(
        {
          organizationId,
          actorType: 'USER',
          actorId: userId,
          action: 'USER_PASSWORD_CHANGED',
          entityType: 'User',
          entityId: userId,
          metadata: {},
        },
        tx,
      );

      return u;
    });

    // Aktuelles Token wird durch die tokenVersion-Erhöhung bereits
    // entwertet; ein frisches Token mit der neuen tokenVersion ersetzt
    // es direkt in der Response (siehe AuthService.issueTokenFor()).
    return this.authService.issueTokenFor(updated);
  }
}
