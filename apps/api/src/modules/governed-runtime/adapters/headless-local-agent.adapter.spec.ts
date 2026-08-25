import { AgentExecutionStatus, ExecutionAction, ProviderType } from '@vito/contracts';
import type {
  GovernedAdapterRequest,
  GovernedExecutionContext,
  TrustedExecutable,
} from '@vito/contracts';
import { HeadlessLocalAgentAdapter } from './headless-local-agent.adapter';
import {
  WorkerExecutionError,
} from '../../remote-execution-worker/remote-execution-worker.service';
import type {
  RemoteExecutionWorkerService,
  ExecuteSandboxedResult,
} from '../../remote-execution-worker/remote-execution-worker.service';

function makeMockWorkerService(): RemoteExecutionWorkerService {
  return {
    executeSandboxed: jest.fn(),
  } as unknown as RemoteExecutionWorkerService;
}

function makeTrustedExecutable(
  overrides: Partial<TrustedExecutable> = {},
): TrustedExecutable {
  return {
    commandName: 'node',
    resolvedPath: '/usr/bin/node',
    integrityHash: 'sha256:abcdef1234567890',
    verifiedAt: new Date(),
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<GovernedExecutionContext> = {},
): GovernedExecutionContext {
  return {
    invocationId: 'inv-001',
    organizationId: 'org-123',
    workflowRunId: 'run-abc',
    workflowStepRunId: 'step-1',
    correlationId: 'corr-1',
    capabilityCode: 'CODE_BUILD',
    providerId: 'provider-1',
    providerType: ProviderType.LOCAL_TOOL,
    executionProfile: 'BUILDER' as never,
    executionBudget: {},
    policyDecision: {
      allowed: true,
      executionProfile: 'BUILDER',
      requestedAction: ExecutionAction.RUN_COMMAND,
      reasonCode: 'ALLOWED',
      reason: 'test',
      policyVersion: 'v1',
      evaluatedAt: new Date(),
    },
    environment: { allowlist: new Map(), workingDirectory: '/workspace' },
    trustedExecutable: makeTrustedExecutable(),
    startedAt: new Date(),
    timeoutMs: 30_000,
    ...overrides,
  } as GovernedExecutionContext;
}

function makeWorkerResult(overrides = {}): ExecuteSandboxedResult {
  return {
    executionId: 'exec-001',
    exitCode: 0,
    stdout: 'output',
    stderr: '',
    durationMs: 150,
    timedOut: false,
    oomKilled: false,
    baseSha: 'a'.repeat(40),
    repositoryId: 'lavolpeofficial/vito-platform',
    workspaceDisposition: 'CLEANED',
    governedResultSettling: {
      executionId: 'exec-001',
      baseSha: 'a'.repeat(40),
      changedFiles: ['src/foo.ts'],
      patch: 'diff --git a/src/foo.ts...',
      empty: false,
    },
    ...overrides,
  };
}

describe('HeadlessLocalAgentAdapter', () => {
  it('delegates to workerService.executeSandboxed', async () => {
    const workerService = makeMockWorkerService();
    (workerService.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult(),
    );

    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const context = makeContext();
    const request: GovernedAdapterRequest = {
      governedInputPayload: { args: ['--version'] },
    };

    const result = await adapter.execute(request, context);

    expect(workerService.executeSandboxed).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
  });

  it('preserves authorization context', async () => {
    const workerService = makeMockWorkerService();
    (workerService.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult(),
    );

    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const context = makeContext({
      organizationId: 'org-456',
      workflowRunId: 'run-xyz',
      workflowStepRunId: 'step-99',
    });

    await adapter.execute({ governedInputPayload: {} }, context);

    const callArgs = (workerService.executeSandboxed as jest.Mock).mock
      .calls[0][0];
    expect(callArgs.organizationId).toBe('org-456');
    expect(callArgs.workflowRunId).toBe('run-xyz');
    expect(callArgs.workflowStepRunId).toBe('step-99');
  });

  it('executable authority: executable comes from context', async () => {
    const workerService = makeMockWorkerService();
    (workerService.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult(),
    );

    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const trusted = makeTrustedExecutable({
      resolvedPath: '/opt/safe/node',
      commandName: 'node',
      integrityHash: 'sha256:secure-hash',
    });
    const context = makeContext({ trustedExecutable: trusted });

    await adapter.execute({ governedInputPayload: {} }, context);

    const callArgs = (workerService.executeSandboxed as jest.Mock).mock
      .calls[0][0];
    expect(callArgs.executable).toBe(trusted);
  });

  it('rejects missing executable', async () => {
    const workerService = makeMockWorkerService();
    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const context = makeContext({ trustedExecutable: undefined });

    const result = await adapter.execute({ governedInputPayload: {} }, context);

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe(
      'TRUSTED_EXECUTABLE_REQUIRED',
    );
    expect(workerService.executeSandboxed).not.toHaveBeenCalled();
  });

  it('validates args limits', async () => {
    const workerService = makeMockWorkerService();
    (workerService.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult(),
    );

    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const tooManyArgs = Array.from({ length: 65 }, (_, i) => `arg${i}`);
    const result = await adapter.execute(
      { governedInputPayload: { args: tooManyArgs } },
      makeContext(),
    );

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('INVALID_AGENT_ARGS');
    expect(workerService.executeSandboxed).not.toHaveBeenCalled();
  });

  it('validates prompt limits', async () => {
    const workerService = makeMockWorkerService();
    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const hugePrompt = 'x'.repeat(512 * 1024 + 1);
    const result = await adapter.execute(
      { governedInputPayload: { prompt: hugePrompt } },
      makeContext(),
    );

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe(
      'INVALID_AGENT_PROMPT',
    );
    expect(workerService.executeSandboxed).not.toHaveBeenCalled();
  });

  it('rejects unsupported action', async () => {
    const workerService = makeMockWorkerService();
    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const context = makeContext({
      policyDecision: {
        allowed: true,
        executionProfile: 'BUILDER',
        requestedAction: ExecutionAction.READ_FILE,
        reasonCode: 'ALLOWED',
        reason: 'test',
        policyVersion: 'v1',
        evaluatedAt: new Date(),
      } as any,
    });

    const result = await adapter.execute({ governedInputPayload: {} }, context);

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('UNSUPPORTED_ACTION');
    expect(workerService.executeSandboxed).not.toHaveBeenCalled();
  });

  it('result metadata includes workspaceDisposition and governedResultSettling', async () => {
    const workerService = makeMockWorkerService();
    (workerService.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult(),
    );

    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const result = await adapter.execute(
      { governedInputPayload: { args: ['--help'] } },
      makeContext({
        trustedExecutable: makeTrustedExecutable({
          commandName: 'node',
          integrityHash: 'sha256:integrity',
        }),
      }),
    );

    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
    const meta = result.providerExecutionMetadata as Record<string, unknown>;
    expect(meta.workspaceDisposition).toBe('CLEANED');
    expect(meta.governedResultSettling).toEqual(
      expect.objectContaining({
        executionId: 'exec-001',
        changedFiles: ['src/foo.ts'],
        empty: false,
      }),
    );
  });

  it('maps timed out result correctly', async () => {
    const workerService = makeMockWorkerService();
    (workerService.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult({ timedOut: true, exitCode: null }),
    );

    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const result = await adapter.execute(
      { governedInputPayload: {} },
      makeContext(),
    );

    expect(result.status).toBe(AgentExecutionStatus.TIMED_OUT);
    expect((result.error as { code: string }).code).toBe('LOCAL_AGENT_TIMEOUT');
    expect(result.error!.retryable).toBe(true);
  });

  it('maps non-zero exit code as failed', async () => {
    const workerService = makeMockWorkerService();
    (workerService.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult({ exitCode: 1 }),
    );

    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const result = await adapter.execute(
      { governedInputPayload: {} },
      makeContext(),
    );

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe(
      'LOCAL_AGENT_EXIT_NONZERO',
    );
    expect(result.error!.retryable).toBe(false);
  });

  it('catches worker service errors', async () => {
    const workerService = makeMockWorkerService();
    (workerService.executeSandboxed as jest.Mock).mockRejectedValue(
      new Error('sandbox crash'),
    );

    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const result = await adapter.execute(
      { governedInputPayload: {} },
      makeContext(),
    );

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe(
      'LOCAL_AGENT_EXECUTION_ERROR',
    );
    expect((result.error as { message: string }).message).toBe('sandbox crash');
    expect(result.error!.retryable).toBe(true);
  });

  it('does NOT directly spawn', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      __filename.replace(/\.spec\.ts$/, '.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/child_process/);
    expect(source).not.toMatch(/\bspawn\b/);
  });

  it('CHANGESET_CAPTURE_FAILED → FAILED status (non-retryable)', async () => {
    const workerService = makeMockWorkerService();
    (workerService.executeSandboxed as jest.Mock).mockRejectedValue(
      new WorkerExecutionError('CHANGESET_CAPTURE_FAILED', 'git status failed'),
    );

    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const result = await adapter.execute(
      { governedInputPayload: {} },
      makeContext(),
    );

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('CHANGESET_CAPTURE_FAILED');
    expect(result.error!.retryable).toBe(false);
  });

  it('CHANGESET_TOO_LARGE → FAILED status (non-retryable)', async () => {
    const workerService = makeMockWorkerService();
    (workerService.executeSandboxed as jest.Mock).mockRejectedValue(
      new WorkerExecutionError('CHANGESET_TOO_LARGE', 'patch too large'),
    );

    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const result = await adapter.execute(
      { governedInputPayload: {} },
      makeContext(),
    );

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('CHANGESET_TOO_LARGE');
    expect(result.error!.retryable).toBe(false);
  });

  it('non-worker errors → LOCAL_AGENT_EXECUTION_ERROR (retryable)', async () => {
    const workerService = makeMockWorkerService();
    (workerService.executeSandboxed as jest.Mock).mockRejectedValue(
      new Error('unknown internal error'),
    );

    const adapter = new HeadlessLocalAgentAdapter(workerService);
    const result = await adapter.execute(
      { governedInputPayload: {} },
      makeContext(),
    );

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('LOCAL_AGENT_EXECUTION_ERROR');
    expect(result.error!.retryable).toBe(true);
  });
});
