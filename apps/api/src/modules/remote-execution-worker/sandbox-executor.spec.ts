import { BubblewrapSandboxExecutor } from './sandbox-executor';
import type { SandboxExecutionRequest } from './types';
import { SANDBOX_GOVERNED_EXECUTION_METADATA_ENV } from '@vito/contracts';

jest.mock('node:child_process', () => {
  const actual = jest.requireActual('node:child_process');
  return {
    ...actual,
    spawn: jest.fn(),
  };
});

import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';

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

function makeRequest(
  overrides: Partial<SandboxExecutionRequest> = {},
): SandboxExecutionRequest {
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
    it('CRITICAL: Production with technology=none ALWAYS fails closed', async () => {
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
    it('CRITICAL: bubblewrap args use /workspace for --bind', async () => {
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

    it('CRITICAL: bubblewrap --setenv HOME is /workspace/.vito-agent-home', async () => {
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

    it('CRITICAL: bubblewrap --setenv TMPDIR is /workspace/.vito-agent-tmp', async () => {
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

    it('CRITICAL: bubblewrap --setenv XDG_CONFIG_HOME is sandbox-visible', async () => {
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

    it('CRITICAL: bubblewrap --setenv XDG_CACHE_HOME is sandbox-visible', async () => {
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

    it('CRITICAL: NO host workspace absolute path in --setenv values', async () => {
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

  describe('system-managed env override denial', () => {
    it('CRITICAL: Rejects HOME override attempt (ENV_OVERRIDE_DENIED)', async () => {
      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest({
        env: new Map([['HOME', '/host/home']]),
      });

      let caught: any;
      try { await executor.execute(request); } catch (e) { caught = e; }
      expect(caught.code).toBe('ENV_OVERRIDE_DENIED');
      expect(caught.message).toContain('HOME');
      expect(caught.message).toContain('is system-managed');
    });

    it('CRITICAL: Rejects TMPDIR override attempt (ENV_OVERRIDE_DENIED)', async () => {
      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest({
        env: new Map([['TMPDIR', '/host/tmp']]),
      });

      let caught: any;
      try { await executor.execute(request); } catch (e) { caught = e; }
      expect(caught.code).toBe('ENV_OVERRIDE_DENIED');
      expect(caught.message).toContain('TMPDIR');
    });

    it('CRITICAL: Rejects XDG_CONFIG_HOME override attempt (ENV_OVERRIDE_DENIED)', async () => {
      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest({
        env: new Map([['XDG_CONFIG_HOME', '/host/.config']]),
      });

      let caught: any;
      try { await executor.execute(request); } catch (e) { caught = e; }
      expect(caught.code).toBe('ENV_OVERRIDE_DENIED');
      expect(caught.message).toContain('XDG_CONFIG_HOME');
    });

    it('CRITICAL: Rejects XDG_CACHE_HOME override attempt (ENV_OVERRIDE_DENIED)', async () => {
      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest({
        env: new Map([['XDG_CACHE_HOME', '/host/.cache']]),
      });

      let caught: any;
      try { await executor.execute(request); } catch (e) { caught = e; }
      expect(caught.code).toBe('ENV_OVERRIDE_DENIED');
      expect(caught.message).toContain('XDG_CACHE_HOME');
    });

    it('Allows caller-permitted keys (PATH, USER, LANG, LC_ALL)', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest({
        env: new Map([
          ['PATH', '/usr/bin:/bin'],
          ['USER', 'vito'],
          ['LANG', 'en_US.UTF-8'],
          ['LC_ALL', 'C'],
        ]),
      });

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const pathIdx = spawnArgs.indexOf('PATH');
      const setenvPathIdx = spawnArgs.lastIndexOf('--setenv', pathIdx);
      expect(spawnArgs[setenvPathIdx + 2]).toBe('/usr/bin:/bin');

      const userIdx = spawnArgs.indexOf('USER');
      const setenvUserIdx = spawnArgs.lastIndexOf('--setenv', userIdx);
      expect(spawnArgs[setenvUserIdx + 2]).toBe('vito');
    });

    it('Rejects non-allowlisted caller key (ENV_NOT_ALLOWED)', async () => {
      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest({
        env: new Map([['SNEAKY_VAR', 'injected']]),
      });

      let caught: any;
      try { await executor.execute(request); } catch (e) { caught = e; }
      expect(caught.code).toBe('ENV_NOT_ALLOWED');
      expect(caught.message).toContain('SNEAKY_VAR');
    });
  });

  describe('OB-002A governed execution metadata environment', () => {
    it('accepts every governed execution metadata key from the shared contract', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const metadataValues = new Map<string, string>();
      for (const key of SANDBOX_GOVERNED_EXECUTION_METADATA_ENV) {
        metadataValues.set(key, `value-for-${key}`);
      }
      metadataValues.set('PATH', '/usr/bin:/bin');

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest({ env: metadataValues });

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      for (const key of SANDBOX_GOVERNED_EXECUTION_METADATA_ENV) {
        const keyIdx = spawnArgs.indexOf(key);
        const setenvIdx = spawnArgs.lastIndexOf('--setenv', keyIdx);
        expect(setenvIdx).toBeGreaterThanOrEqual(0);
        expect(spawnArgs[setenvIdx + 1]).toBe(key);
        expect(spawnArgs[setenvIdx + 2]).toBe(`value-for-${key}`);
      }
    });

    it('CRITICAL: rejects credential-shaped unknown variable EVIL_TOKEN fail-closed', async () => {
      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest({
        env: new Map([['EVIL_TOKEN', 'sk-12345']]),
      });

      let caught: any;
      try { await executor.execute(request); } catch (e) { caught = e; }
      expect(caught.code).toBe('ENV_NOT_ALLOWED');
      expect(caught.message).toContain('EVIL_TOKEN');
    });

    it('CRITICAL: rejects LD_PRELOAD injection attempt fail-closed', async () => {
      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest({
        env: new Map([['LD_PRELOAD', '/tmp/libevil.so']]),
      });

      let caught: any;
      try { await executor.execute(request); } catch (e) { caught = e; }
      expect(caught.code).toBe('ENV_NOT_ALLOWED');
      expect(caught.message).toContain('LD_PRELOAD');
    });

    it('CRITICAL: sandboxed process receives NO host process.env (spawn env is {})', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest();

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnOptions = mockSpawn.mock.calls[0][2];
      expect(spawnOptions.env).toEqual({});
    });
  });

  describe('resource limits', () => {
    it('CRITICAL: bubblewrap --rlimit-as contains configured memory limit', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const memoryBytes = 512 * 1024 * 1024;
      const request = makeRequest({
        sandboxConfig: {
          technology: 'bubblewrap',
          timeoutMs: 30_000,
          maxMemoryBytes: memoryBytes,
          maxCpuTimeMs: 0,
          maxWorktreeBytes: 0,
        },
      });

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const rlimitIdx = spawnArgs.indexOf('--rlimit-as');
      expect(rlimitIdx).toBeGreaterThanOrEqual(0);
      expect(spawnArgs[rlimitIdx + 1]).toBe(String(memoryBytes));
    });

    it('CRITICAL: bubblewrap --rlimit-cpu contains configured CPU limit', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const cpuMs = 600 * 1000;
      const request = makeRequest({
        sandboxConfig: {
          technology: 'bubblewrap',
          timeoutMs: 30_000,
          maxMemoryBytes: 0,
          maxCpuTimeMs: cpuMs,
          maxWorktreeBytes: 0,
        },
      });

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      const rlimitIdx = spawnArgs.indexOf('--rlimit-cpu');
      expect(rlimitIdx).toBeGreaterThanOrEqual(0);
      expect(spawnArgs[rlimitIdx + 1]).toBe(String(Math.ceil(cpuMs / 1000)));
    });

    it('omits --rlimit-as when maxMemoryBytes is 0', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest();

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--rlimit-as');
    });

    it('omits --rlimit-cpu when maxCpuTimeMs is 0', async () => {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child);

      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');
      const request = makeRequest();

      const resultPromise = executor.execute(request);
      child.emit('close', 0);
      await resultPromise;

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--rlimit-cpu');
    });
  });
});
