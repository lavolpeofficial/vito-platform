import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { CloudGovernedSandboxExecutor, CloudSandboxError } from './cloud-governed-sandbox-executor';
import { CloudCredentialResolver } from './cloud-credential.resolver';
import type { SandboxExecutionRequest } from '../remote-execution-worker/types';

// Deterministic cleanup-failure injection: the executor's rmSync is the ONLY
// altered fs method; everything else stays real. Used to prove (review §9 /
// MEDIUM) that teardown failure becomes an explicit sanitized terminal error.
jest.mock('node:fs', () => {
  const actual = jest.requireActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    rmSync: jest.fn(actual.rmSync),
  };
});

const mockedRmSync = (): jest.Mock => {
  const { rmSync: rm } = jest.requireMock('node:fs') as { rmSync: jest.Mock };
  return rm;
};

const NODE = process.execPath;

function resolverWith(reference: string, authJson: string): CloudCredentialResolver {
  return new CloudCredentialResolver(new Map([[reference, authJson]]));
}

function makeRequest(
  overrides: Partial<SandboxExecutionRequest> = {},
  workspaceRoot: string,
): SandboxExecutionRequest {
  return {
    workspace: {
      worktreePath: join(workspaceRoot, 'orgs', 'org1', 'runs', 'run1', 'builder'),
      baseSha: 'b'.repeat(40),
      role: 'builder',
      repositoryId: 'lavolpeofficial/vito-platform',
      createdAt: new Date(),
    },
    executable: {
      resolvedPath: NODE,
      commandName: 'node',
      verifiedAt: new Date(),
    },
    args: [],
    sandboxConfig: {
      technology: 'none',
      timeoutMs: 30_000,
      maxMemoryBytes: 0,
      maxCpuTimeMs: 0,
      maxWorktreeBytes: 0,
    },
    ...overrides,
  };
}

/** True when no regular file exists under root (empty dir trees are allowed). */
function sessionTreeFreeOfFiles(root: string): boolean {
  if (!existsSync(root)) return true;
  const walk = (dir: string): boolean => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!walk(child)) return false;
      } else {
        return false;
      }
    }
    return true;
  };
  return walk(root);
}

const SESSION_ROOT = 'cloud-execution-sessions';

describe('CloudGovernedSandboxExecutor (OB-002D ephemeral boundary)', () => {
  let workspaceRoot: string;
  let agentPath: string;
  let sleeperPath: string;

  const agentArgs = (mode: string): string[] => [agentPath, mode];

  beforeAll(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'vito-cloud-executor-'));
    mkdirSync(join(workspaceRoot, 'orgs', 'org1', 'runs', 'run1', 'builder'), { recursive: true });

    agentPath = join(workspaceRoot, 'agent.js');
    writeFileSync(
      agentPath,
      [
        "const fs = require('node:fs');",
        "const cp = require('node:child_process');",
        "function main() {",
        "  const mode = process.argv[2];",
        "  if (mode === '--fork') {",
        "    const sleeper = process.argv[3];",
        "    cp.spawn(process.execPath, [sleeper], { detached: false, stdio: 'ignore' });",
        "    setTimeout(() => {",
        "      try {",
        "        const raw = fs.readFileSync(process.env.XDG_DATA_HOME + '/sleeper.pid', 'utf8');",
        "        process.stdout.write('sleeper:' + raw.trim() + '\\n');",
        "      } catch {",
        "        process.stdout.write('sleeper:unknown\\n');",
        "      }",
        "      process.exit(0);",
        "    }, 150);",
        "    return;",
        "  }",
        "  if (mode === '--sleep') {",
        "    process.stdout.write('self:' + process.pid + '\\n');",
        "    setInterval(() => {}, 1000);",
        "    return;",
        "  }",
        "  if (mode === '--env') {",
        "    process.stdout.write(JSON.stringify({",
        "      HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,",
        "      XDG_DATA_HOME: process.env.XDG_DATA_HOME,",
        "      DISABLE_FETCH: process.env.OPENCODE_DISABLE_MODELS_FETCH,",
        "      DISABLE_AUTOUPDATE: process.env.OPENCODE_DISABLE_AUTOUPDATE,",
        "      SSHAUTH: process.env.SSH_AUTH_SOCK || null,",
        "      GTK: process.env.GTK_RC_FILES || null,",
        "      SHELL: process.env.SHELL || null,",
        "    }));",
        "    process.exit(0);",
        "  }",
        "  if (mode === '--auth') {",
        "    const p = process.env.XDG_DATA_HOME + '/opencode/auth.json';",
        "    const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'MISSING';",
        "    process.stdout.write(content);",
        "    process.exit(0);",
        "  }",
        "  if (mode === '--exit') {",
        "    process.exit(parseInt(process.argv[3] || '0', 10));",
        "  }",
        "  process.exit(parseInt(mode || '0', 10));",
        "}",
        "main();",
      ].join('\n'),
    );

    sleeperPath = join(workspaceRoot, 'sleeper.js');
    writeFileSync(
      sleeperPath,
      [
        "require('node:fs').writeFileSync(process.env.XDG_DATA_HOME + '/sleeper.pid', String(process.pid));",
        "setInterval(() => {}, 1000);",
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function executor() {
    return new CloudGovernedSandboxExecutor(
      resolverWith('cloud:test', 'x'.repeat(32)),
      workspaceRoot,
      'test',
    );
  }

  async function pidEventuallyDead(pid: number, timeoutMs = 4_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`process ${String(pid)} survived its expected termination`);
  }

  it('keepalive guard: the agent fixture itself is functional', async () => {
    const result = await executor().execute(
      makeRequest({ args: agentArgs('--env') }, workspaceRoot),
    );
    expect(result.exitCode).toBe(0);
  });

  describe('environment isolation', () => {
    it('CRITICAL: process env contains ONLY the governed keys, never host operator env', async () => {
      const result = await executor().execute(
        makeRequest({ args: agentArgs('--env') }, workspaceRoot),
      );
      const env = JSON.parse(result.stdout);
      expect(env.SSHAUTH).toBeNull();
      expect(env.GTK).toBeNull();
      expect(env.SHELL).toBeNull();
      expect(env.DISABLE_FETCH).toBe('1');
      expect(env.DISABLE_AUTOUPDATE).toBe('1');
      expect(env.HOME.startsWith(join(workspaceRoot, SESSION_ROOT))).toBe(true);
    });

    it('CRITICAL: the agent HOME is never an operator HOME path', async () => {
      const result = await executor().execute(
        makeRequest({ args: agentArgs('--env') }, workspaceRoot),
      );
      const env = JSON.parse(result.stdout);
      if (process.env.HOME) {
        expect(env.HOME).not.toContain(process.env.HOME);
      }
      expect(env.HOME.startsWith(workspaceRoot)).toBe(true);
    });

    it('rejects caller override of system-managed keys', async () => {
      await expect(
        executor().execute(
          makeRequest({ args: agentArgs('--env'), env: new Map([['HOME', '/home/attacker']]) }, workspaceRoot),
        ),
      ).rejects.toThrow(/cannot be overridden by callers/);
    });

    it('rejects caller env outside the governed allowlist', async () => {
      await expect(
        executor().execute(
          makeRequest({ args: agentArgs('--env'), env: new Map([['EVIL_TOKEN', 'x']]) }, workspaceRoot),
        ),
      ).rejects.toThrow(/caller-permitted sandbox allowlist/);
    });
  });

  describe('credential handling', () => {
    it('CRITICAL: auth.json is materialized ONLY inside the ephemeral session', async () => {
      const secret = '{"authFixture": true}';
      const ex = new CloudGovernedSandboxExecutor(
        resolverWith('cloud:test-secret', secret),
        workspaceRoot,
        'test',
      );
      const result = await ex.execute(
        makeRequest({ args: agentArgs('--auth'), credentialReference: 'cloud:test-secret' }, workspaceRoot),
      );
      expect(result.stdout.trim()).toBe(secret);
    });

    it('CRITICAL: no session artifacts (incl. auth.json) survive after execution', async () => {
      const secret = '{"will be removed": true}';
      const ex = new CloudGovernedSandboxExecutor(
        resolverWith('cloud:remove-me', secret),
        workspaceRoot,
        'test',
      );
      await ex.execute(
        makeRequest({ args: agentArgs('--auth'), credentialReference: 'cloud:remove-me' }, workspaceRoot),
      );
      expect(sessionTreeFreeOfFiles(join(workspaceRoot, SESSION_ROOT))).toBe(true);
    });

    it('fails closed before spawn when the credential reference cannot be resolved', async () => {
      const ex = new CloudGovernedSandboxExecutor(
        resolverWith('other', '{}'),
        workspaceRoot,
        'test',
      );
      await expect(
        ex.execute(
          makeRequest({ args: agentArgs('--sleep'), credentialReference: 'cloud:missing-ref' }, workspaceRoot),
        ),
      ).rejects.toThrow(/could not be resolved \(fail closed\)/);
    });

    it('CRITICAL: no session directory is left behind on a pre-spawn credential failure', async () => {
      const ex = new CloudGovernedSandboxExecutor(
        resolverWith('other', '{}'),
        workspaceRoot,
        'test',
      );
      await ex
        .execute(
          makeRequest({ args: agentArgs('--exit'), credentialReference: 'cloud:missing-ref' }, workspaceRoot),
        )
        .catch(() => undefined);
      expect(sessionTreeFreeOfFiles(join(workspaceRoot, SESSION_ROOT))).toBe(true);
    });
  });

  describe('failure paths (review §9)', () => {
    it('CRITICAL: timeout kills the whole agent tree and removes the session', async () => {
      const result = await executor().execute(
        makeRequest(
          {
            args: agentArgs('--sleep'),
            sandboxConfig: {
              technology: 'none',
              timeoutMs: 600,
              maxMemoryBytes: 0,
              maxCpuTimeMs: 0,
              maxWorktreeBytes: 0,
            },
          },
          workspaceRoot,
        ),
      );
      expect(result.timedOut).toBe(true);
      const pid = Number(result.stdout.match(/self:(\d+)/)?.[1]);
      expect(Number.isFinite(pid)).toBe(true);
      await pidEventuallyDead(pid);
      expect(sessionTreeFreeOfFiles(join(workspaceRoot, SESSION_ROOT))).toBe(true);
    });

    it('CRITICAL: grandchildren spawned by the agent are reaped on agent exit', async () => {
      const result = await executor().execute(
        makeRequest({ args: [agentPath, '--fork', sleeperPath] }, workspaceRoot),
      );
      expect(result.exitCode).toBe(0);
      const pid = Number(result.stdout.match(/sleeper:(\d+)/)?.[1]);
      expect(Number.isFinite(pid)).toBe(true);
      await pidEventuallyDead(pid);
      expect(sessionTreeFreeOfFiles(join(workspaceRoot, SESSION_ROOT))).toBe(true);
    });

    it('exit nonzero propagates and the session is still removed', async () => {
      const result = await executor().execute(
        makeRequest({ args: [...agentArgs('--exit'), '7'] }, workspaceRoot),
      );
      expect(result.exitCode).toBe(7);
      expect(sessionTreeFreeOfFiles(join(workspaceRoot, SESSION_ROOT))).toBe(true);
    });

    it('failed spawn (missing executable) resolves without a session left behind', async () => {
      const request = makeRequest({ args: ['--env'] }, workspaceRoot);
      const result = await executor().execute({
        ...request,
        executable: { ...request.executable, resolvedPath: join(workspaceRoot, 'does-not-exist.js') },
      });
      expect(result.exitCode).toBeNull();
      expect(result.sandboxLog).toContain('cloud agent process error');
      expect(sessionTreeFreeOfFiles(join(workspaceRoot, SESSION_ROOT))).toBe(true);
    });
  });

  describe('cleanup failure fails closed (review §9 / MEDIUM)', () => {
    const secret = 'SECRET_AUTH_VALUE_prohibit_reporting_success';

    async function expectCleanupTerminalFailure(
      request: SandboxExecutionRequest,
      overrides: { resolver?: CloudCredentialResolver } = {},
    ): Promise<CloudSandboxError> {
      mockedRmSync().mockImplementationOnce(() => {
        // Simulate a destructive cleanup failure; the secret embedded here must
        // never reach the caller's error or the log fixtures (sanitization proof).
        throw new Error(`EPERM while removing ${secret}`);
      });
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        const ex = new CloudGovernedSandboxExecutor(
          overrides.resolver ?? resolverWith('cloud:cleanup', secret),
          workspaceRoot,
          'test',
        );
        try {
          const outcome = await ex.execute(request);
          throw new Error(`expected cleanup failure rejection, got result exitCode=${String(outcome.exitCode)}`);
        } catch (error) {
          expect(error).toBeInstanceOf(CloudSandboxError);
          const cloudError = error as CloudSandboxError;
          expect(cloudError.code).toBe('CLOUD_SESSION_CLEANUP_FAILED');
          expect(cloudError.message).not.toContain(secret);

          const logged = loggerSpy.mock.calls.map((call) => String(call[0])).join('\n');
          expect(logged).toContain('Cloud session cleanup failed');
          expect(logged).not.toContain(secret);

          return cloudError;
        }
      } finally {
        loggerSpy.mockRestore();
      }
    }

    it('CRITICAL: cleanup failure after a SUCCESSFUL execution becomes an explicit terminal failure (never success)', async () => {
      const error = await expectCleanupTerminalFailure(
        makeRequest({ args: agentArgs('--auth'), credentialReference: 'cloud:cleanup' }, workspaceRoot),
      );
      expect(error.message).toMatch(/refusing to report cloud execution success/);
    });

    it('CRITICAL: cleanup failure on the TIMEOUT path becomes an explicit terminal failure (never reported)', async () => {
      await expectCleanupTerminalFailure(
        makeRequest(
          {
            args: agentArgs('--sleep'),
            sandboxConfig: {
              technology: 'none',
              timeoutMs: 600,
              maxMemoryBytes: 0,
              maxCpuTimeMs: 0,
              maxWorktreeBytes: 0,
            },
          },
          workspaceRoot,
        ),
      );
    });

    it('CRITICAL: cleanup failure on the NONZERO-EXIT (failure) path becomes an explicit terminal failure', async () => {
      await expectCleanupTerminalFailure(
        makeRequest({ args: [...agentArgs('--exit'), '7'] }, workspaceRoot),
      );
    });

    it('CRITICAL: cleanup failure on the SPAWN-ERROR path becomes an explicit terminal failure', async () => {
      const request = makeRequest({ args: ['--env'] }, workspaceRoot);
      await expectCleanupTerminalFailure({
        ...request,
        executable: { ...request.executable, resolvedPath: join(workspaceRoot, 'does-not-exist.js') },
      });
    });

    it('a subsequent cleanup that succeeds restores normal behavior (mock is deterministic and scoped)', async () => {
      const listRuns = (): string[] => {
        const runs = join(workspaceRoot, SESSION_ROOT, 'runs');
        return existsSync(runs) ? readdirSync(runs) : [];
      };
      const before = new Set(listRuns());
      const result = await executor().execute(
        makeRequest({ args: [...agentArgs('--exit'), '3'] }, workspaceRoot),
      );
      expect(result.exitCode).toBe(3);
      expect(listRuns().filter((run) => !before.has(run))).toHaveLength(0);
    });
  });

  describe('validateStartup', () => {
    it('fails closed on a non-absolute workspace root', () => {
      expect(
        () => new CloudGovernedSandboxExecutor(resolverWith('a', '{}'), 'relative/root', 'test'),
      ).toThrow(/must be an absolute path/);
    });

    it('reports a ready ephemeral boundary', async () => {
      await expect(executor().validateStartup()).resolves.toBeUndefined();
    });
  });
});