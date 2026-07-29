import { ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';

/**
 * Diese Unit-Tests mocken PrismaService/AuditService/AuthService
 * vollständig und prüfen ausschließlich die in UsersService
 * implementierten Geschäftsregeln (Sprint 3A). Sie ersetzen NICHT die
 * Integrations-/E2E-Tests gegen eine echte Datenbank (siehe
 * test/app.e2e-spec.ts für die Race-Condition- und
 * Transaktions-Verifikation mit echtem Row-Locking).
 */
describe('UsersService (Sprint 3A, Geschäftsregeln)', () => {
  const organizationId = 'org-1';

  function buildService(txOverrides: {
    findFirstResult?: any;
    countResult?: number;
    updateResult?: any;
  }) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: organizationId }]),
      user: {
        findFirst: jest.fn().mockResolvedValue(txOverrides.findFirstResult ?? null),
        count: jest.fn().mockResolvedValue(txOverrides.countResult ?? 0),
        update: jest.fn().mockResolvedValue(txOverrides.updateResult ?? {}),
      },
    };

    const prisma: any = {
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
      user: {
        findFirst: jest.fn(),
      },
    };

    const auditService: any = { record: jest.fn().mockResolvedValue(undefined) };
    const authService: any = { issueTokenFor: jest.fn().mockResolvedValue({ accessToken: 'new-token' }) };

    const service = new UsersService(prisma, auditService, authService);
    return { service, prisma, auditService, authService, tx };
  }

  describe('PATCH /users/:id — RBAC: ADMIN darf keine OWNER-Rolle vergeben/entziehen', () => {
    it('lehnt ADMIN ab, der einem MEMBER die OWNER-Rolle vergibt', async () => {
      const { service } = buildService({
        findFirstResult: { id: 'u1', role: UserRole.MEMBER, status: 'ACTIVE' },
      });

      await expect(
        service.update(organizationId, 'u1', { role: UserRole.OWNER }, UserRole.ADMIN, 'admin-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lehnt ADMIN ab, der einem bestehenden OWNER die Rolle entzieht', async () => {
      const { service } = buildService({
        findFirstResult: { id: 'u1', role: UserRole.OWNER, status: 'ACTIVE' },
        countResult: 1, // ein anderer aktiver OWNER existiert, Test soll trotzdem an der RBAC-Prüfung scheitern
      });

      await expect(
        service.update(organizationId, 'u1', { role: UserRole.MEMBER }, UserRole.ADMIN, 'admin-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('erlaubt OWNER, eine OWNER-Rolle zu vergeben', async () => {
      const { service, tx } = buildService({
        findFirstResult: { id: 'u1', role: UserRole.MEMBER, status: 'ACTIVE' },
        updateResult: { id: 'u1', role: UserRole.OWNER, status: 'ACTIVE' },
      });

      await service.update(organizationId, 'u1', { role: UserRole.OWNER }, UserRole.OWNER, 'owner-1');

      expect(tx.user.update).toHaveBeenCalled();
    });
  });

  describe('Letzter-OWNER-Invariante', () => {
    it('lehnt Degradierung des letzten aktiven OWNER ab (409)', async () => {
      const { service } = buildService({
        findFirstResult: { id: 'u1', role: UserRole.OWNER, status: 'ACTIVE' },
        countResult: 0, // kein anderer aktiver OWNER
      });

      await expect(
        service.update(organizationId, 'u1', { role: UserRole.MEMBER }, UserRole.OWNER, 'owner-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('lehnt Suspendierung des letzten aktiven OWNER ab (409)', async () => {
      const { service } = buildService({
        findFirstResult: { id: 'u1', role: UserRole.OWNER, status: 'ACTIVE' },
        countResult: 0,
      });

      await expect(
        service.update(organizationId, 'u1', { status: 'SUSPENDED' as any }, UserRole.OWNER, 'owner-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('erlaubt Degradierung, wenn ein anderer aktiver OWNER existiert', async () => {
      const { service, tx } = buildService({
        findFirstResult: { id: 'u1', role: UserRole.OWNER, status: 'ACTIVE' },
        countResult: 1,
        updateResult: { id: 'u1', role: UserRole.MEMBER, status: 'ACTIVE' },
      });

      await service.update(organizationId, 'u1', { role: UserRole.MEMBER }, UserRole.OWNER, 'owner-1');
      expect(tx.user.update).toHaveBeenCalled();
    });

    it('lehnt Soft-Delete des letzten aktiven OWNER ab (409)', async () => {
      const { service } = buildService({
        findFirstResult: { id: 'u1', role: UserRole.OWNER, status: 'ACTIVE' },
        countResult: 0,
      });

      await expect(service.softDelete(organizationId, 'u1', 'owner-2')).rejects.toThrow(ConflictException);
    });
  });

  describe('tokenVersion-Erhöhung', () => {
    it('erhöht tokenVersion bei Rollenwechsel', async () => {
      const { service, tx } = buildService({
        findFirstResult: { id: 'u1', role: UserRole.MEMBER, status: 'ACTIVE' },
        countResult: 5,
        updateResult: { id: 'u1', role: UserRole.ADMIN, status: 'ACTIVE' },
      });

      await service.update(organizationId, 'u1', { role: UserRole.ADMIN }, UserRole.OWNER, 'owner-1');

      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tokenVersion: { increment: 1 } }) }),
      );
    });

    it('erhöht tokenVersion bei Suspendierung', async () => {
      const { service, tx } = buildService({
        findFirstResult: { id: 'u1', role: UserRole.MEMBER, status: 'ACTIVE' },
        updateResult: { id: 'u1', role: UserRole.MEMBER, status: 'SUSPENDED' },
      });

      await service.update(organizationId, 'u1', { status: 'SUSPENDED' as any }, UserRole.OWNER, 'owner-1');

      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tokenVersion: { increment: 1 } }) }),
      );
    });

    it('erhöht tokenVersion NICHT bei reiner Namensänderung', async () => {
      const { service, tx } = buildService({
        findFirstResult: { id: 'u1', role: UserRole.MEMBER, status: 'ACTIVE' },
        updateResult: { id: 'u1', role: UserRole.MEMBER, status: 'ACTIVE' },
      });

      await service.update(organizationId, 'u1', { firstName: 'Neu' }, UserRole.OWNER, 'owner-1');

      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tokenVersion: undefined }) }),
      );
    });
  });

  describe('Soft Delete', () => {
    it('lehnt Selbst-Deaktivierung ab', async () => {
      const { service } = buildService({});
      await expect(service.softDelete(organizationId, 'self-1', 'self-1')).rejects.toThrow(ForbiddenException);
    });

    it('setzt status/deletedAt/deletedByUserId/tokenVersion atomar', async () => {
      const { service, tx } = buildService({
        findFirstResult: { id: 'u1', role: UserRole.MEMBER, status: 'ACTIVE' },
        updateResult: { id: 'u1', status: 'DISABLED' },
      });

      await service.softDelete(organizationId, 'u1', 'admin-1');

      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DISABLED',
            deletedByUserId: 'admin-1',
            tokenVersion: { increment: 1 },
          }),
        }),
      );
    });
  });

  describe('PATCH /users/me/password', () => {
    it('lehnt falsches aktuelles Passwort ab', async () => {
      const { service, prisma } = buildService({});
      const hash = await bcrypt.hash('correct-password', 4);
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: hash });

      await expect(
        service.changeOwnPassword(organizationId, 'u1', {
          currentPassword: 'wrong-password',
          newPassword: 'new-password-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('akzeptiert richtiges aktuelles Passwort und liefert ein neues Token', async () => {
      const { service, prisma, authService } = buildService({
        updateResult: { id: 'u1', tokenVersion: 2 },
      });
      const hash = await bcrypt.hash('correct-password', 4);
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: hash });

      const result = await service.changeOwnPassword(organizationId, 'u1', {
        currentPassword: 'correct-password',
        newPassword: 'new-password-123',
      });

      expect(authService.issueTokenFor).toHaveBeenCalled();
      expect(result.accessToken).toBe('new-token');
    });
  });
});
