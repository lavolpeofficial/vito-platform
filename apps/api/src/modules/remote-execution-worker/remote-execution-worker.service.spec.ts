import { RemoteExecutionWorkerService } from './remote-execution-worker.service';
import type {
  RepositoryRegistry,
  WorkspaceProvisioner,
  WorkspaceHandle,
  SandboxExecutor,
  SandboxExecutionResult,
} from './types';

jest.mock('./change-set-capture', () => ({
  captureGovernedResultSettling: jest.fn().mockResolvedValue({
    executionId: 'exec-001',
    baseSha: 'a'.repeat(40),
    changedFiles: [],
    patch: '',
    patchTruncated: false,
    empty: true,
  }),
}));

import { captureGovernedResultSettling } from './change-set-capture';

function makeMockRegistry(): RepositoryRegistry {
  return {
    resolve: jest.fn(),
    isBaseRefAllowed: jest.fn(),
  };
}

function makeMockProvisioner(): WorkspaceProvisioner {
  return {
    provision: jest.fn(),
    cleanup: jest.fn(),
  };
}

function makeMockExecutor(): SandboxExecutor {
  return {
    execute: jest.fn(),
    validateStartup: jest.fn(),
  };
}

function makeWorkspaceHandle(): WorkspaceHandle {
  return {
    worktreePath: '/tmp/workspaces/org/run/builder',
    baseSha: 'a'.repeat(40),
    role: 'builder',
    repositoryId: 'lavolpeofficial/vito-platform',
    createdAt: new Date(),
  };
}

function makeSandboxResult(): SandboxExecutionResult {
  return {
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    durationMs: 100,
    timedOut: false,
    oomKilled: false,
  };
}

function baseInput() {
  return {
    organizationId: 'org-123',
    workflowRunId: 'run-abc',
    workflowStepRunId: 'step-1',
    repositoryId: 'lavolpeofficial/vito-platform',
    baseRef: 'refs/heads/develop',
    executable: {
      resolvedPath: '/usr/bin/node',
      commandName: 'node',
      trustedHash: 'sha256:abc',
    } as any,
    args: [],
    sandboxConfig: {
      technology: 'bubblewrap',
      timeoutMs: 30_000,
      maxMemoryBytes: 512 * 1024 * 1024,
      maxCpuTimeMs: 30_000,
      maxWorktreeBytes: 0,
    } as any,
  };
}

describe('RemoteExecutionWorkerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (captureGovernedResultSettling as jest.Mock).mockResolvedValue({
      executionId: 'exec-001',
      baseSha: 'a'.repeat(40),
      changedFiles: [],
      patch: '',
      patchTruncated: false,
      empty: true,
    });
  });

  it('orchestrates provision -> execute -> capture changeset -> cleanup', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();
    const workspace = makeWorkspaceHandle();
    const sandboxResult = makeSandboxResult();

    (registry.resolve as jest.Mock).mockReturnValue({
      repositoryId: 'lavolpeofficial/vito-platform',
      enabled: true,
    });
    (registry.isBaseRefAllowed as jest.Mock).mockReturnValue(true);
    (provisioner.provision as jest.Mock).mockResolvedValue(workspace);
    (executor.validateStartup as jest.Mock).mockResolvedValue(undefined);
    (executor.execute as jest.Mock).mockResolvedValue(sandboxResult);

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );
    const result = await service.executeSandboxed(baseInput());

    expect(executor.validateStartup).toHaveBeenCalled();
    expect(provisioner.provision).toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalled();
    expect(captureGovernedResultSettling).toHaveBeenCalledWith(
      workspace,
      expect.any(String),
    );
    expect(provisioner.cleanup).toHaveBeenCalledWith(workspace);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
  });

  it('captures changeset before cleanup', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();
    const workspace = makeWorkspaceHandle();

    const callOrder: string[] = [];
    (registry.resolve as jest.Mock).mockReturnValue({
      repositoryId: 'lavolpeofficial/vito-platform',
      enabled: true,
    });
    (registry.isBaseRefAllowed as jest.Mock).mockReturnValue(true);
    (provisioner.provision as jest.Mock).mockResolvedValue(workspace);
    (executor.validateStartup as jest.Mock).mockResolvedValue(undefined);
    (executor.execute as jest.Mock).mockResolvedValue(makeSandboxResult());
    (captureGovernedResultSettling as jest.Mock).mockImplementation(async () => {
      callOrder.push('capture');
      return {
        executionId: 'exec-001',
        baseSha: 'a'.repeat(40),
        changedFiles: [],
        patch: '',
        patchTruncated: false,
        empty: true,
      };
    });
    (provisioner.cleanup as jest.Mock).mockImplementation(async () => {
      callOrder.push('cleanup');
    });

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );
    await service.executeSandboxed(baseInput());

    expect(callOrder).toEqual(['capture', 'cleanup']);
  });

  it('result contains governedResultSettling field', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();
    const workspace = makeWorkspaceHandle();

    const settling = {
      executionId: 'exec-settling',
      baseSha: 'b'.repeat(40),
      changedFiles: ['src/foo.ts'],
      patch: 'diff --git a/src/foo.ts...',
      patchTruncated: false,
      empty: false,
    };
    (registry.resolve as jest.Mock).mockReturnValue({
      repositoryId: 'lavolpeofficial/vito-platform',
      enabled: true,
    });
    (registry.isBaseRefAllowed as jest.Mock).mockReturnValue(true);
    (provisioner.provision as jest.Mock).mockResolvedValue(workspace);
    (executor.validateStartup as jest.Mock).mockResolvedValue(undefined);
    (executor.execute as jest.Mock).mockResolvedValue(makeSandboxResult());
    (captureGovernedResultSettling as jest.Mock).mockResolvedValue(settling);

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );
    const result = await service.executeSandboxed(baseInput());

    expect(result.governedResultSettling).toEqual(settling);
  });

  it('changeset captures file changes after agent execution', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();
    const workspace = makeWorkspaceHandle();

    const changedFiles = ['src/foo.ts', 'src/bar.ts'];
    (registry.resolve as jest.Mock).mockReturnValue({
      repositoryId: 'lavolpeofficial/vito-platform',
      enabled: true,
    });
    (registry.isBaseRefAllowed as jest.Mock).mockReturnValue(true);
    (provisioner.provision as jest.Mock).mockResolvedValue(workspace);
    (executor.validateStartup as jest.Mock).mockResolvedValue(undefined);
    (executor.execute as jest.Mock).mockResolvedValue(makeSandboxResult());
    (captureGovernedResultSettling as jest.Mock).mockResolvedValue({
      executionId: 'exec-001',
      baseSha: 'a'.repeat(40),
      changedFiles,
      patch: 'diff...',
      patchTruncated: false,
      empty: false,
    });

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );
    const result = await service.executeSandboxed(baseInput());

    expect(result.governedResultSettling.changedFiles).toEqual(changedFiles);
    expect(result.governedResultSettling.empty).toBe(false);
  });

  it('cleans up workspace on execution failure', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();
    const workspace = makeWorkspaceHandle();

    (registry.resolve as jest.Mock).mockReturnValue({
      repositoryId: 'lavolpeofficial/vito-platform',
      enabled: true,
    });
    (registry.isBaseRefAllowed as jest.Mock).mockReturnValue(true);
    (provisioner.provision as jest.Mock).mockResolvedValue(workspace);
    (executor.validateStartup as jest.Mock).mockResolvedValue(undefined);
    (executor.execute as jest.Mock).mockRejectedValue(
      new Error('execution crashed'),
    );

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );

    await expect(service.executeSandboxed(baseInput())).rejects.toThrow();
    expect(provisioner.cleanup).toHaveBeenCalledWith(workspace);
  });

  it('returns frozen result object', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();
    const workspace = makeWorkspaceHandle();

    (registry.resolve as jest.Mock).mockReturnValue({
      repositoryId: 'lavolpeofficial/vito-platform',
      enabled: true,
    });
    (registry.isBaseRefAllowed as jest.Mock).mockReturnValue(true);
    (provisioner.provision as jest.Mock).mockResolvedValue(workspace);
    (executor.validateStartup as jest.Mock).mockResolvedValue(undefined);
    (executor.execute as jest.Mock).mockResolvedValue(makeSandboxResult());

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );
    const result = await service.executeSandboxed(baseInput());

    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects unknown repositoryId', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();

    (registry.resolve as jest.Mock).mockReturnValue(null);
    (executor.validateStartup as jest.Mock).mockResolvedValue(undefined);

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );

    await expect(service.executeSandboxed(baseInput())).rejects.toThrow(
      /not in the trusted registry/,
    );
  });

  it('rejects disallowed base ref', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();

    (registry.resolve as jest.Mock).mockReturnValue({
      repositoryId: 'lavolpeofficial/vito-platform',
      enabled: true,
    });
    (registry.isBaseRefAllowed as jest.Mock).mockReturnValue(false);
    (executor.validateStartup as jest.Mock).mockResolvedValue(undefined);

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );

    await expect(service.executeSandboxed(baseInput())).rejects.toThrow(
      /is not allowed for/,
    );
  });

  it('validates startup before execution', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();

    (executor.validateStartup as jest.Mock).mockRejectedValue(
      new Error('SANDBOX_UNAVAILABLE'),
    );

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );

    await expect(service.executeSandboxed(baseInput())).rejects.toThrow(
      /SANDBOX_UNAVAILABLE/,
    );
    expect(executor.validateStartup).toHaveBeenCalled();
    expect(provisioner.provision).not.toHaveBeenCalled();
  });

  it('result contains workspaceDisposition CLEANED', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();
    const workspace = makeWorkspaceHandle();

    (registry.resolve as jest.Mock).mockReturnValue({
      repositoryId: 'lavolpeofficial/vito-platform',
      enabled: true,
    });
    (registry.isBaseRefAllowed as jest.Mock).mockReturnValue(true);
    (provisioner.provision as jest.Mock).mockResolvedValue(workspace);
    (executor.validateStartup as jest.Mock).mockResolvedValue(undefined);
    (executor.execute as jest.Mock).mockResolvedValue(makeSandboxResult());

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );
    const result = await service.executeSandboxed(baseInput());

    expect(result.workspaceDisposition).toBe('CLEANED');
  });

  it('capture failure propagates as CHANGESET_CAPTURE_FAILED', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();
    const workspace = makeWorkspaceHandle();

    (registry.resolve as jest.Mock).mockReturnValue({
      repositoryId: 'lavolpeofficial/vito-platform',
      enabled: true,
    });
    (registry.isBaseRefAllowed as jest.Mock).mockReturnValue(true);
    (provisioner.provision as jest.Mock).mockResolvedValue(workspace);
    (executor.validateStartup as jest.Mock).mockResolvedValue(undefined);
    (executor.execute as jest.Mock).mockResolvedValue(makeSandboxResult());
    (captureGovernedResultSettling as jest.Mock).mockRejectedValue(
      new Error('simulated failure'),
    );

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );

    await expect(service.executeSandboxed(baseInput())).rejects.toThrow(
      expect.objectContaining({
        name: 'WorkerExecutionError',
        code: 'CHANGESET_CAPTURE_FAILED',
      }),
    );
    expect(provisioner.cleanup).toHaveBeenCalledWith(workspace);
  });

  it('capture failure does not report empty success', async () => {
    const registry = makeMockRegistry();
    const provisioner = makeMockProvisioner();
    const executor = makeMockExecutor();
    const workspace = makeWorkspaceHandle();

    (registry.resolve as jest.Mock).mockReturnValue({
      repositoryId: 'lavolpeofficial/vito-platform',
      enabled: true,
    });
    (registry.isBaseRefAllowed as jest.Mock).mockReturnValue(true);
    (provisioner.provision as jest.Mock).mockResolvedValue(workspace);
    (executor.validateStartup as jest.Mock).mockResolvedValue(undefined);
    (executor.execute as jest.Mock).mockResolvedValue(makeSandboxResult());
    (captureGovernedResultSettling as jest.Mock).mockRejectedValue(
      new Error('capture broke'),
    );

    const service = new RemoteExecutionWorkerService(
      registry,
      provisioner,
      executor,
    );

    try {
      await service.executeSandboxed(baseInput());
      fail('Expected WorkerExecutionError to be thrown');
    } catch (error: any) {
      expect(error.name).toBe('WorkerExecutionError');
      expect(error.code).toBe('CHANGESET_CAPTURE_FAILED');
      expect(error.message).toContain('capture broke');
    }
  });
});
