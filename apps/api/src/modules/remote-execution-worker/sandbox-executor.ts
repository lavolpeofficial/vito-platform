import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { BoundedOutputCapture } from './output-capture';
import { SANDBOX_ENV_ALLOWLIST } from './types';
import type {
  SandboxExecutor,
  SandboxExecutionRequest,
  SandboxExecutionResult,
} from './types';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_BYTES = 256 * 1024;
const SIGTERM_GRACE_MS = 2_000;

const SANDBOX_WORKSPACE = '/workspace';
const SANDBOX_AGENT_HOME = '/workspace/.vito-agent-home';
const SANDBOX_AGENT_TMP = '/workspace/.vito-agent-tmp';

@Injectable()
export class BubblewrapSandboxExecutor implements SandboxExecutor {
  private readonly logger = new Logger(BubblewrapSandboxExecutor.name);
  private readonly bwrapPath: string;
  private readonly technology: string;
  private readonly nodeEnv: string;

  constructor(
    technology = process.env.VITO_SANDBOX_TECHNOLOGY ?? 'bubblewrap',
    nodeEnv = process.env.NODE_ENV ?? 'development',
    bwrapPath = 'bwrap',
  ) {
    this.technology = technology;
    this.nodeEnv = nodeEnv;
    this.bwrapPath = bwrapPath;
  }

  async validateStartup(): Promise<void> {
    if (this.technology === 'none') {
      if (this.nodeEnv === 'production') {
        throw new SandboxStartupError(
          'SANDBOX_DOWNGRADE_DENIED',
          'Sandbox technology "none" is NOT permitted in production. Set VITO_SANDBOX_TECHNOLOGY=bubblewrap.',
        );
      }
      this.logger.warn(
        'Sandbox technology "none" is active. This is ONLY permitted for non-production environments.',
      );
      return;
    }

    if (this.technology !== 'bubblewrap') {
      throw new SandboxStartupError(
        'SANDBOX_TECHNOLOGY_UNKNOWN',
        `Unknown sandbox technology: '${this.technology}'. Only 'bubblewrap' is supported in v0.1.`,
      );
    }

    try {
      const { stdout } = await execFileAsync(this.bwrapPath, ['--version'], {
        timeout: 5_000,
      });
      this.logger.log(
        `Bubblewrap validated: ${stdout.trim().split('\n')[0] ?? 'unknown version'}`,
      );
    } catch (error) {
      throw new SandboxStartupError(
        'SANDBOX_UNAVAILABLE',
        `Bubblewrap binary not found or not functional at '${this.bwrapPath}'. ` +
          `Production execution is not possible without a valid sandbox.`,
      );
    }
  }

  async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    if (this.technology === 'none') {
      if (this.nodeEnv === 'production') {
        throw new SandboxStartupError(
          'SANDBOX_DOWNGRADE_DENIED',
          'Sandbox technology "none" is NOT permitted in production. Execution blocked.',
        );
      }
      return this.executeUnsandboxed(request);
    }

    if (this.technology !== 'bubblewrap') {
      throw new SandboxStartupError(
        'SANDBOX_TECHNOLOGY_UNKNOWN',
        `Cannot execute with unknown technology: '${this.technology}'`,
      );
    }

    return this.executeBubblewrap(request);
  }

  /**
   * Build the sandbox environment.
   * HOME, TMPDIR, XDG_* are sandbox-visible paths (/workspace/...), never host paths.
   */
  private buildSandboxEnv(
    request: SandboxExecutionRequest,
  ): ReadonlyMap<string, string> {
    const env = new Map<string, string>();

    env.set('HOME', SANDBOX_AGENT_HOME);
    env.set('TMPDIR', SANDBOX_AGENT_TMP);
    env.set('XDG_CONFIG_HOME', `${SANDBOX_AGENT_HOME}/.config`);
    env.set('XDG_CACHE_HOME', `${SANDBOX_AGENT_HOME}/.cache`);

    if (request.env) {
      for (const [key, value] of request.env.entries()) {
        if (!SANDBOX_ENV_ALLOWLIST.has(key)) {
          throw new SandboxStartupError(
            'ENV_NOT_ALLOWED',
            `Environment variable '${key}' is not in the sandbox allowlist`,
          );
        }
        env.set(key, value);
      }
    }

    return env;
  }

  private async executeBubblewrap(
    request: SandboxExecutionRequest,
  ): Promise<SandboxExecutionResult> {
    const { workspace, executable, args, sandboxConfig } = request;

    const hostAgentHome = join(workspace.worktreePath, '.vito-agent-home');
    const hostAgentTmp = join(workspace.worktreePath, '.vito-agent-tmp');
    mkdirSafe(hostAgentHome);
    mkdirSafe(hostAgentTmp);

    const env = this.buildSandboxEnv(request);

    const bwrapArgs: string[] = [
      '--unshare-user',
      '--unshare-pid',
      '--unshare-net',
      '--ro-bind', '/usr', '/usr',
      '--ro-bind', '/bin', '/bin',
      '--ro-bind', '/lib', '/lib',
      '--die-with-parent',
      '--dev', '/dev',
      '--proc', '/proc',
      '--bind', workspace.worktreePath, SANDBOX_WORKSPACE,
      '--tmpfs', '/tmp',
    ];

    if (existsSync('/lib64')) {
      bwrapArgs.push('--ro-bind', '/lib64', '/lib64');
    }

    for (const [key, value] of env.entries()) {
      bwrapArgs.push('--setenv', key, value);
    }

    if (sandboxConfig.maxMemoryBytes > 0) {
      bwrapArgs.push('--rlimit-as', String(sandboxConfig.maxMemoryBytes));
    }

    if (sandboxConfig.maxCpuTimeMs > 0) {
      const cpuSeconds = Math.max(1, Math.ceil(sandboxConfig.maxCpuTimeMs / 1000));
      bwrapArgs.push('--rlimit-cpu', String(cpuSeconds));
    }

    bwrapArgs.push('--');
    bwrapArgs.push(executable.resolvedPath);
    bwrapArgs.push(...args);

    return this.spawnInSandbox(bwrapArgs, request, sandboxConfig.timeoutMs);
  }

  private async executeUnsandboxed(
    request: SandboxExecutionRequest,
  ): Promise<SandboxExecutionResult> {
    const { workspace, executable, args, sandboxConfig } = request;

    const hostAgentHome = join(workspace.worktreePath, '.vito-agent-home');
    const hostAgentTmp = join(workspace.worktreePath, '.vito-agent-tmp');
    mkdirSafe(hostAgentHome);
    mkdirSafe(hostAgentTmp);

    const env = this.buildSandboxEnv(request);
    const processEnv: Record<string, string> = Object.fromEntries(env.entries());

    return this.spawnDirect(executable.resolvedPath, args, request, processEnv, sandboxConfig.timeoutMs);
  }

  private async spawnInSandbox(
    bwrapArgs: string[],
    request: SandboxExecutionRequest,
    timeoutMs: number,
  ): Promise<SandboxExecutionResult> {
    const capture = new BoundedOutputCapture(MAX_OUTPUT_BYTES);
    const startedAt = Date.now();

    return new Promise((resolve) => {
      const child = spawn(this.bwrapPath, bwrapArgs, {
        cwd: request.workspace.worktreePath,
        env: {},
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk: Buffer) => capture.appendStdout(chunk));
      child.stderr.on('data', (chunk: Buffer) => capture.appendStderr(chunk));

      let timedOut = false;
      let oomKilled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }, SIGTERM_GRACE_MS).unref();
      }, timeoutMs);
      timer.unref();

      child.on('error', () => {
        clearTimeout(timer);
        resolve({
          exitCode: null,
          stdout: capture.getStdout(),
          stderr: capture.getStderr(),
          durationMs: Date.now() - startedAt,
          timedOut,
          oomKilled,
          sandboxLog: 'bwrap process error',
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code,
          stdout: capture.getStdout(),
          stderr: capture.getStderr(),
          durationMs: Date.now() - startedAt,
          timedOut,
          oomKilled,
        });
      });

      if (request.prompt !== undefined) {
        child.stdin.end(request.prompt, 'utf8');
      } else {
        child.stdin.end();
      }
    });
  }

  private async spawnDirect(
    executablePath: string,
    args: readonly string[],
    request: SandboxExecutionRequest,
    processEnv: Record<string, string>,
    timeoutMs: number,
  ): Promise<SandboxExecutionResult> {
    const capture = new BoundedOutputCapture(MAX_OUTPUT_BYTES);
    const startedAt = Date.now();

    return new Promise((resolve) => {
      const child = spawn(executablePath, [...args], {
        cwd: request.workspace.worktreePath,
        env: processEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk: Buffer) => capture.appendStdout(chunk));
      child.stderr.on('data', (chunk: Buffer) => capture.appendStderr(chunk));

      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }, SIGTERM_GRACE_MS).unref();
      }, timeoutMs);
      timer.unref();

      child.on('error', () => {
        clearTimeout(timer);
        resolve({
          exitCode: null,
          stdout: capture.getStdout(),
          stderr: capture.getStderr(),
          durationMs: Date.now() - startedAt,
          timedOut,
          oomKilled: false,
          sandboxLog: 'unsandboxed process error',
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code,
          stdout: capture.getStdout(),
          stderr: capture.getStderr(),
          durationMs: Date.now() - startedAt,
          timedOut,
          oomKilled: false,
        });
      });

      if (request.prompt !== undefined) {
        child.stdin.end(request.prompt, 'utf8');
      } else {
        child.stdin.end();
      }
    });
  }
}

function mkdirSafe(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    /* ignore if exists */
  }
}

export class SandboxStartupError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SandboxStartupError';
  }
}
