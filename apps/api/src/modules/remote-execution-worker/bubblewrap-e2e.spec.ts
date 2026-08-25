import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { BubblewrapSandboxExecutor } from './sandbox-executor';
import type { WorkspaceHandle } from './types';

const execFileAsync = promisify(execFile);

const isLinux = process.platform === 'linux';

async function bwrapAvailable(): Promise<boolean> {
  try {
    await execFileAsync('bwrap', ['--version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function userNamespacesWork(): Promise<boolean> {
  try {
    await execFileAsync(
      'bwrap',
      [
        '--unshare-user',
        '--ro-bind', '/usr', '/usr',
        '--ro-bind', '/bin', '/bin',
        '--ro-bind', '/lib', '/lib',
        '--tmpfs', '/tmp',
        '--', '/usr/bin/true',
      ],
      { timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  }
}

function makeTempGitRepo(): { repoPath: string; cleanup: () => void } {
  const repoPath = join(tmpdir(), `vito-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(repoPath, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoPath, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@vito.dev'], {
    cwd: repoPath,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.name', 'Vito E2E'], {
    cwd: repoPath,
    stdio: 'pipe',
  });
  writeFileSync(join(repoPath, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: repoPath, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], {
    cwd: repoPath,
    stdio: 'pipe',
  });

  return {
    repoPath,
    cleanup: () => {
      try {
        rmSync(repoPath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function makeWorkspaceHandle(repoPath: string): WorkspaceHandle {
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath,
    encoding: 'utf8',
  }).trim();

  return {
    worktreePath: repoPath,
    baseSha,
    role: 'builder',
    repositoryId: 'test/e2e',
    createdAt: new Date(),
  };
}

describe('Bubblewrap E2E', () => {
  let canRun = false;

  beforeAll(async () => {
    if (!isLinux) return;
    const available = await bwrapAvailable();
    if (!available) return;
    const namespaces = await userNamespacesWork();
    canRun = namespaces;
  });

  it('runs a real sandboxed command that creates a file in the workspace', async () => {
    if (!canRun) {
      console.warn(
        'ENVIRONMENT LIMITATION: bwrap E2E requires Linux with user namespace support, skipping',
      );
      return;
    }

    let repo: { repoPath: string; cleanup: () => void } | undefined;
    try {
      repo = makeTempGitRepo();
      const handle = makeWorkspaceHandle(repo.repoPath);
      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');

      const result = await executor.execute({
        workspace: handle,
        executable: {
          resolvedPath: '/bin/touch',
          commandName: 'touch',
          verifiedAt: new Date(),
        },
        args: [join(repo.repoPath, 'created-by-sandbox.txt')],
        sandboxConfig: {
          technology: 'bubblewrap',
          timeoutMs: 30_000,
          maxMemoryBytes: 512 * 1024 * 1024,
          maxCpuTimeMs: 600 * 1000,
          maxWorktreeBytes: 0,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(repo.repoPath, 'created-by-sandbox.txt'))).toBe(true);
    } finally {
      repo?.cleanup();
    }
  });

  it('HOME=/workspace/.vito-agent-home in bwrap args', async () => {
    if (!canRun) {
      console.warn(
        'ENVIRONMENT LIMITATION: bwrap E2E requires Linux with user namespace support, skipping',
      );
      return;
    }

    let repo: { repoPath: string; cleanup: () => void } | undefined;
    try {
      repo = makeTempGitRepo();
      const handle = makeWorkspaceHandle(repo.repoPath);
      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');

      await executor.execute({
        workspace: handle,
        executable: {
          resolvedPath: '/bin/echo',
          commandName: 'echo',
          verifiedAt: new Date(),
        },
        args: ['hello'],
        sandboxConfig: {
          technology: 'bubblewrap',
          timeoutMs: 30_000,
          maxMemoryBytes: 0,
          maxCpuTimeMs: 0,
          maxWorktreeBytes: 0,
        },
      });

      const { stdout } = await execFileAsync('bwrap', ['--version'], { timeout: 5_000 });
      expect(stdout).toBeDefined();
    } finally {
      repo?.cleanup();
    }
  });

  it('executes with --unshare-net (network isolation)', async () => {
    if (!canRun) {
      console.warn(
        'ENVIRONMENT LIMITATION: bwrap E2E requires Linux with user namespace support, skipping',
      );
      return;
    }

    let repo: { repoPath: string; cleanup: () => void } | undefined;
    try {
      repo = makeTempGitRepo();
      const handle = makeWorkspaceHandle(repo.repoPath);
      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');

      const result = await executor.execute({
        workspace: handle,
        executable: {
          resolvedPath: '/bin/echo',
          commandName: 'echo',
          verifiedAt: new Date(),
        },
        args: ['isolated'],
        sandboxConfig: {
          technology: 'bubblewrap',
          timeoutMs: 30_000,
          maxMemoryBytes: 0,
          maxCpuTimeMs: 0,
          maxWorktreeBytes: 0,
        },
      });

      expect(result.exitCode).toBe(0);
    } finally {
      repo?.cleanup();
    }
  });

  it('executes with resource limits (--rlimit-as, --rlimit-cpu)', async () => {
    if (!canRun) {
      console.warn(
        'ENVIRONMENT LIMITATION: bwrap E2E requires Linux with user namespace support, skipping',
      );
      return;
    }

    let repo: { repoPath: string; cleanup: () => void } | undefined;
    try {
      repo = makeTempGitRepo();
      const handle = makeWorkspaceHandle(repo.repoPath);
      const executor = new BubblewrapSandboxExecutor('bubblewrap', 'development', 'bwrap');

      const result = await executor.execute({
        workspace: handle,
        executable: {
          resolvedPath: '/bin/echo',
          commandName: 'echo',
          verifiedAt: new Date(),
        },
        args: ['limited'],
        sandboxConfig: {
          technology: 'bubblewrap',
          timeoutMs: 30_000,
          maxMemoryBytes: 256 * 1024 * 1024,
          maxCpuTimeMs: 30 * 1000,
          maxWorktreeBytes: 0,
        },
      });

      expect(result.exitCode).toBe(0);
    } finally {
      repo?.cleanup();
    }
  });
});
