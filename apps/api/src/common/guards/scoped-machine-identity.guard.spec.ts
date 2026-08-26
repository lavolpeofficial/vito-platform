import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ScopedMachineIdentityGuard } from './scoped-machine-identity.guard';

describe('ScopedMachineIdentityGuard', () => {
  const human = {
    userId: 'human-1',
    organizationId: 'org-1',
    role: UserRole.MEMBER,
    email: 'human@example.com',
    isMachineIdentity: false,
    machineScope: null,
  };
  const machine = {
    ...human,
    userId: 'machine-1',
    email: 'machine@example.com',
    isMachineIdentity: true,
    machineScope: 'vito-bridge',
  };

  function run(requiredScope: unknown, user?: Record<string, unknown>) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredScope),
    } as unknown as Reflector;
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    return new ScopedMachineIdentityGuard(reflector).canActivate(context);
  }

  it('preserves ordinary human and anonymous behavior on ordinary routes', () => {
    expect(run(undefined, human)).toBe(true);
    expect(run(undefined)).toBe(true);
  });

  it('allows only an exact machine scope on an opted-in route', () => {
    expect(run('vito-bridge', machine)).toBe(true);
  });

  it('denies a machine identity on every undecorated route', () => {
    expect(() => run(undefined, machine)).toThrow(ForbiddenException);
  });

  it.each([null, '', 'wrong-scope', 'unknown-scope'])(
    'denies a machine with invalid or mismatched scope %p',
    (machineScope) => {
      expect(() => run('vito-bridge', { ...machine, machineScope })).toThrow(
        ForbiddenException,
      );
    },
  );

  it('denies a human or anonymous identity on a machine-only route', () => {
    expect(() => run('vito-bridge', human)).toThrow(ForbiddenException);
    expect(() => run('vito-bridge')).toThrow(ForbiddenException);
  });

  it('fails closed on an inconsistent human identity carrying a scope', () => {
    expect(() => run(undefined, { ...human, machineScope: 'vito-bridge' })).toThrow(
      ForbiddenException,
    );
  });

  it('fails closed on a malformed machine classification', () => {
    expect(() =>
      run('vito-bridge', { ...machine, isMachineIdentity: undefined }),
    ).toThrow(ForbiddenException);
  });
});
