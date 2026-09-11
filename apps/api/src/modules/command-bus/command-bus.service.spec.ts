import { UserRole } from '@prisma/client';
import { LearningRetrievalService } from '../learning/learning-retrieval.service';
import { CommandBusService } from './command-bus.service';

describe('CommandBusService', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const learningItem = {
    kind: 'FAILURE_PATTERN' as const,
    sourceId: 'failure-1',
    title: 'Avoid stale deployment target',
    detail: 'Verify the target before execution.',
    maturity: null,
    confidence: 0.91,
    createdAt: new Date('2026-09-11T04:00:00Z'),
  };
  const learningRetrieval = {
    retrieve: jest.fn().mockResolvedValue([learningItem]),
  } as unknown as jest.Mocked<LearningRetrievalService>;
  const jwtOwner = {
    organizationId: 'org-1',
    userId: 'user-1',
    role: UserRole.OWNER,
    authenticationMethod: 'jwt' as const,
  };

  const newBus = () => new CommandBusService(audit, learningRetrieval);

  beforeEach(() => {
    jest.clearAllMocks();
    learningRetrieval.retrieve.mockResolvedValue([learningItem]);
  });

  it('derives L0 command policy, tenant and actor server-side and attaches prior learning before execution', async () => {
    const execute = jest.fn().mockResolvedValue({ gate: 'G35' });
    const bus = newBus();
    bus.register({
      commandType: 'WORLD.GET_STATUS',
      target: 'WORLD',
      requiredApprovalLevel: 'L0',
      execute,
    });

    const result = await bus.dispatchRequest(
      { commandType: 'WORLD.GET_STATUS', parameters: { gate: 'G35' } },
      jwtOwner,
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.data).toEqual({ gate: 'G35' });
    expect(learningRetrieval.retrieve).toHaveBeenCalledWith({
      query: 'WORLD.GET_STATUS WORLD gate G35',
      limit: 8,
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'WORLD.GET_STATUS',
      organizationId: 'org-1',
      requestedBy: 'user-1',
      target: 'WORLD',
      approvalLevel: 'L0',
      learningContext: [learningItem],
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'COMMAND.STARTED',
      metadata: expect.objectContaining({
        learningItemCount: 1,
        learningKinds: ['FAILURE_PATTERN'],
      }),
    }));
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('keeps learning retrieval advisory when retrieval fails', async () => {
    learningRetrieval.retrieve.mockRejectedValueOnce(new Error('learning store unavailable'));
    const execute = jest.fn().mockResolvedValue({ gate: 'G35' });
    const bus = newBus();
    bus.register({
      commandType: 'WORLD.GET_STATUS',
      target: 'WORLD',
      requiredApprovalLevel: 'L0',
      execute,
    });

    const result = await bus.dispatchRequest({ commandType: 'WORLD.GET_STATUS', parameters: {} }, jwtOwner);

    expect(result.status).toBe('SUCCEEDED');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ learningContext: [] }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'COMMAND.LEARNING_RETRIEVAL_FAILED',
      metadata: expect.objectContaining({ reason: 'learning store unavailable' }),
    }));
  });

  it('fails closed when no handler exists without retrieving learning', async () => {
    const bus = newBus();
    const result = await bus.dispatchRequest({ commandType: 'WORLD.UNKNOWN', parameters: {} }, jwtOwner);
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('HANDLER_NOT_FOUND');
    expect(learningRetrieval.retrieve).not.toHaveBeenCalled();
  });

  it('rejects insecure-header callers without writing a tenant-scoped audit or retrieving learning', async () => {
    const bus = newBus();
    bus.register({
      commandType: 'WORLD.GET_STATUS',
      target: 'WORLD',
      requiredApprovalLevel: 'L0',
      execute: jest.fn(),
    });
    const result = await bus.dispatchRequest(
      { commandType: 'WORLD.GET_STATUS', parameters: {} },
      { organizationId: 'untrusted-org', userId: null, role: null, authenticationMethod: 'insecure-header' },
    );
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('JWT_AUTH_REQUIRED');
    expect(audit.record).not.toHaveBeenCalled();
    expect(learningRetrieval.retrieve).not.toHaveBeenCalled();
  });

  it('requires OWNER or ADMIN for L3 commands before retrieving learning', async () => {
    const bus = newBus();
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
    expect(learningRetrieval.retrieve).not.toHaveBeenCalled();
  });

  it('keeps L4/L5 closed until an approval workflow exists', async () => {
    const bus = newBus();
    bus.register({
      commandType: 'WORLD.DANGEROUS',
      target: 'WORLD',
      requiredApprovalLevel: 'L5',
      execute: jest.fn(),
    });
    const result = await bus.dispatchRequest({ commandType: 'WORLD.DANGEROUS', parameters: {} }, jwtOwner);
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('APPROVAL_WORKFLOW_REQUIRED');
    expect(learningRetrieval.retrieve).not.toHaveBeenCalled();
  });

  it('rejects duplicate handlers', () => {
    const bus = newBus();
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
