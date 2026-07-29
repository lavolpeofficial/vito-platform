import { Injectable, Scope, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const TENANT_HEADER = 'x-organization-id';

export type AuthenticationMethod = 'jwt' | 'insecure-header';

export interface TenantContextData {
  organizationId: string;
  userId: string | null;
  role: UserRole | null;
  authenticationMethod: AuthenticationMethod;
}

/**
 * Request-scoped Tenant-/Auth-Kontext.
 *
 * Seit Sprint 2 wird dieser Kontext ausschließlich durch `JwtAuthGuard`
 * befüllt:
 *
 * - Regulärer Fall (`authenticationMethod: 'jwt'`): `organizationId`,
 *   `userId` und `role` stammen aus einem verifizierten JWT, dessen
 *   Claims zusätzlich pro Request gegen die Datenbank geprüft wurden
 *   (siehe JwtStrategy.validate() und ADR-003).
 * - Ausnahme nur für lokale Entwicklung
 *   (`authenticationMethod: 'insecure-header'`): `organizationId` stammt
 *   aus dem ungeprüften Header `X-Organization-Id`, `userId`/`role` sind
 *   `null`. Dieser Pfad ist nur aktiv, wenn `ALLOW_INSECURE_TENANT_HEADER
 *   =true` gesetzt ist; die Anwendung verweigert den Start, wenn dieses
 *   Flag zusammen mit `NODE_ENV=production` gesetzt ist (siehe main.ts).
 *
 * `X-Organization-Id` überschreibt NIEMALS eine aus einem gültigen JWT
 * abgeleitete organizationId — der Header wird von JwtAuthGuard nur
 * überhaupt betrachtet, wenn kein Authorization-Header vorhanden ist.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  private data: TenantContextData | undefined;

  set(data: TenantContextData): void {
    this.data = data;
  }

  private getDataOrThrow(): TenantContextData {
    if (!this.data) {
      throw new UnauthorizedException('Kein authentifizierter Tenant-Kontext vorhanden.');
    }
    return this.data;
  }

  /** Liefert die organizationId des aktuellen Requests. */
  getOrThrow(): string {
    return this.getDataOrThrow().organizationId;
  }

  /** Liefert die userId, sofern per JWT authentifiziert (sonst null). */
  getUserId(): string | null {
    return this.getDataOrThrow().userId;
  }

  /** Liefert die Rolle, sofern per JWT authentifiziert (sonst null). */
  getRole(): UserRole | null {
    return this.getDataOrThrow().role;
  }

  getAuthenticationMethod(): AuthenticationMethod {
    return this.getDataOrThrow().authenticationMethod;
  }

  isSet(): boolean {
    return !!this.data;
  }
}
