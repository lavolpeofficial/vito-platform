import { UserRole } from '@prisma/client';

/**
 * Ergebnis von JwtStrategy.validate(). Wird von Passport als
 * `request.user` angehängt und von JwtAuthGuard zusätzlich in den
 * request-scoped TenantContext übernommen.
 *
 * Enthält bewusst nur, was für Tenant-Scoping und Autorisierung nötig
 * ist — keine sensiblen Daten (kein passwordHash, keine vollständigen
 * Profildaten).
 */
export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  role: UserRole;
  email: string;
  isMachineIdentity: boolean;
  machineScope: string | null;
}
