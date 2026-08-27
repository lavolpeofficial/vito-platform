import { UnauthorizedException } from '@nestjs/common';
import { OperatorBridgeController } from './operator-bridge.controller';

describe('OperatorBridgeController', () => {
  const submitTask = jest.fn();
  const getTask = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('derives tenant and actor identity exclusively from TenantContext', async () => {
    const controller = new OperatorBridgeController(
      { submitTask, getTask } as any,
      { getOrThrow: () => 'org-1', getUserId: () => 'user-1' } as any,
    );
    const dto = {
      requestId: '0b31931b-aa1c-4570-bc5d-f9cd90b4970e',
      capabilityCode: 'CODE_BUILD',
      prompt: 'Implement it.',
    };
    const response = {
      taskId: 'task-1',
      requestId: dto.requestId,
      correlationId: 'correlation-1',
      status: 'COMPLETED',
      routingDecisionId: null,
    };
    submitTask.mockResolvedValue(response);

    await expect(controller.submit(dto)).resolves.toEqual(response);
    expect(submitTask).toHaveBeenCalledWith('org-1', 'user-1', dto);
  });

  it('preserves the duplicate DISPATCHING response shape', async () => {
    const controller = new OperatorBridgeController(
      { submitTask, getTask } as any,
      { getOrThrow: () => 'org-1', getUserId: () => 'user-1' } as any,
    );
    const dto = {
      requestId: '0b31931b-aa1c-4570-bc5d-f9cd90b4970e',
      capabilityCode: 'CODE_BUILD',
      prompt: 'Implement it.',
    };
    const duplicate = {
      taskId: 'task-1',
      requestId: dto.requestId,
      correlationId: 'correlation-1',
      status: 'DISPATCHING',
      routingDecisionId: null,
    };
    submitTask.mockResolvedValue(duplicate);

    await expect(controller.submit(dto)).resolves.toEqual(duplicate);
  });

  it('rejects a non-JWT tenant context before submission', () => {
    const controller = new OperatorBridgeController(
      { submitTask, getTask } as any,
      { getOrThrow: () => 'org-1', getUserId: () => null } as any,
    );

    expect(() =>
      controller.submit({
        requestId: '0b31931b-aa1c-4570-bc5d-f9cd90b4970e',
        capabilityCode: 'CODE_BUILD',
        prompt: 'Implement it.',
      }),
    ).toThrow(UnauthorizedException);
    expect(submitTask).not.toHaveBeenCalled();
  });

  it('uses the tenant context for GET and preserves purged result semantics', async () => {
    const purged = {
      prompt: null,
      patch: null,
      stdout: null,
      stderr: null,
      sensitivePayloadAvailable: false,
    };
    getTask.mockResolvedValue(purged);
    const controller = new OperatorBridgeController(
      { submitTask, getTask } as any,
      { getOrThrow: () => 'org-1', getUserId: () => 'user-1' } as any,
    );

    await expect(controller.get('task-1')).resolves.toEqual(purged);
    expect(getTask).toHaveBeenCalledWith('org-1', 'task-1');
  });
});
