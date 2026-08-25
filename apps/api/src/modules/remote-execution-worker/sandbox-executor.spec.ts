import { BubblewrapSandboxExecutor } from './sandbox-executor';
import type { SandboxExecutionRequest } from './types';

jest.mock('node:child_process', () => {
  const actual = jest.requireActual('node:child_process');
  return {
    ...actual,
    spawn: jest.fn(),
  };
});

import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';

const mockSpawn = spawn as unknown as jest.Mock;
const mockExecFile = execFile as unknown as jest.Mock;

function makeMockChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: jest.fn() };
  child.kill = jest.fn();
  return child;
}

function makeRequest(overrides: Partial<SandboxExecutionRequest> = {}): SandboxExecutionRequest {
  return {
    workspace: {
      worktreePath: '/tmp/workspaces/org/run/builder',
      baseSha: 'a'.repeat(40),
      role: 'builder',
      repositoryId: 'lavolpeofficial/vito-platform',
      createdAt: new Date(),
    },
    executable: {
      resolvedPath: '/usr/bin/node',
      commandName: 'node',
      verifiedAt: new Date(),
    },
    args: ['--version'],
    sandboxConfig: {
      technology: 'bubblewrap',
      timeoutMs: 30_000,
      maxMemoryBytes: 0,
      maxCpuTimeMs: 0,
      maxWorktreeBytes: 0,
    },
    ...overrides,
  };
}

describe('BubblewrapSandboxExecutor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateStartup', () => {
    it('CRITICAL: Production with technology=none ALWAYS fails closed (even with override)', async () => {
      const executor = new BubblewrapSandboxExecutor('none', 'production', 'bwrap');
      await expect(executor.validateStartup()).rejects.toThrow(
        /NOT permitted in production/,
      );
    });

    it('Allows technology=none in development', async () => {
      const executor = new BubblewrapSandboxExecutor('none', 'development', 'bwrap');
      await expect(executor.validateStartup()).resolves.toBeUndefined();
    });

    it('Allows technology=none in test environment', async () => {
      const executor = new BubblewrapSandboxExecutor('none', 'test', 'bwrap');
      await expect(executor.validateStartup()).resolves.toBeUndefined();
    });

    it('Rejects unknown technology', async () => {
      const executor = new BubblewrapSandboxExecutor('firejail', 'development', 'bwrap');
      await expect(executor.validateStartup()).rejects.toThrow(
        /Unknown sandbox technology/,
      );
    });

    it('Validates bubblewrap binary exists', async () => {
      const executor = new BubblewrapSandboxExecutor(
        'bubblewrap',
        'development',
        'nonexistent-bwrap',
      );
      await expect(executor.validateStartup()).rejects.toThrow(
        /Bubblewrap binary not found/,
      );
    });
  });

  describe('execute bubblewrap args', () => {
    it('CRITICAL: bubblewrap args use /workspace for --bind (sandbox-visible)', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const worktreePath = '/tmp/workspaces/org/run/builder';
      const request = makeRequest({
        workspace: {
          worktreePath,
          baseSha: 'a'.repeat(40),
          role: 'builder',
          repositoryId: 'lavolpeofficial/vito-platform',
          createdAt: new Date(),
        },
      });

      const resultPromise = executor.execute(request);
      child.emit('close', 0);

      const result = await resultPromise;
      expect(result.exitCode).toBe(0);

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const bindIdx = spawnArgs.indexOf('--bind');
      expect(bindIdx).toBeGreaterThanOrEqual(0);
      expect(spawnArgs[bindIdx + 1]).toBe(worktreePath);
      expect(spawnArgs[bindIdx + 2]).toBe('/workspace');
    });

    it('CRITICAL: bubblewrap --setenv HOME is /workspace/.vito-agent-home (sandbox-visible)', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest();

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const homeIdx = spawnArgs.indexOf('HOME');
      const setenvIdx = spawnArgs.lastIndexOf('--setenv', homeIdx);
      expect(setenvIdx).toBeGreaterThanOrEqual(0);
      expect(spawnArgs[setenvIdx + 1]).toBe('HOME');
      expect(spawnArgs[setenvIdx + 2]).toBe('/workspace/.vito-agent-home');
    });

    it('CRITICAL: bubblewrap --setenv TMPDIR is /workspace/.vito-agent-tmp (sandbox-visible)', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest();

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const tmpdirIdx = spawnArgs.indexOf('TMPDIR');
      const setenvIdx = spawnArgs.lastIndexOf('--setenv', tmpdirIdx);
      expect(setenvIdx).toBeGreaterThanOrEqual(0);
      expect(spawnArgs[setenvIdx + 1]).toBe('TMPDIR');
      expect(spawnArgs[setenvIdx + 2]).toBe('/workspace/.vito-agent-tmp');
    });

    it('CRITICAL: bubblewrap --setenv XDG_CONFIG_HOME is /workspace/.vito-agent-home/.config', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest();

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const xdgIdx = spawnArgs.indexOf('XDG_CONFIG_HOME');
      const setenvIdx = spawnArgs.lastIndexOf('--setenv', xdgIdx);
      expect(setenvIdx).toBeGreaterThanOrEqual(0);
      expect(spawnArgs[setenvIdx + 1]).toBe('XDG_CONFIG_HOME');
      expect(spawnArgs[setenvIdx + 2]).toBe('/workspace/.vito-agent-home/.config');
    });

    it('CRITICAL: bubblewrap --setenv XDG_CACHE_HOME is /workspace/.vito-agent-home/.cache', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest();

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const xdgIdx = spawnArgs.indexOf('XDG_CACHE_HOME');
      const setenvIdx = spawnArgs.lastIndexOf('--setenv', xdgIdx);
      expect(setenvIdx).toBeGreaterThanOrEqual(0);
      expect(spawnArgs[setenvIdx + 1]).toBe('XDG_CACHE_HOME');
      expect(spawnArgs[setenvIdx + 2]).toBe('/workspace/.vito-agent-home/.cache');
    });

    it('CRITICAL: NO host workspace absolute path appears in bubblewrap --setenv values', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const worktreePath = '/tmp/workspaces/org/run/builder';
      const request = makeRequest({
        workspace: {
          worktreePath,
          baseSha: 'a'.repeat(40),
          role: 'builder',
          repositoryId: 'lavolpeofficial/vito-platform',
          createdAt: new Date(),
        },
      });

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      for (let i = 0; i < spawnArgs.length; i++) {
        if (spawnArgs[i] === '--setenv') {
          const value = spawnArgs[i + 2];
          expect(value).not.toContain(worktreePath);
        }
      }
    });

    it('CRITICAL: Production with technology=none ALWAYS fails closed on execute', async () => {
      const executor = new BubblewrapSandboxExecutor('none', 'production', 'bwrap');
      await expect(executor.execute(makeRequest())).rejects.toThrow(
        /NOT permitted in production/,
      );
    });
  });
});
