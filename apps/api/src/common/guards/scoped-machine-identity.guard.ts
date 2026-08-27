import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Scope,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { MACHINE_SCOPE_KEY } from '../decorators/machine-scope.decorator';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Injectable({ scope: Scope.REQUEST })
export class ScopedMachineIdentityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScope = this.reflector.getAllAndOverride<unknown>(MACHINE_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      if (requiredScope !== undefined) {
        throw new ForbiddenException('Machine identity required.');
      }
      return true;
    }

    if (user.isMachineIdentity === false) {
      if (user.machineScope !== null) {
        throw new ForbiddenException('Invalid identity classification.');
      }
      if (requiredScope !== undefined) {
        throw new ForbiddenException('Machine identity required.');
      }
      return true;
    }

    if (
      user.isMachineIdentity !== true ||
      typeof user.machineScope !== 'string' ||
      user.machineScope.length === 0 ||
      typeof requiredScope !== 'string' ||
      requiredScope.length === 0 ||
      user.machineScope !== requiredScope
    ) {
      throw new ForbiddenException('Machine identity is not authorized for this route.');
    }

    return true;
  }
}
