import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Beschränkt einen Endpunkt auf die angegebenen Rollen. Ohne diesen
 * Decorator lässt `RolesGuard` jeden authentifizierten (per JWT
 * verifizierten) User zu — die Beschränkung ist opt-in pro Endpunkt.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
