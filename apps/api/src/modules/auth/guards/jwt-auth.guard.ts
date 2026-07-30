import { ExecutionContext, Injectable, Scope, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { TENANT_HEADER, TenantContext } from '../../../common/tenant/tenant-context';
import { AuthenticatedUser } from '../../../common/auth/authenticated-user.interface';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Globaler Authentifizierungs-Guard (siehe AppModule, APP_GUARD).
 *
 * Verhalten:
 * 1. `@Public()`-Routen (GET /health, POST /auth/login) werden ohne
 *    Prüfung durchgelassen.
 * 2. Ist ein `Authorization: Bearer <token>`-Header vorhanden, wird das
 *    JWT über die Passport-`JwtStrategy` verifiziert (Signatur, Ablauf,
 *    und die in JwtStrategy.validate() implementierte
 *    Tenant-Sicherheitsprüfung). Bei Erfolg wird der request-scoped
 *    `TenantContext` ausschließlich aus dem JWT befüllt
 *    (`authenticationMethod: 'jwt'`). Ein evtl. vorhandener
 *    `X-Organization-Id`-Header wird in diesem Fall NICHT gelesen und
 *    kann die JWT-organizationId daher niemals überschreiben.
 * 3. Ist KEIN Authorization-Header vorhanden, wird ausschließlich dann
 *    ein Fallback auf den ungeprüften `X-Organization-Id`-Header
 *    zugelassen, wenn `ALLOW_INSECURE_TENANT_HEADER=true` gesetzt ist
 *    (Standard: `false`; die Anwendung startet gar nicht erst, wenn
 *    dieses Flag zusammen mit `NODE_ENV=production` aktiv ist, siehe
 *    main.ts). In diesem Fall wird der TenantContext mit
 *    `authenticationMethod: 'insecure-header'` und `role: null` befüllt
 *    — `RolesGuard` verweigert dadurch automatisch jede Aktion, die
 *    eine bestimmte Rolle voraussetzt.
 * 4. In jedem anderen Fall: `401 Unauthorized`.
 */
@Injectable({ scope: Scope.REQUEST })
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const hasBearerToken = !!request.headers.authorization;

    if (!hasBearerToken) {
      return this.tryInsecureHeaderFallback(request);
    }

    const activated = (await super.canActivate(context)) as boolean;
    if (!activated) {
      return false;
    }

    const user = request.user as AuthenticatedUser;
    this.tenantContext.set({
      organizationId: user.organizationId,
      userId: user.userId,
      role: user.role,
      authenticationMethod: 'jwt',
    });

    return true;
  }

  private tryInsecureHeaderFallback(request: Request): boolean {
    if (process.env.ALLOW_INSECURE_TENANT_HEADER !== 'true') {
      throw new UnauthorizedException('Authentifizierung erforderlich.');
    }

    const headerValue = request.header(TENANT_HEADER);
    if (!headerValue || !UUID_REGEX.test(headerValue)) {
      throw new UnauthorizedException('Authentifizierung erforderlich.');
    }

    this.tenantContext.set({
      organizationId: headerValue,
      userId: null,
      role: null,
      authenticationMethod: 'insecure-header',
    });

    return true;
  }
}
