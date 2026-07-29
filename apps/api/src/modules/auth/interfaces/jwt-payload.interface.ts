import { UserRole } from '@prisma/client';

/**
 * Inhalt des ausgestellten JWT. Enthält bewusst nur die für
 * Tenant-Scoping und grobe Autorisierung nötigen Claims — keine
 * sensiblen Daten (kein Name, keine E-Mail, kein Passwort-Hash).
 *
 * `token_version` (Sprint 2.1, siehe ADR-003 "Token Versioning"):
 * Spiegel von `User.tokenVersion` zum Ausstellungszeitpunkt. Erlaubt es,
 * alle zuvor ausgestellten Tokens eines Users gezielt zu entwerten (z. B.
 * bei Passwort-Änderung oder Verdacht auf Kompromittierung), indem
 * `User.tokenVersion` erhöht wird — ohne eine Blacklist pflegen zu
 * müssen. `JwtStrategy.validate()` vergleicht diesen Claim bei jedem
 * Request gegen den aktuellen DB-Wert.
 */
export interface JwtPayload {
  /** userId */
  sub: string;
  /** organizationId */
  org_id: string;
  role: UserRole;
  token_version: number;
}
