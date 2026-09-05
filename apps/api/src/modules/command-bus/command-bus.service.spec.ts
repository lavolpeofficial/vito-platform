import { UserRole } from '@prisma/client';
import { CommandBusService } from './command-bus.service';

describe('CommandBusService', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const jwtOwner = {
    organizationId: 'org-1',
    userId: 'user-1',
    role: UserRole.OWNER,
    authenticationMethod: 'jwt' as const,
  };

  beforeEach(() => jest.clearAllMocks());

  it('derives L0 command policy, tenant and actor server-side', async () => {
    const execute = jest.fn().mockResolvedValue({ gate: 'G35' });
    const bus = new CommandBusService(audit);
    bus.register({
      commandType: 'WORLD.GET_STATUS',
      target: 'WORLD',
      requiredApprovalLevel: 'L0',
      execute,
    });

    const result = await bus.dispatchRequest({ commandType: 'WORLD.GET_STATUS', parameters: {} }, jwtOwner);

    expect(result.status).toBe('SUCCEEDED');
    expect(result.data).toEqual({ gate: 'G35' });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'WORLD.GET_STATUS',
      organizationId: 'org-1',
      requestedBy: 'user-1',
      target: 'WORLD',
      approvalLevel: 'L0',
    }));
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('fails closed when no handler exists', async () => {
    const bus = new CommandBusService(audit);
    const result = await bus.dispatchRequest({ commandType: 'WORLD.UNKNOWN', parameters: {} }, jwtOwner);
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('HANDLER_NOT_FOUND');
  });

  it('rejects insecure-header callers even for L0 commands', async () => {
    const bus = new CommandBusService(audit);
    bus.register({
      commandType: 'WORLD.GET_STATUS',
      target: 'WORLD',
      requiredApprovalLevel: 'L0',
      execute: jest.fn(),
    });
    const result = await bus.dispatchRequest(
      { commandType: 'WORLD.GET_STATUS', parameters: {} },
      { organizationId: 'org-1', userId: null, role: null, authenticationMethod: 'insecure-header' },
    );
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('JWT_AUTH_REQUIRED');
  });

  it('requires OWNER or ADMIN for L3 commands', async () => {
    const bus = new CommandBusService(audit);
    const execute = jest.fn();
    bus.register({
      commandType: 'WORLD.RUN_GATE',
      target: 'WORLD',
      requiredApprovalLevel: 'L3',
      execute,
    });
    const result = await bus.dispatchRequest(
      { commandType: 'WORLD.RUN_GATE', parameters: { gate: 'G35' } },
      { ...jwtOwner, role: UserRole.MEMBER },
    );
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('COMMAND_POLICY_DENIED');
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps L4/L5 closed until an approval workflow exists', async () => {
    const bus = new CommandBusService(audit);
    bus.register({
      commandType: 'WORLD.DANGEROUS',
      target: 'WORLD',
      requiredApprovalLevel: 'L5',
      execute: jest.fn(),
    });
    const result = await bus.dispatchRequest({ commandType: 'WORLD.DANGEROUS', parameters: {} }, jwtOwner);
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('APPROVAL_WORKFLOW_REQUIRED');
  });

  it('rejects duplicate handlers', () => {
    const bus = new CommandBusService(audit);
    const handler = {
      commandType: 'WORLD.GET_STATUS',
      target: 'WORLD',
      requiredApprovalLevel: 'L0' as const,
      execute: jest.fn(),
    };
    bus.register(handler);
    expect(() => bus.register(handler)).toThrow('Duplicate command handler');
  });
});
