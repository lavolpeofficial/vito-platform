import { CommandBusService } from './command-bus.service';
import type { VitoCommand } from './command-bus.types';

describe('CommandBusService', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const command: VitoCommand = {
    commandId: 'cmd-1', commandType: 'WORLD.GET_STATUS', organizationId: 'org-1', requestedBy: 'jarvis', target: 'WORLD', parameters: {}, approvalLevel: 'L0', correlationId: 'corr-1', timestamp: new Date().toISOString(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('dispatches a registered L0 command and audits lifecycle', async () => {
    const bus = new CommandBusService(audit);
    bus.register({ commandType: 'WORLD.GET_STATUS', execute: jest.fn().mockResolvedValue({ gate: 'G35' }) });
    const result = await bus.dispatch(command);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.data).toEqual({ gate: 'G35' });
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('fails closed when no handler exists', async () => {
    const bus = new CommandBusService(audit);
    const result = await bus.dispatch(command);
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('HANDLER_NOT_FOUND');
  });

  it('requires approval for L4/L5', async () => {
    const bus = new CommandBusService(audit);
    bus.register({ commandType: 'WORLD.GET_STATUS', execute: jest.fn() });
    const result = await bus.dispatch({ ...command, approvalLevel: 'L5' });
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('APPROVAL_REQUIRED');
  });

  it('rejects duplicate handlers', () => {
    const bus = new CommandBusService(audit);
    const handler = { commandType: 'WORLD.GET_STATUS', execute: jest.fn() };
    bus.register(handler);
    expect(() => bus.register(handler)).toThrow('Duplicate command handler');
  });
});
