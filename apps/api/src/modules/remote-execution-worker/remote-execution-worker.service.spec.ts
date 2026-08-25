import { RemoteExecutionWorkerService, WorkerExecutionError } from './remote-execution-worker.service';
import type {
  RepositoryRegistry,
  WorkspaceProvisioner,
  SandboxExecutor,
  WorkspaceHandle,
  SandboxExecutionResult,
  RegisteredRepository,
} from './types';

describe('RemoteExecutionWorkerService', () => {
  const VITO_REPO = 'lavolpeofficial/vito-platform';
  const DEFAULT_SandboxConfig = {
    technology: 'bubblewrap' as const,
    timeoutMs: 30_000,
    maxMemoryBytes: 256 * 1024 * 1024,
    maxCpuTimeMs: 30_000,
    maxWorktreeBytes: 100 * 1024 * 1024,
  };

  function makeRegistry(overrides: Partial<RegisteredRepository> = {}): RepositoryRegistry {
    const repo: RegisteredRepository = {
      repositoryId: VITO_REPO,
      cloneUrl: 'git@github.com:lavolpeofficial/vito-platform.git',
      allowedBaseRefs: ['main', 'develop'],
      registeredAt: new Date(),
      enabled: true,
      ...overrides,
    };
    return {
      resolve: (id: string) => (id === repo.repositoryId ? repo : null),
      isBaseRefAllowed: (id: string, ref: string) =>
        id === repo.repositoryId && repo.allowedBaseRefs.includes(ref),
    };
  }

  function makeWorkspace(): WorkspaceHandle {
    return {
      worktreePath: '/tmp/workspaces/test',
      baseSha: 'abc123def456',
      role: 'builder',
      repositoryId: VITO_REPO,
      createdAt: new Date(),
    };
  }

  function makeExecutor(result: Partial<SandboxExecutionResult> = {}): SandboxExecutor {
    const defaultResult: SandboxExecutionResult = {
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 100,
      timedOut: false,
      oomKilled: false,
      ...result,
    };
    return {
      validateStartup: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue(defaultResult),
    };
  }

  function makeProvisioner(handle?: WorkspaceHandle): WorkspaceProvisioner {
    return {
      provision: jest.fn().mockResolvedValue(handle ?? makeWorkspace()),
      cleanup: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('orchestrates provision -> execute -> cleanup', async () => {
    const registry = makeRegistry();
    const provisioner = makeProvisioner();
    const executor = makeExecutor();
    const service = new RemoteExecutionWorkerService(registry, provisioner, executor);

    const result = await service.executeSandboxed({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      repositoryId: VITO_REPO,
      baseRef: 'main',
      executable: {
        commandName: 'agent',
        resolvedPath: '/usr/bin/agent',
        integrityHash: 'sha256:abc',
        verifiedAt: new Date(),
      },
      args: ['--version'],
      sandboxConfig: DEFAULT_SandboxConfig,
    });

    expect(result.executionId).toBeDefined();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
    expect(provisioner.provision).toHaveBeenCalledTimes(1);
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(provisioner.cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown repositoryId', async () => {
    const registry = makeRegistry();
    const provisioner = makeProvisioner();
    const executor = makeExecutor();
    const service = new RemoteExecutionWorkerService(registry, provisioner, executor);

    await expect(
      service.executeSandboxed({
        organizationId: 'org-1',
        workflowRunId: 'run-1',
        workflowStepRunId: 'step-1',
        repositoryId: 'attacker/evil',
        baseRef: 'main',
        executable: {
          commandName: 'agent',
          resolvedPath: '/usr/bin/agent',
          verifiedAt: new Date(),
        },
        args: [],
        sandboxConfig: DEFAULT_SandboxConfig,
      }),
    ).rejects.toThrow(WorkerExecutionError);
  });

  it('rejects disallowed base ref', async () => {
    const registry = makeRegistry();
    const provisioner = makeProvisioner();
    const executor = makeExecutor();
    const service = new RemoteExecutionWorkerService(registry, provisioner, executor);

    await expect(
      service.executeSandboxed({
        organizationId: 'org-1',
        workflowRunId: 'run-1',
        workflowStepRunId: 'step-1',
        repositoryId: VITO_REPO,
        baseRef: 'refs/heads/main',
        executable: {
          commandName: 'agent',
          resolvedPath: '/usr/bin/agent',
          verifiedAt: new Date(),
        },
        args: [],
        sandboxConfig: DEFAULT_SandboxConfig,
      }),
    ).rejects.toThrow(WorkerExecutionError);
  });

  it('validates startup before execution', async () => {
    const registry = makeRegistry();
    const provisioner = makeProvisioner();
    const executor = makeExecutor();
    const service = new RemoteExecutionWorkerService(registry, provisioner, executor);

    await service.executeSandboxed({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      repositoryId: VITO_REPO,
      baseRef: 'main',
      executable: {
        commandName: 'agent',
        resolvedPath: '/usr/bin/agent',
        verifiedAt: new Date(),
      },
      args: [],
      sandboxConfig: DEFAULT_SandboxConfig,
    });

    expect(executor.validateStartup).toHaveBeenCalledTimes(1);
  });

  it('cleans up workspace on execution failure', async () => {
    const registry = makeRegistry();
    const provisioner = makeProvisioner();
    const executor = makeExecutor({ exitCode: 1, stderr: 'error' });
    const service = new RemoteExecutionWorkerService(registry, provisioner, executor);

    await service.executeSandboxed({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      repositoryId: VITO_REPO,
      baseRef: 'main',
      executable: {
        commandName: 'agent',
        resolvedPath: '/usr/bin/agent',
        verifiedAt: new Date(),
      },
      args: [],
      sandboxConfig: DEFAULT_SandboxConfig,
    });

    expect(provisioner.cleanup).toHaveBeenCalledTimes(1);
  });

  it('returns frozen result object', async () => {
    const registry = makeRegistry();
    const provisioner = makeProvisioner();
    const executor = makeExecutor();
    const service = new RemoteExecutionWorkerService(registry, provisioner, executor);

    const result = await service.executeSandboxed({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      repositoryId: VITO_REPO,
      baseRef: 'main',
      executable: {
        commandName: 'agent',
        resolvedPath: '/usr/bin/agent',
        verifiedAt: new Date(),
      },
      args: [],
      sandboxConfig: DEFAULT_SandboxConfig,
    });

    expect(Object.isFrozen(result)).toBe(true);
  });
});
