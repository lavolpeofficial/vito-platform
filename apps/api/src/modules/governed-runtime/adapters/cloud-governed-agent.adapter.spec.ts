import { AgentExecutionStatus, ExecutionAction, ProviderType } from '@vito/contracts';
import type { CloudExecutionProfile, GovernedAdapterRequest, GovernedExecutionContext, TrustedExecutable } from '@vito/contracts';
import { CloudGovernedAgentAdapter } from './cloud-governed-agent.adapter';
import { CloudExecutionProfileRegistry } from '../../cloud-governed-execution/cloud-execution-profile.registry';
import { CloudSandboxError } from '../../cloud-governed-execution/cloud-governed-sandbox-executor';
import {
  WorkerExecutionError,
} from '../../remote-execution-worker/remote-execution-worker.service';
import type {
  RemoteExecutionWorkerService,
  ExecuteSandboxedResult,
} from '../../remote-execution-worker/remote-execution-worker.service';

const PROVIDER_CODE = 'cloud.openai.main';
const CREDENTIAL_REF = 'cloud:test-main';

function makeProfile(overrides: Partial<CloudExecutionProfile> = {}): CloudExecutionProfile {
  return {
    profileId: 'profile-001',
    providerCode: PROVIDER_CODE,
    credentialRef: CREDENTIAL_REF,
    trustedLauncherAlias: 'worker-agent',
    expectedProviderId: 'openai',
    maxDurationMs: 60_000,
    maxParallelism: 1,
    enabled: true,
    ...overrides,
  };
}

function makeRegistry(profiles: CloudExecutionProfile[]) {
  return new CloudExecutionProfileRegistry(profiles);
}

function makeMockWorkerService(): RemoteExecutionWorkerService {
  return {
    executeSandboxed: jest.fn(),
  } as unknown as RemoteExecutionWorkerService;
}

function makeTrustedExecutable(overrides: Partial<TrustedExecutable> = {}): TrustedExecutable {
  return {
    commandName: 'worker-agent',
    resolvedPath: '/usr/local/lib/vito-agent-launchers/worker-agent',
    integrityHash: 'sha256:abcdef1234567890',
    verifiedAt: new Date(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<GovernedExecutionContext> = {}): GovernedExecutionContext {
  return {
    invocationId: 'inv-001',
    organizationId: 'org-123',
    workflowRunId: 'run-abc',
    workflowStepRunId: 'step-1',
    correlationId: 'corr-1',
    capabilityCode: 'INTENT_EXEC',
    providerId: 'provider-1',
    providerType: ProviderType.CLOUD_LLM,
    providerCode: PROVIDER_CODE,
    executionProfile: 'CLOUD_OPERATOR' as never,
    executionBudget: {},
    policyDecision: {
      allowed: true,
      executionProfile: 'CLOUD_OPERATOR',
      requestedAction: ExecutionAction.RUN_COMMAND,
      reasonCode: 'ALLOWED',
      reason: 'test',
      policyVersion: 'v1',
      evaluatedAt: new Date(),
    },
    environment: { allowlist: new Map(), workingDirectory: '/workspace' },
    trustedExecutable: makeTrustedExecutable(),
    credentialReference: CREDENTIAL_REF,
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

function makeAdapter(
  workerService: RemoteExecutionWorkerService = makeMockWorkerService(),
  registry: CloudExecutionProfileRegistry = makeRegistry([makeProfile()]),
) {
  return new CloudGovernedAgentAdapter(workerService, registry);
}

describe('CloudGovernedAgentAdapter (CLOUD_GOVERNED tier, §9 gates)', () => {
  it('providerType is CLOUD_LLM and the cloud boundary is used', async () => {
    const adapter = makeAdapter();
    expect(adapter.providerType).toBe(ProviderType.CLOUD_LLM);
  });

  it('rejects any action other than RUN_COMMAND before executing', async () => {
    const worker = makeMockWorkerService();
    const adapter = makeAdapter(worker);
    const result = await adapter.execute(
      { governedInputPayload: {} },
      makeContext({
        policyDecision: {
          allowed: true,
          executionProfile: 'CLOUD_OPERATOR',
          requestedAction: ExecutionAction.READ_FILE,
          reasonCode: 'ALLOWED',
          reason: 'test',
          policyVersion: 'v1',
          evaluatedAt: new Date(),
        } as never,
      }),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('UNSUPPORTED_ACTION');
    expect(worker.executeSandboxed).not.toHaveBeenCalled();
  });

  it('fails closed when no trusted executable is attached', async () => {
    const worker = makeMockWorkerService();
    const result = await makeAdapter(worker).execute(
      { governedInputPayload: {} },
      makeContext({ trustedExecutable: undefined }),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('TRUSTED_EXECUTABLE_REQUIRED');
    expect(worker.executeSandboxed).not.toHaveBeenCalled();
  });

  it('CRITICAL: fails closed when no enabled profile is bound to the provider code', async () => {
    const worker = makeMockWorkerService();
    const context = makeContext({ providerCode: 'cloud.unbound' });
    const result = await makeAdapter(worker, makeRegistry([])).execute(
      { governedInputPayload: {} },
      context,
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('CLOUD_EXECUTION_PROFILE_UNAVAILABLE');
    expect(worker.executeSandboxed).not.toHaveBeenCalled();
  });

  it('CRITICAL: fails closed on a disabled profile (never executes)', async () => {
    const worker = makeMockWorkerService();
    const registry = makeRegistry([makeProfile({ enabled: false })]);
    const result = await makeAdapter(worker, registry).execute(
      { governedInputPayload: {} },
      makeContext(),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('CLOUD_EXECUTION_PROFILE_UNAVAILABLE');
    expect(worker.executeSandboxed).not.toHaveBeenCalled();
  });

  it('CRITICAL: fails closed when the trusted executable alias mismatches the profile launcher', async () => {
    const worker = makeMockWorkerService();
    const result = await makeAdapter(worker).execute(
      { governedInputPayload: {} },
      makeContext({ trustedExecutable: makeTrustedExecutable({ commandName: 'something-else' }) }),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('EXECUTABLE_PROFILE_MISMATCH');
    expect(worker.executeSandboxed).not.toHaveBeenCalled();
  });

  it('CRITICAL: fails closed when no credential reference is present', async () => {
    const worker = makeMockWorkerService();
    const result = await makeAdapter(worker).execute(
      { governedInputPayload: {} },
      makeContext({ credentialReference: undefined }),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('CLOUD_CREDENTIAL_UNAVAILABLE');
    expect(worker.executeSandboxed).not.toHaveBeenCalled();
  });

  it('rejects malformed / oversized agent payload before executing', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ args: Array.from({ length: 65 }, (_, i) => `a${i}`) }, 'INVALID_AGENT_ARGS'],
      [{ args: ['x'.repeat(4097)] }, 'INVALID_AGENT_ARG'],
      [{ args: ['has\0null'] }, 'INVALID_AGENT_ARG'],
      [{ args: [42] }, 'INVALID_AGENT_ARG'],
      [{ prompt: 'x'.repeat(512 * 1024 + 1) }, 'INVALID_AGENT_PROMPT'],
    ];
    for (const [payload, code] of cases) {
      const worker = makeMockWorkerService();
      const result = await makeAdapter(worker).execute(
        { governedInputPayload: payload },
        makeContext(),
      );
      expect(result.status).toBe(AgentExecutionStatus.FAILED);
      expect((result.error as { code: string }).code).toBe(code);
      expect(worker.executeSandboxed).not.toHaveBeenCalled();
    }
  });

  it('CRITICAL: executes through the cloud worker with the hardcoded governed repo and credential ref', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockResolvedValue(makeWorkerResult());
    const context = makeContext();
    await makeAdapter(worker).execute({ governedInputPayload: { args: ['--run'] } }, context);

    const callArgs = (worker.executeSandboxed as jest.Mock).mock.calls[0][0];
    expect(callArgs.repositoryId).toBe('lavolpeofficial/vito-platform');
    expect(callArgs.baseRef).toBe('main');
    expect(callArgs.credentialReference).toBe(CREDENTIAL_REF);
    expect(callArgs.executable).toBe(context.trustedExecutable);
    expect(callArgs.sandboxConfig.technology).toBe('none');
  });

  it('CRITICAL: never returns or logs the credential reference or its value', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockResolvedValue(makeWorkerResult());
    const result = await makeAdapter(worker).execute(
      { governedInputPayload: { args: [] } },
      makeContext(),
    );

    expect(worker.executeSandboxed).toHaveBeenCalledTimes(1);
    const callArgs = (worker.executeSandboxed as jest.Mock).mock.calls[0][0];
    expect(callArgs.credentialReference).toBe(CREDENTIAL_REF);

    const metadataJson = JSON.stringify(result.providerExecutionMetadata);
    expect(metadataJson).not.toContain(CREDENTIAL_REF);
  });

  it('caps the execution timeout to the profile maximum', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockResolvedValue(makeWorkerResult());
    const registry = makeRegistry([makeProfile({ maxDurationMs: 5_000 })]);
    const result = await makeAdapter(worker, registry).execute(
      { governedInputPayload: {} },
      makeContext({ timeoutMs: 120_000 }),
    );
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
    const callArgs = (worker.executeSandboxed as jest.Mock).mock.calls[0][0];
    expect(callArgs.sandboxConfig.timeoutMs).toBe(5_000);
  });

  it('maps success with credentialDisposition removed and acceptance evidence', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult({ exitCode: 0, stdout: 'done' }),
    );
    const adapter = makeAdapter(worker);
    const result = await adapter.execute(
      { governedInputPayload: { args: ['--help'] } },
      makeContext({ trustedExecutable: makeTrustedExecutable({ integrityHash: 'sha256:i' }) }),
    );
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
    expect(result.outputReference).toBe('gov://execution/inv-001');

    const meta = result.providerExecutionMetadata as Record<string, unknown>;
    expect(meta.credentialDisposition).toBe('removed');
    expect(meta.workspaceDisposition).toBe('CLEANED');
    expect(meta.exitCode).toBe(0);
    expect(meta.stdout).toBe('done');
    expect(meta.executableIntegrityHash).toBe('sha256:i');
    expect(meta.flight001Acceptance).toMatchObject({ checked: true, passed: false });
  });

  it('maps timeout to CLOUD_AGENT_TIMEOUT (retryable)', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult({ timedOut: true, exitCode: null }),
    );
    const result = await makeAdapter(worker).execute(
      { governedInputPayload: {} },
      makeContext(),
    );
    expect(result.status).toBe(AgentExecutionStatus.TIMED_OUT);
    expect((result.error as { code: string }).code).toBe('CLOUD_AGENT_TIMEOUT');
    expect(result.error!.retryable).toBe(true);
  });

  it('maps non-zero exit to CLOUD_AGENT_EXIT_NONZERO (non-retryable)', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult({ exitCode: 9 }),
    );
    const result = await makeAdapter(worker).execute(
      { governedInputPayload: {} },
      makeContext(),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('CLOUD_AGENT_EXIT_NONZERO');
    expect(result.error!.retryable).toBe(false);
  });

  it('maps WorkerExecutionError changeset failures as non-retryable', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockRejectedValue(
      new WorkerExecutionError('CHANGESET_CAPTURE_FAILED', 'git status failed'),
    );
    const result = await makeAdapter(worker).execute(
      { governedInputPayload: {} },
      makeContext(),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('CHANGESET_CAPTURE_FAILED');
    expect(result.error!.retryable).toBe(false);
  });

  it('maps CloudSandboxError with its typed code (fail closed, non-retryable)', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockRejectedValue(
      new CloudSandboxError('CREDENTIAL_RESOLUTION_FAILED', 'nope'),
    );
    const result = await makeAdapter(worker).execute(
      { governedInputPayload: {} },
      makeContext(),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('CREDENTIAL_RESOLUTION_FAILED');
    expect(result.error!.retryable).toBe(false);
  });

  it('maps unexpected errors to CLOUD_AGENT_EXECUTION_ERROR (retryable)', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockRejectedValue(new Error('boom'));
    const result = await makeAdapter(worker).execute(
      { governedInputPayload: {} },
      makeContext(),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('CLOUD_AGENT_EXECUTION_ERROR');
    expect(result.error!.retryable).toBe(true);
  });

  it('forwards the server-owned expected provider identity from the profile', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockResolvedValue(makeWorkerResult());
    const adapter = makeAdapter(worker, makeRegistry([makeProfile()]));
    await adapter.execute({ governedInputPayload: { args: ['--run'] } }, makeContext());

    const callArgs = (worker.executeSandboxed as jest.Mock).mock.calls[0][0];
    expect(callArgs.expectedProviderIdentity).toEqual({ providerId: 'openai' });
  });

  it('forwards the optional model allow-list when the profile declares it', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockResolvedValue(makeWorkerResult());
    const profile = makeProfile({ allowedModelIds: ['gpt-5.6-terra-fast', 'gpt-5.6-terra-fast-mini'] });
    const adapter = makeAdapter(worker, makeRegistry([profile]));
    await adapter.execute({ governedInputPayload: {} }, makeContext());

    const callArgs = (worker.executeSandboxed as jest.Mock).mock.calls[0][0];
    expect(callArgs.expectedProviderIdentity).toEqual({
      providerId: 'openai',
      allowedModelIds: ['gpt-5.6-terra-fast', 'gpt-5.6-terra-fast-mini'],
    });
  });

  it('CRITICAL: caller/operator payload cannot override the expected provider identity', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockResolvedValue(makeWorkerResult());
    const adapter = makeAdapter(worker);
    await adapter.execute(
      {
        governedInputPayload: {
          args: ['--run'],
          expectedProviderIdentity: { providerId: 'opencode' },
        } as never,
      },
      makeContext(),
    );

    const callArgs = (worker.executeSandboxed as jest.Mock).mock.calls[0][0];
    expect(callArgs.expectedProviderIdentity).toEqual({ providerId: 'openai' });
  });

  it('CRITICAL: provider identity mismatch fails closed to FAILED with sanitized evidence', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult({
        exitCode: 0,
        observedProviderIdentity: { providerId: 'opencode', modelId: 'big-pickle' },
        providerIdentityError: {
          code: 'PROVIDER_IDENTITY_MISMATCH',
          message: "observed provider 'opencode' does not match the server-authorized provider 'openai'",
        },
      }),
    );
    const result = await makeAdapter(worker).execute(
      { governedInputPayload: { args: ['--run'] } },
      makeContext(),
    );

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect(result.error!.code).toBe('PROVIDER_IDENTITY_MISMATCH');
    expect(result.error!.retryable).toBe(false);
    expect(result.error!.message).toBe(
      "observed provider 'opencode' does not match the server-authorized provider 'openai'",
    );

    const meta = result.providerExecutionMetadata as Record<string, unknown>;
    expect(meta.providerIdentityPostcondition).toEqual({
      enforced: true,
      passed: false,
      code: 'PROVIDER_IDENTITY_MISMATCH',
      observedProviderId: 'opencode',
      observedModelId: 'big-pickle',
    });
    expect(meta.flight001Acceptance).toEqual({ checked: false });
    const metadataJson = JSON.stringify(meta);
    expect(metadataJson).not.toContain(CREDENTIAL_REF);
    expect(metadataJson).not.toContain('secret');
  });

  it('identity is observed for provership evidence on success (enforced pass)', async () => {
    const worker = makeMockWorkerService();
    (worker.executeSandboxed as jest.Mock).mockResolvedValue(
      makeWorkerResult({
        exitCode: 0,
        stdout: 'done',
        observedProviderIdentity: { providerId: 'openai', modelId: 'gpt-5.6-terra-fast' },
      }),
    );
    const result = await makeAdapter(worker).execute(
      { governedInputPayload: { args: ['--run'] } },
      makeContext(),
    );
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);

    const meta = result.providerExecutionMetadata as Record<string, unknown>;
    expect(meta.providerIdentityPostcondition).toEqual({
      enforced: true,
      passed: true,
      observedProviderId: 'openai',
      observedModelId: 'gpt-5.6-terra-fast',
    });
  });

  it('does not directly spawn shells or child processes', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      __filename.replace(/\.spec\.ts$/, '.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/child_process/);
  });
});