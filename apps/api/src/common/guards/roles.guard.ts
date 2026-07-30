import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Scope,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { TenantContext } from '../tenant/tenant-context';

/**
 * Einfache rollenbasierte Autorisierung (keine komplexe Permission
 * Engine). Greift nur auf Endpunkten mit `@Roles(...)`-Decorator; ohne
 * diesen Decorator lässt der Guard jeden authentifizierten Request durch
 * (die Authentifizierung selbst übernimmt bereits `JwtAuthGuard`).
 *
 * Der Development-Fallback über `X-Organization-Id` (siehe
 * `JwtAuthGuard`) liefert keine Rolle (`role: null`) und wird daher von
 * jedem rollenbeschränkten Endpunkt abgelehnt — dieser Modus erlaubt
 * bewusst nur unauthentifizierte Lesezugriffe auf Endpunkte ohne
 * `@Roles(...)`.
 */
@Injectable({ scope: Scope.REQUEST })
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContext,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const role = this.tenantContext.getRole();
    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException(
        `Diese Aktion erfordert eine der folgenden Rollen: ${requiredRoles.join(', ')}.`,
      );
    }

    return true;
  }
}
