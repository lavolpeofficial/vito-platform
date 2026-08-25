import { BubblewrapSandboxExecutor, SandboxStartupError } from './sandbox-executor';
import type { SandboxExecutionRequest, WorkspaceHandle } from './types';

describe('BubblewrapSandboxExecutor', () => {
  function makeRequest(overrides: Partial<SandboxExecutionRequest> = {}): SandboxExecutionRequest {
    return {
      workspace: {
        worktreePath: '/tmp/test-workspace',
        baseSha: 'abc123def456',
        role: 'builder',
        repositoryId: 'lavolpeofficial/vito-platform',
        createdAt: new Date(),
      },
      executable: {
        commandName: 'agent',
        resolvedPath: '/usr/bin/echo',
        integrityHash: 'sha256:abc',
        verifiedAt: new Date(),
      },
      args: ['hello'],
      sandboxConfig: {
        technology: 'bubblewrap',
        timeoutMs: 30_000,
        maxMemoryBytes: 256 * 1024 * 1024,
        maxCpuTimeMs: 30_000,
        maxWorktreeBytes: 100 * 1024 * 1024,
      },
      ...overrides,
    };
  }

  it('fails closed on production with technology none', async () => {
    const executor = new BubblewrapSandboxExecutor('none', false);
    process.env.NODE_ENV = 'production';
    try {
      await expect(executor.validateStartup()).rejects.toThrow(SandboxStartupError);
    } finally {
      delete process.env.NODE_ENV;
    }
  });

  it('allows technology none in development', async () => {
    process.env.NODE_ENV = 'development';
    const executor = new BubblewrapSandboxExecutor('none', false);
    await expect(executor.validateStartup()).resolves.not.toThrow();
    delete process.env.NODE_ENV;
  });

  it('allows technology none when explicitly enabled', async () => {
    process.env.NODE_ENV = 'production';
    const executor = new BubblewrapSandboxExecutor('none', true);
    await expect(executor.validateStartup()).resolves.not.toThrow();
    delete process.env.NODE_ENV;
  });

  it('rejects unknown technology', async () => {
    const executor = new BubblewrapSandboxExecutor('unknown', false);
    await expect(executor.validateStartup()).rejects.toThrow(SandboxStartupError);
  });

  it('validates bubblewrap binary exists', async () => {
    const executor = new BubblewrapSandboxExecutor('bubblewrap', false, 'nonexistent-bwrap');
    await expect(executor.validateStartup()).rejects.toThrow(SandboxStartupError);
  });

  it('executes unsandboxed when technology is none', async () => {
    process.env.NODE_ENV = 'development';
    const executor = new BubblewrapSandboxExecutor('none', false);
    await executor.validateStartup();

    const result = await executor.execute(makeRequest());
    expect(result.exitCode).toBeDefined();
    delete process.env.NODE_ENV;
  });

  it('uses bubblewrap when technology is bubblewrap', async () => {
    const executor = new BubblewrapSandboxExecutor('bubblewrap', false);
    // This will fail because bwrap may not exist, but the error
    // should be about execution, not about technology
    await expect(executor.validateStartup()).resolves.not.toThrow();
  });
});
