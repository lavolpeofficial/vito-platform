import { InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { OperatorTaskStatus, Prisma } from '@prisma/client';
import { AgentExecutionStatus } from '@vito/contracts';
import { OperatorBridgeService, isOperatorRequestKeyConflict } from './operator-bridge.service';

describe('OperatorBridgeService', () => {
  const now = new Date('2026-08-26T00:00:00.000Z');
  const request = {
    requestId: '0b31931b-aa1c-4570-bc5d-f9cd90b4970e',
    capabilityCode: 'CODE_BUILD',
    prompt: 'Implement the bounded task.',
    assuranceLevel: 'AL-3',
    budget: { maxDurationMs: 120_000, maxTokens: 1000, maxCostMinorUnits: 50 },
  };

  function task(status: OperatorTaskStatus = OperatorTaskStatus.DISPATCHING) {
    return {
      id: '6c49540f-2934-4207-a5ae-bc6cfb6eb19a',
      organizationId: 'org-1',
      userId: 'user-1',
      requestId: request.requestId,
      requestFingerprint: 'fingerprint',
      correlationId: 'corr-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      capabilityCode: request.capabilityCode,
      prompt: request.prompt,
      assuranceLevel: request.assuranceLevel,
      status,
      maxDurationMs: 120_000,
      maxTokens: 1000,
      maxCostMinorUnits: 50,
      invocationId: null,
      executionId: null,
      routingDecisionId: null,
      providerCode: null,
      providerName: null,
      stdout: null,
      stderr: null,
      changedFiles: null,
      patch: null,
      errorReason: null,
      errorMessage: null,
      errorRetryable: null,
      reviewRequired: false,
      workspaceDisposition: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      sensitivePayloadAvailable: true,
      sensitivePayloadExpiresAt: new Date('2026-08-27T00:00:00.000Z'),
      sensitivePayloadDeletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  const dispatchResult: any = {
    routingDecisionId: 'route-1',
    selectedProviderId: 'provider-1',
    selectedProviderCode: 'opencode-local',
    correlationId: 'corr-1',
    execution: {
      invocationId: 'inv-1',
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      correlationId: 'corr-1',
      capabilityCode: 'CODE_BUILD',
      providerId: 'provider-1',
      status: AgentExecutionStatus.SUCCEEDED,
      startedAt: now,
      completedAt: new Date(now.getTime() + 1000),
      durationMs: 1000,
      providerExecutionMetadata: {
        stdout: 'ok',
        stderr: '',
        workspaceDisposition: 'CLEANED',
        governedResultSettling: {
          executionId: 'execution-1',
          changedFiles: ['src/index.ts'],
          patch: 'diff --git a/src/index.ts b/src/index.ts\n+safe patch body',
        },
      },
      policyDecisionReference: 'policy-1',
    },
  };

  function setup(options: {
    existing?: ReturnType<typeof task>;
    dispatchError?: unknown;
    result?: typeof dispatchResult;
    transactionBError?: Error;
  } = {}) {
    let transactionActive = false;
    let transactionCount = 0;
    const created = task();
    const findUnique = jest.fn().mockResolvedValue(options.existing ?? null);
    const create = jest.fn().mockImplementation(async ({ data }) => {
      Object.assign(created, data);
      return created;
    });
    const update = jest.fn().mockImplementation(async ({ data }) => {
      if (options.transactionBError) throw options.transactionBError;
      return { ...created, ...data, updatedAt: now };
    });
    const tx = {
      operatorTask: { findUnique, create, update },
      agentProvider: {
        findFirst: jest.fn().mockResolvedValue({ displayName: 'OpenCode Local' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          sensitivePayloadAvailable: true,
          sensitivePayloadExpiresAt: new Date('2026-08-27T00:00:00.000Z'),
          sensitivePayloadDeletedAt: null,
          databaseNow: now,
        },
      ]),
      auditEvent: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
        transactionCount += 1;
        transactionActive = true;
        try {
          return await callback(tx);
        } finally {
          transactionActive = false;
        }
      }),
      operatorTask: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    const dispatch = jest.fn().mockImplementation(async (input) => {
      expect(transactionActive).toBe(false);
      expect(transactionCount).toBe(1);
      expect(input).toMatchObject({
        organizationId: created.organizationId,
        capabilityCode: created.capabilityCode,
        prompt: created.prompt,
      });
      if (options.dispatchError) throw options.dispatchError;
      return options.result ?? dispatchResult;
    });
    const record = jest.fn();
    const service = new OperatorBridgeService(
      prisma as any,
      { dispatch } as any,
      { record } as any,
      { exposure: 'internal', sensitivePayloadTtlHours: 72 },
    );
    return { service, prisma, tx, dispatch, record, created };
  }

  it('commits Transaction A before dispatch and uses Transaction B for terminal persistence', async () => {
    const fixture = setup();

    const response = await fixture.service.submitTask('org-1', 'user-1', request);
    expect(response).toMatchObject({
      status: OperatorTaskStatus.COMPLETED,
      routingDecisionId: 'route-1',
    });
    expect(response.taskId).toBe(fixture.created.id);

    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.tx.operatorTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OperatorTaskStatus.COMPLETED }),
      }),
    );
  });

  it.each([
    OperatorTaskStatus.DISPATCHING,
    OperatorTaskStatus.COMPLETED,
    OperatorTaskStatus.HUMAN_GATE,
    OperatorTaskStatus.FAILED,
  ])(
    'never redispatches an existing %s task',
    async (status) => {
      const existing = task(status);
      const { computeRequestFingerprint } = await import('./idempotency');
      existing.requestFingerprint = computeRequestFingerprint(request);
      const fixture = setup({ existing });

      await expect(fixture.service.submitTask('org-1', 'user-1', request)).resolves.toMatchObject({
        taskId: existing.id,
        status,
      });
      expect(fixture.dispatch).not.toHaveBeenCalled();
      expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(1);
    },
  );

  it('fails closed on an existing request key with a different fingerprint', async () => {
    const fixture = setup({ existing: task() });
    await expect(fixture.service.submitTask('org-1', 'user-1', request)).rejects.toMatchObject({
      message: 'OPERATOR_IDEMPOTENCY_CONFLICT',
    });
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it('maps a thrown dispatch failure and persists FAILED in Transaction B', async () => {
    const fixture = setup({
      dispatchError: new ServiceUnavailableException({
        code: 'NO_ELIGIBLE_AGENT_PROVIDER',
        routingDecisionId: 'route-none',
        message: 'No provider.',
      }),
    });

    await expect(fixture.service.submitTask('org-1', 'user-1', request)).resolves.toMatchObject({
      status: OperatorTaskStatus.FAILED,
      routingDecisionId: 'route-none',
    });
    expect(fixture.tx.operatorTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OperatorTaskStatus.FAILED,
          errorReason: 'NO_ELIGIBLE_AGENT_PROVIDER',
          errorRetryable: true,
        }),
      }),
    );
  });

  it.each([
    [AgentExecutionStatus.POLICY_BLOCKED, OperatorTaskStatus.HUMAN_GATE, true],
    [AgentExecutionStatus.FAILED, OperatorTaskStatus.FAILED, false],
    [AgentExecutionStatus.TIMED_OUT, OperatorTaskStatus.FAILED, false],
    [AgentExecutionStatus.CANCELLED, OperatorTaskStatus.FAILED, false],
    [AgentExecutionStatus.QUOTA_BLOCKED, OperatorTaskStatus.FAILED, false],
  ])(
    'maps governed %s to terminal %s through Transaction B',
    async (executionStatus, expectedStatus, reviewRequired) => {
      const fixture = setup({
        result: {
          ...dispatchResult,
          execution: {
            ...dispatchResult.execution,
            status: executionStatus,
            normalizedError: {
              reason: 'EXECUTION_FAILED' as any,
              message: 'Governed failure.',
              retryable: false,
            },
          },
        },
      });

      await expect(fixture.service.submitTask('org-1', 'user-1', request)).resolves.toMatchObject({
        status: expectedStatus,
      });
      expect(fixture.tx.operatorTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: expectedStatus, reviewRequired }),
        }),
      );
    },
  );

  it('redacts text summaries while preserving the authoritative patch exactly', async () => {
    const secret = 'Bearer abcdefghijklmnopqrstuvwxyz123456';
    const governedPatch = `diff --git a/a b/a\r\n+const fixture = '${secret}';\r\n`;
    const fixture = setup({
      result: {
        ...dispatchResult,
        execution: {
          ...dispatchResult.execution,
          providerExecutionMetadata: {
            ...dispatchResult.execution.providerExecutionMetadata,
            stdout: `stdout ${secret}`,
            stderr: `stderr ${secret}`,
            governedResultSettling: {
              executionId: 'execution-1',
              changedFiles: ['src/index.ts'],
              patch: governedPatch,
            },
          },
        },
      },
    });

    await fixture.service.submitTask('org-1', 'user-1', request);
    const data = fixture.tx.operatorTask.update.mock.calls[0][0].data;
    expect(data.stdout).toContain('[REDACTED]');
    expect(data.stderr).toContain('[REDACTED]');
    expect(data.patch).toBe(governedPatch);
    expect(Buffer.from(data.patch, 'utf8')).toEqual(Buffer.from(governedPatch, 'utf8'));
    const terminalAudit = fixture.record.mock.calls
      .map(([event]) => event)
      .find((event) => event.action === 'OPERATOR_TASK_COMPLETED');
    expect(Object.keys(terminalAudit.metadata).sort()).toEqual(
      [
        'capabilityCode',
        'changedFileCount',
        'correlationId',
        'durationMs',
        'errorReason',
        'errorRetryable',
        'executionId',
        'invocationId',
        'patchBytes',
        'providerCode',
        'requestId',
        'routingDecisionId',
        'status',
        'workflowRunId',
        'workflowStepRunId',
      ].sort(),
    );
    expect(terminalAudit.metadata).not.toHaveProperty('patch');
    expect(terminalAudit.metadata.patchBytes).toBe(Buffer.byteLength(governedPatch, 'utf8'));
    expect(JSON.stringify(terminalAudit.metadata)).not.toContain(secret);
  });

  it('does not invent a second oversized-patch replacement policy', async () => {
    const governedPatch = `diff --git a/a b/a\n+${'x'.repeat(2 * 1024 * 1024)}`;
    const fixture = setup({
      result: {
        ...dispatchResult,
        execution: {
          ...dispatchResult.execution,
          providerExecutionMetadata: {
            ...dispatchResult.execution.providerExecutionMetadata,
            governedResultSettling: {
              executionId: 'execution-1',
              changedFiles: ['a'],
              patch: governedPatch,
            },
          },
        },
      },
    });

    await fixture.service.submitTask('org-1', 'user-1', request);
    expect(fixture.tx.operatorTask.update.mock.calls[0][0].data.patch).toBe(governedPatch);
  });

  it('persists and dispatches the exact generated identities and validated intent', async () => {
    const fixture = setup();
    await fixture.service.submitTask('org-1', 'user-1', request);

    const createData = fixture.tx.operatorTask.create.mock.calls[0][0].data;
    expect(createData).toMatchObject({
      organizationId: 'org-1',
      userId: 'user-1',
      capabilityCode: request.capabilityCode,
      prompt: request.prompt,
      assuranceLevel: request.assuranceLevel,
      maxDurationMs: request.budget.maxDurationMs,
      maxTokens: request.budget.maxTokens,
      maxCostMinorUnits: request.budget.maxCostMinorUnits,
      status: OperatorTaskStatus.DISPATCHING,
    });
    expect(createData.sensitivePayloadExpiresAt.getTime() - createData.createdAt.getTime()).toBe(
      72 * 60 * 60 * 1000,
    );
    expect(fixture.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: fixture.created.workflowRunId,
        workflowStepRunId: fixture.created.workflowStepRunId,
        correlationId: fixture.created.correlationId,
        assuranceLevel: request.assuranceLevel,
        executionBudget: request.budget,
      }),
    );
  });

  it('redacts and bounds changed-file output before persistence', async () => {
    const secret = 'Bearer abcdefghijklmnopqrstuvwxyz123456';
    const fixture = setup({
      result: {
        ...dispatchResult,
        execution: {
          ...dispatchResult.execution,
          providerExecutionMetadata: {
            ...dispatchResult.execution.providerExecutionMetadata,
            governedResultSettling: {
              executionId: 'execution-1',
              changedFiles: [`src/${secret}.ts`, ...Array.from({ length: 5000 }, (_, i) => `${i}.ts`)],
              patch: '',
            },
          },
        },
      },
    });

    await fixture.service.submitTask('org-1', 'user-1', request);
    const changedFiles = fixture.tx.operatorTask.update.mock.calls[0][0].data.changedFiles;
    expect(changedFiles).toHaveLength(4096);
    expect(changedFiles[0]).toContain('[REDACTED]');
    expect(JSON.stringify(changedFiles)).not.toContain(secret);
  });

  it('surfaces Transaction B failure without returning a false terminal result', async () => {
    const fixture = setup({ transactionBError: new Error('database detail must not escape') });
    await expect(fixture.service.submitTask('org-1', 'user-1', request)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
  });

  it('never places sensitive payload bodies in bridge audit metadata', async () => {
    const fixture = setup({
      result: {
        ...dispatchResult,
        execution: {
          ...dispatchResult.execution,
          providerExecutionMetadata: {
            ...dispatchResult.execution.providerExecutionMetadata,
            stdout: 'AUDIT_STDOUT_SENTINEL',
            stderr: 'AUDIT_STDERR_SENTINEL',
          },
        },
      },
    });
    await fixture.service.submitTask('org-1', 'user-1', request);

    const serializedAudit = JSON.stringify(fixture.record.mock.calls);
    expect(serializedAudit).not.toContain(request.prompt);
    expect(serializedAudit).not.toContain('safe patch body');
    expect(serializedAudit).not.toContain('AUDIT_STDOUT_SENTINEL');
    expect(serializedAudit).not.toContain('AUDIT_STDERR_SENTINEL');
    expect(serializedAudit).toContain('patchBytes');
  });

  it('returns explicit purged payload semantics from GET', async () => {
    const fixture = setup();
    const purged = {
      ...task(OperatorTaskStatus.COMPLETED),
      prompt: null,
      patch: null,
      stdout: null,
      stderr: null,
      sensitivePayloadAvailable: false,
      sensitivePayloadDeletedAt: now,
    };
    fixture.prisma.operatorTask.findFirst.mockResolvedValue(purged);

    await expect(fixture.service.getTask('org-1', purged.id)).resolves.toMatchObject({
      prompt: null,
      patch: null,
      stdout: null,
      stderr: null,
      sensitivePayloadAvailable: false,
      sensitivePayloadDeletedAt: now.toISOString(),
    });
    expect(fixture.prisma.operatorTask.findFirst).toHaveBeenCalledWith({
      where: { id: purged.id, organizationId: 'org-1' },
    });
  });

  it('recognizes only the approved tenant/request P2002 target', () => {
    const exact = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['organizationId', 'requestId'] },
    });
    const wrong = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['id'] },
    });
    expect(isOperatorRequestKeyConflict(exact)).toBe(true);
    expect(isOperatorRequestKeyConflict(wrong)).toBe(false);
    expect(isOperatorRequestKeyConflict(new Error('duplicate'))).toBe(false);
  });
});
