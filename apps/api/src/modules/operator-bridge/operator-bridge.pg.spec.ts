import { ConflictException } from '@nestjs/common';
import { OperatorTaskStatus } from '@prisma/client';
import { AgentExecutionStatus } from '@vito/contracts';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OperatorBridgeService } from './operator-bridge.service';

const DATABASE_URL = process.env.OPERATOR_BRIDGE_TEST_DATABASE_URL;
const describePg = DATABASE_URL ? describe : describe.skip;

describePg('OperatorBridgeService PostgreSQL implementation gate', () => {
  let prisma: PrismaService;
  const organizationIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    if (!DATABASE_URL) return;
    for (const organizationId of organizationIds) {
      await prisma.operatorTask.deleteMany({ where: { organizationId } });
      await prisma.auditEvent.deleteMany({ where: { organizationId } });
      await prisma.user.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await prisma.onModuleDestroy();
  });

  async function createTenant() {
    const organizationId = randomUUID();
    organizationIds.push(organizationId);
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Operator Bridge PG Gate',
        slug: `operator-bridge-pg-${randomUUID()}`,
      },
    });
    const user = await prisma.user.create({
      data: {
        organizationId,
        email: `${randomUUID()}@example.com`,
        firstName: 'Bridge',
        lastName: 'Machine',
        role: 'MEMBER',
        isMachineIdentity: true,
        machineScope: 'vito-bridge',
      },
    });
    return { organizationId, userId: user.id };
  }

  const request = (requestId = randomUUID(), prompt = 'Implement the PG-gated task.') => ({
    requestId,
    capabilityCode: 'CODE_BUILD',
    prompt,
    assuranceLevel: 'AL-3',
    budget: { maxDurationMs: 120_000, maxTokens: 1000, maxCostMinorUnits: 50 },
  });

  function dispatchResult(input: {
    organizationId: string;
    workflowRunId: string;
    workflowStepRunId: string;
    correlationId?: string;
    capabilityCode: string;
  }) {
    const startedAt = new Date();
    return {
      routingDecisionId: randomUUID(),
      selectedProviderId: randomUUID(),
      selectedProviderCode: 'opencode-local',
      correlationId: input.correlationId ?? randomUUID(),
      execution: {
        invocationId: randomUUID(),
        organizationId: input.organizationId,
        workflowRunId: input.workflowRunId,
        workflowStepRunId: input.workflowStepRunId,
        correlationId: input.correlationId ?? randomUUID(),
        capabilityCode: input.capabilityCode,
        providerId: randomUUID(),
        status: AgentExecutionStatus.SUCCEEDED,
        startedAt,
        completedAt: new Date(startedAt.getTime() + 1),
        durationMs: 1,
        providerExecutionMetadata: {
          stdout: 'tests passed',
          stderr: '',
          workspaceDisposition: 'CLEANED',
          governedResultSettling: {
            executionId: randomUUID(),
            changedFiles: ['src/index.ts'],
            patch: 'diff --git a/src/index.ts b/src/index.ts\n+safe change',
          },
        },
        policyDecisionReference: 'policy-pg',
      },
    };
  }

  function service(dispatch: jest.Mock, ttlHours = 72, client: PrismaService = prisma) {
    return new OperatorBridgeService(
      client,
      { dispatch } as any,
      new AuditService(prisma),
      { exposure: 'internal', sensitivePayloadTtlHours: ttlHours },
    );
  }

  function synchronizedClaimClient() {
    let absentTransactionReads = 0;
    let outsideTransactionReads = 0;
    let releaseAbsentReads!: () => void;
    const bothTransactionsReadAbsent = new Promise<void>((resolve) => {
      releaseAbsentReads = resolve;
    });

    const client = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === '$transaction') {
          return (callback: (tx: unknown) => Promise<unknown>) =>
            target.$transaction(async (tx) => {
              const transactionClient = new Proxy(tx, {
                get(transactionTarget, transactionProperty, transactionReceiver) {
                  if (transactionProperty !== 'operatorTask') {
                    return Reflect.get(
                      transactionTarget,
                      transactionProperty,
                      transactionReceiver,
                    );
                  }
                  return new Proxy(transactionTarget.operatorTask, {
                    get(modelTarget, modelProperty, modelReceiver) {
                      if (modelProperty !== 'findUnique') {
                        return Reflect.get(modelTarget, modelProperty, modelReceiver);
                      }
                      return async (args: Parameters<typeof modelTarget.findUnique>[0]) => {
                        const found = await modelTarget.findUnique(args);
                        if (found === null && 'organizationId_requestId' in args.where) {
                          absentTransactionReads += 1;
                          if (absentTransactionReads === 2) releaseAbsentReads();
                          await bothTransactionsReadAbsent;
                        }
                        return found;
                      };
                    },
                  });
                },
              });
              return callback(transactionClient);
            });
        }
        if (property === 'operatorTask') {
          return new Proxy(target.operatorTask, {
            get(modelTarget, modelProperty, modelReceiver) {
              if (modelProperty !== 'findUnique') {
                return Reflect.get(modelTarget, modelProperty, modelReceiver);
              }
              return (args: Parameters<typeof modelTarget.findUnique>[0]) => {
                outsideTransactionReads += 1;
                return modelTarget.findUnique(args);
              };
            },
          });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    return {
      client,
      absentTransactionReads: () => absentTransactionReads,
      outsideTransactionReads: () => outsideTransactionReads,
    };
  }

  function terminalLockProbeClient(holdAfterLock: boolean) {
    let transactionCount = 0;
    let markTerminalLock!: () => void;
    let releaseTerminalLock!: () => void;
    const terminalLock = new Promise<void>((resolve) => {
      markTerminalLock = resolve;
    });
    const terminalLockRelease = new Promise<void>((resolve) => {
      releaseTerminalLock = resolve;
    });

    const client = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property !== '$transaction') {
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (callback: (tx: unknown) => Promise<unknown>) => {
          transactionCount += 1;
          const currentTransaction = transactionCount;
          return target.$transaction(async (tx) => {
            if (currentTransaction !== 2) return callback(tx);
            const transactionClient = new Proxy(tx, {
              get(transactionTarget, transactionProperty, transactionReceiver) {
                if (transactionProperty !== '$queryRaw') {
                  return Reflect.get(
                    transactionTarget,
                    transactionProperty,
                    transactionReceiver,
                  );
                }
                return async (...args: unknown[]) => {
                  if (!holdAfterLock) {
                    markTerminalLock();
                    return (transactionTarget.$queryRaw as any)(...args);
                  }
                  const result = await (transactionTarget.$queryRaw as any)(...args);
                  markTerminalLock();
                  await terminalLockRelease;
                  return result;
                };
              },
            });
            return callback(transactionClient);
          });
        };
      },
    });

    return { client, terminalLock, releaseTerminalLock };
  }

  const purgeExpiredPayloads = () => prisma.$executeRaw`
    UPDATE "operator_tasks"
    SET
      "prompt" = NULL,
      "patch" = NULL,
      "stdout" = NULL,
      "stderr" = NULL,
      "sensitivePayloadAvailable" = FALSE,
      "sensitivePayloadDeletedAt" = CURRENT_TIMESTAMP
    WHERE "sensitivePayloadAvailable" = TRUE
      AND "sensitivePayloadExpiresAt" <= CURRENT_TIMESTAMP
  `;

  async function waitForBlockedOperatorTaskTransaction(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS "count"
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND "wait_event_type" = 'Lock'
          AND query LIKE '%operator_tasks%'
      `;
      if ((rows[0]?.count ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected an overlapping operator_tasks PostgreSQL lock wait.');
  }

  it('enforces stable machine classification at the database boundary', async () => {
    const tenant = await createTenant();
    const base = {
      organizationId: tenant.organizationId,
      email: `${randomUUID()}@example.com`,
      firstName: 'Human',
      lastName: 'User',
      role: 'MEMBER' as const,
    };

    await expect(
      prisma.user.create({
        data: { ...base, isMachineIdentity: false, machineScope: 'vito-bridge' },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.user.create({
        data: { ...base, email: `${randomUUID()}@example.com`, isMachineIdentity: false, machineScope: '' },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.user.create({
        data: { ...base, email: `${randomUUID()}@example.com`, isMachineIdentity: true, machineScope: null },
      }),
    ).resolves.toMatchObject({ isMachineIdentity: true, machineScope: null });
  });

  it('round-trips the authoritative patch exactly, audits metadata only, and purges it', async () => {
    const tenant = await createTenant();
    const dto = request();
    const secret = 'Bearer abcdefghijklmnopqrstuvwxyz123456';
    const governedPatch = `diff --git a/a b/a\r\n+const fixture = '${secret}';\r\n`;
    const dispatch = jest.fn(async (input) => {
      const result = dispatchResult(input);
      return {
        ...result,
        execution: {
          ...result.execution,
          providerExecutionMetadata: {
            ...result.execution.providerExecutionMetadata,
            governedResultSettling: {
              ...result.execution.providerExecutionMetadata.governedResultSettling,
              patch: governedPatch,
            },
          },
        },
      };
    });
    const bridge = service(dispatch);

    const response = await bridge.submitTask(tenant.organizationId, tenant.userId, dto);
    const persisted = await prisma.operatorTask.findUniqueOrThrow({
      where: { id: response.taskId },
    });
    expect(persisted.patch).toBe(governedPatch);
    expect(Buffer.from(persisted.patch!, 'utf8')).toEqual(Buffer.from(governedPatch, 'utf8'));
    await expect(bridge.getTask(tenant.organizationId, response.taskId)).resolves.toMatchObject({
      patch: governedPatch,
      sensitivePayloadAvailable: true,
    });

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        organizationId: tenant.organizationId,
        entityId: response.taskId,
        action: 'OPERATOR_TASK_COMPLETED',
      },
    });
    const metadata = audit.metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual(
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
    expect(metadata).not.toHaveProperty('patch');
    expect(metadata.patchBytes).toBe(Buffer.byteLength(governedPatch, 'utf8'));
    expect(JSON.stringify(metadata)).not.toContain(secret);

    await prisma.operatorTask.update({
      where: { id: response.taskId },
      data: { sensitivePayloadExpiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await purgeExpiredPayloads()).toBe(1);
    expect(await prisma.operatorTask.findUniqueOrThrow({ where: { id: response.taskId } })).toMatchObject({
      patch: null,
      sensitivePayloadAvailable: false,
    });
  });

  it('gives one concurrent duplicate the unique dispatch claim and never dispatches the loser', async () => {
    const tenant = await createTenant();
    const dto = request();
    const dispatch = jest.fn(async (input) => dispatchResult(input));
    const synchronized = synchronizedClaimClient();
    const bridge = service(dispatch, 72, synchronized.client);

    const [first, second] = await Promise.all([
      bridge.submitTask(tenant.organizationId, tenant.userId, dto),
      bridge.submitTask(tenant.organizationId, tenant.userId, dto),
    ]);

    expect(first.taskId).toBe(second.taskId);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(synchronized.absentTransactionReads()).toBe(2);
    expect(synchronized.outsideTransactionReads()).toBe(1);
    expect(
      await prisma.operatorTask.count({
        where: { organizationId: tenant.organizationId, requestId: dto.requestId },
      }),
    ).toBe(1);
  });

  it('fails the different-fingerprint race closed while dispatching only the winner', async () => {
    const tenant = await createTenant();
    const requestId = randomUUID();
    const dispatch = jest.fn(async (input) => dispatchResult(input));
    const synchronized = synchronizedClaimClient();
    const bridge = service(dispatch, 72, synchronized.client);

    const results = await Promise.allSettled([
      bridge.submitTask(tenant.organizationId, tenant.userId, request(requestId, 'payload A')),
      bridge.submitTask(tenant.organizationId, tenant.userId, request(requestId, 'payload B')),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(ConflictException);
    expect(rejection.reason.message).toBe('OPERATOR_IDEMPOTENCY_CONFLICT');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(synchronized.absentTransactionReads()).toBe(2);
    expect(synchronized.outsideTransactionReads()).toBe(1);
    expect(
      await prisma.operatorTask.count({
        where: { organizationId: tenant.organizationId, requestId },
      }),
    ).toBe(1);
  });

  it('treats the same requestId in different tenants as independent work', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const dto = request();
    const dispatch = jest.fn(async (input) => dispatchResult(input));
    const bridge = service(dispatch);

    const [resultA, resultB] = await Promise.all([
      bridge.submitTask(tenantA.organizationId, tenantA.userId, dto),
      bridge.submitTask(tenantB.organizationId, tenantB.userId, dto),
    ]);

    expect(resultA.taskId).not.toBe(resultB.taskId);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(await prisma.operatorTask.count({ where: { requestId: dto.requestId } })).toBe(2);
  });

  it('never reclaims or redispatches an existing stale DISPATCHING task', async () => {
    const tenant = await createTenant();
    const dto = request();
    const { computeRequestFingerprint } = await import('./idempotency');
    const stale = await prisma.operatorTask.create({
      data: {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        requestId: dto.requestId,
        requestFingerprint: computeRequestFingerprint(dto),
        correlationId: randomUUID(),
        workflowRunId: randomUUID(),
        workflowStepRunId: randomUUID(),
        capabilityCode: dto.capabilityCode,
        prompt: dto.prompt,
        assuranceLevel: dto.assuranceLevel,
        status: OperatorTaskStatus.DISPATCHING,
        sensitivePayloadExpiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(Date.now() - 86_400_000),
      },
    });
    const dispatch = jest.fn();

    await expect(
      service(dispatch).submitTask(tenant.organizationId, tenant.userId, dto),
    ).resolves.toMatchObject({ taskId: stale.id, status: OperatorTaskStatus.DISPATCHING });
    expect(dispatch).not.toHaveBeenCalled();
    expect(await prisma.operatorTask.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({
      status: OperatorTaskStatus.DISPATCHING,
      updatedAt: stale.updatedAt,
    });
  });

  it('atomically clears payload when expiry passes before Transaction B', async () => {
    const tenant = await createTenant();
    const dto = request();
    let markDispatchStarted!: () => void;
    let releaseDispatch!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => {
      markDispatchStarted = resolve;
    });
    const dispatchRelease = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    const dispatch = jest.fn(async (input) => {
      markDispatchStarted();
      await dispatchRelease;
      return dispatchResult(input);
    });

    const submission = service(dispatch).submitTask(
      tenant.organizationId,
      tenant.userId,
      dto,
    );
    await dispatchStarted;
    await prisma.operatorTask.update({
      where: {
        organizationId_requestId: {
          organizationId: tenant.organizationId,
          requestId: dto.requestId,
        },
      },
      data: { sensitivePayloadExpiresAt: new Date(Date.now() - 60_000) },
    });
    releaseDispatch();
    const result = await submission;
    const persisted = await prisma.operatorTask.findUniqueOrThrow({ where: { id: result.taskId } });
    expect(persisted).toMatchObject({
      status: OperatorTaskStatus.COMPLETED,
      prompt: null,
      patch: null,
      stdout: null,
      stderr: null,
      sensitivePayloadAvailable: false,
    });
    expect(persisted.sensitivePayloadDeletedAt).not.toBeNull();
    expect(persisted.requestFingerprint).not.toHaveLength(0);
  });

  it('retains unexpired payload and purges only expired payload without deleting durable metadata', async () => {
    const tenant = await createTenant();
    const unexpiredRequest = request();
    const dispatch = jest.fn(async (input) => dispatchResult(input));
    const unexpiredResult = await service(dispatch).submitTask(
      tenant.organizationId,
      tenant.userId,
      unexpiredRequest,
    );
    const unexpiredBeforePurge = await prisma.operatorTask.findUniqueOrThrow({
      where: { id: unexpiredResult.taskId },
    });
    expect(unexpiredBeforePurge).toMatchObject({
      prompt: unexpiredRequest.prompt,
      patch: 'diff --git a/src/index.ts b/src/index.ts\n+safe change',
      stdout: 'tests passed',
      stderr: '',
      sensitivePayloadAvailable: true,
      sensitivePayloadDeletedAt: null,
    });

    const expiredRequest = request();
    const expired = await prisma.operatorTask.create({
      data: {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        requestId: expiredRequest.requestId,
        requestFingerprint: (await import('./idempotency')).computeRequestFingerprint(expiredRequest),
        correlationId: randomUUID(),
        workflowRunId: randomUUID(),
        workflowStepRunId: randomUUID(),
        capabilityCode: expiredRequest.capabilityCode,
        prompt: expiredRequest.prompt,
        status: OperatorTaskStatus.COMPLETED,
        invocationId: randomUUID(),
        executionId: randomUUID(),
        routingDecisionId: randomUUID(),
        stdout: 'expired stdout',
        stderr: 'expired stderr',
        patch: 'expired patch',
        startedAt: new Date(Date.now() - 120_000),
        completedAt: new Date(Date.now() - 90_000),
        durationMs: 30_000,
        sensitivePayloadExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    const expiredNullOutputsRequest = request();
    const expiredNullOutputs = await prisma.operatorTask.create({
      data: {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        requestId: expiredNullOutputsRequest.requestId,
        requestFingerprint: (await import('./idempotency')).computeRequestFingerprint(
          expiredNullOutputsRequest,
        ),
        correlationId: randomUUID(),
        workflowRunId: randomUUID(),
        workflowStepRunId: randomUUID(),
        capabilityCode: expiredNullOutputsRequest.capabilityCode,
        prompt: expiredNullOutputsRequest.prompt,
        status: OperatorTaskStatus.FAILED,
        patch: null,
        stdout: null,
        stderr: null,
        sensitivePayloadExpiresAt: new Date(Date.now() - 60_000),
      },
    });

    await expect(
      service(dispatch).getTask(tenant.organizationId, expiredNullOutputs.id),
    ).resolves.toMatchObject({
      prompt: expiredNullOutputsRequest.prompt,
      patch: null,
      stdout: null,
      stderr: null,
      sensitivePayloadAvailable: true,
      sensitivePayloadDeletedAt: null,
    });

    expect(await purgeExpiredPayloads()).toBe(2);
    expect(await purgeExpiredPayloads()).toBe(0);
    const unexpiredAfterPurge = await prisma.operatorTask.findUniqueOrThrow({
      where: { id: unexpiredResult.taskId },
    });
    expect(unexpiredAfterPurge).toMatchObject({
      prompt: unexpiredRequest.prompt,
      patch: 'diff --git a/src/index.ts b/src/index.ts\n+safe change',
      stdout: 'tests passed',
      stderr: '',
      sensitivePayloadAvailable: true,
      sensitivePayloadDeletedAt: null,
    });
    const expiredAfterPurge = await prisma.operatorTask.findUniqueOrThrow({
      where: { id: expired.id },
    });
    expect(expiredAfterPurge).toMatchObject({
      requestId: expired.requestId,
      requestFingerprint: expired.requestFingerprint,
      correlationId: expired.correlationId,
      workflowRunId: expired.workflowRunId,
      workflowStepRunId: expired.workflowStepRunId,
      capabilityCode: expired.capabilityCode,
      invocationId: expired.invocationId,
      executionId: expired.executionId,
      routingDecisionId: expired.routingDecisionId,
      startedAt: expired.startedAt,
      completedAt: expired.completedAt,
      durationMs: expired.durationMs,
      prompt: null,
      patch: null,
      stdout: null,
      stderr: null,
      sensitivePayloadAvailable: false,
      sensitivePayloadExpiresAt: expired.sensitivePayloadExpiresAt,
    });
    expect(expiredAfterPurge.sensitivePayloadDeletedAt).not.toBeNull();
    expect(
      await prisma.operatorTask.findUniqueOrThrow({ where: { id: expiredNullOutputs.id } }),
    ).toMatchObject({
      prompt: null,
      patch: null,
      stdout: null,
      stderr: null,
      sensitivePayloadAvailable: false,
    });
    await expect(service(dispatch).getTask(tenant.organizationId, expired.id)).resolves.toMatchObject({
      prompt: null,
      patch: null,
      stdout: null,
      stderr: null,
      sensitivePayloadAvailable: false,
      sensitivePayloadExpiresAt: expired.sensitivePayloadExpiresAt.toISOString(),
    });
  });

  it('keeps cleanup blocked when Transaction B owns the row lock', async () => {
    const tenant = await createTenant();
    const dto = request();
    let markDispatchStarted!: () => void;
    let releaseDispatch!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => {
      markDispatchStarted = resolve;
    });
    const dispatchRelease = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    const dispatch = jest.fn(async (input) => {
      markDispatchStarted();
      await dispatchRelease;
      return dispatchResult(input);
    });
    const lockProbe = terminalLockProbeClient(true);
    const submission = service(dispatch, 72, lockProbe.client).submitTask(
      tenant.organizationId,
      tenant.userId,
      dto,
    );
    await dispatchStarted;
    const claimed = await prisma.operatorTask.findUniqueOrThrow({
      where: {
        organizationId_requestId: {
          organizationId: tenant.organizationId,
          requestId: dto.requestId,
        },
      },
    });
    await prisma.operatorTask.update({
      where: { id: claimed.id },
      data: { sensitivePayloadExpiresAt: new Date(Date.now() - 60_000) },
    });
    releaseDispatch();
    await lockProbe.terminalLock;

    let markCleanupStarted!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => {
      markCleanupStarted = resolve;
    });
    const cleanup = prisma.$transaction(async (tx) => {
      markCleanupStarted();
      return tx.$executeRaw`
        UPDATE "operator_tasks"
        SET
          "prompt" = NULL,
          "patch" = NULL,
          "stdout" = NULL,
          "stderr" = NULL,
          "sensitivePayloadAvailable" = FALSE,
          "sensitivePayloadDeletedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${claimed.id}
          AND "sensitivePayloadAvailable" = TRUE
          AND "sensitivePayloadExpiresAt" <= CURRENT_TIMESTAMP
      `;
    });
    await cleanupStarted;
    await waitForBlockedOperatorTaskTransaction();
    lockProbe.releaseTerminalLock();

    await submission;
    expect(await cleanup).toBe(0);
    expect(await prisma.operatorTask.findUniqueOrThrow({ where: { id: claimed.id } })).toMatchObject({
      status: OperatorTaskStatus.COMPLETED,
      prompt: null,
      patch: null,
      stdout: null,
      stderr: null,
      sensitivePayloadAvailable: false,
    });
  });

  it('never repopulates payload when cleanup holds the row lock before Transaction B', async () => {
    const tenant = await createTenant();
    const dto = request();
    let releaseDispatch!: () => void;
    let markDispatchStarted!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => {
      markDispatchStarted = resolve;
    });
    const dispatchReleased = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    const dispatch = jest.fn(async (input) => {
      markDispatchStarted();
      await dispatchReleased;
      return dispatchResult(input);
    });
    const lockProbe = terminalLockProbeClient(false);
    const bridge = service(dispatch, 72, lockProbe.client);
    const submission = bridge.submitTask(tenant.organizationId, tenant.userId, dto);
    await dispatchStarted;
    const claimed = await prisma.operatorTask.findUniqueOrThrow({
      where: {
        organizationId_requestId: {
          organizationId: tenant.organizationId,
          requestId: dto.requestId,
        },
      },
    });
    const expiredClaim = await prisma.operatorTask.update({
      where: { id: claimed.id },
      data: { sensitivePayloadExpiresAt: new Date(Date.now() - 60_000) },
    });
    let markCleanupLocked!: () => void;
    let releaseCleanup!: () => void;
    const cleanupLocked = new Promise<void>((resolve) => {
      markCleanupLocked = resolve;
    });
    const cleanupRelease = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const cleanupDeletedAt = new Date('2026-08-26T12:00:00.000Z');
    const cleanup = prisma.$transaction(async (tx) => {
      const count = await tx.$executeRaw`
        UPDATE "operator_tasks"
        SET
          "prompt" = NULL,
          "patch" = NULL,
          "stdout" = NULL,
          "stderr" = NULL,
          "sensitivePayloadAvailable" = FALSE,
          "sensitivePayloadDeletedAt" = ${cleanupDeletedAt}
        WHERE "id" = ${claimed.id}
          AND "sensitivePayloadAvailable" = TRUE
          AND "sensitivePayloadExpiresAt" <= CURRENT_TIMESTAMP
      `;
      markCleanupLocked();
      await cleanupRelease;
      return count;
    });
    await cleanupLocked;
    releaseDispatch();
    await lockProbe.terminalLock;
    await waitForBlockedOperatorTaskTransaction();
    releaseCleanup();
    expect(await cleanup).toBe(1);
    await submission;

    const persisted = await prisma.operatorTask.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(persisted).toMatchObject({
      status: OperatorTaskStatus.COMPLETED,
      prompt: null,
      patch: null,
      stdout: null,
      stderr: null,
      sensitivePayloadAvailable: false,
      sensitivePayloadExpiresAt: expiredClaim.sensitivePayloadExpiresAt,
      sensitivePayloadDeletedAt: cleanupDeletedAt,
    });
    expect(persisted.requestId).toBe(dto.requestId);
    expect(persisted.capabilityCode).toBe(dto.capabilityCode);
  });
});
