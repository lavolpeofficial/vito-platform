import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from './authenticated-user.interface';

/**
 * Liefert den per JWT authentifizierten User (siehe JwtStrategy.validate).
 * Nur auf Routen sinnvoll, die durch JwtAuthGuard tatsächlich einen
 * gültigen JWT verlangt haben (nicht auf @Public()-Routen und nicht im
 * Development-Fallback über X-Organization-Id, dort gibt es keinen User).
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
  if (!request.user) {
    throw new UnauthorizedException('Kein authentifizierter User im Request-Kontext vorhanden.');
  }
  return request.user;
});
