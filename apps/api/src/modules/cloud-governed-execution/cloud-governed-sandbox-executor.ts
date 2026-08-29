import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, isAbsolute, relative } from 'node:path';
import {
  SANDBOX_SYSTEM_MANAGED_ENV,
  SANDBOX_CALLER_PERMITTED_ENV,
} from '@vito/contracts';
import type {
  SandboxExecutor,
  SandboxExecutionRequest,
  SandboxExecutionResult,
} from '../remote-execution-worker/types';
import { BoundedOutputCapture } from '../remote-execution-worker/output-capture';
import { CloudCredentialResolver } from './cloud-credential.resolver';
import { SandboxStartupError } from '../remote-execution-worker/sandbox-executor';

/**
 * Server-managed cloud-execution hardening flags. Executor-owned constants,
 * like the Class A environment keys — a caller can never supply them.
 * They suppress remote model-catalog fetches and self-update checks at the
 * operator/agent's own feature flags.
 */
const OPENCODE_DISABLE_MODELS_FETCH = '1';
const OPENCODE_DISABLE_AUTOUPDATE = '1';

const MAX_OUTPUT_BYTES = 256 * 1024;
const SIGTERM_GRACE_MS = 2_000;
const DEFAULT_MAX_DURATION_MS = 600_000;

const SESSION_ROOT_RELATIVE = 'cloud-execution-sessions';
const SESSION_PATH_TOKEN = 'runs';

/** Fallback PATH — NEVER merged from operator process.env beyond PATH. */
const DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin';

/**
 * CloudGovernedSandboxExecutor — the ephemeral CLOUD_GOVERNED execution
 * boundary.
 *
 * Purpose (OB-002D): run a server-authorized coding agent that is permitted
 * to reach its cloud provider. The OPERATOR process does NOT gain the agent's
 * network or credential authority; all cloud state is torn down on every
 * terminal path.
 *
 * Security properties:
 *  - Executes with `detached: true` in its OWN process group; timeout kills
 *    the WHOLE group (SIGTERM, then SIGKILL after grace), never one PID.
 *  - Per-run ephemeral HOME/XDG/cache session directory OUTSIDE the worktree,
 *    under GOVERNED_WORKSPACE_ROOT; removed on every terminal path.
 *  - Credential is materialized ONLY inside the ephemeral session HOME at
 *    $XDG_DATA_HOME/opencode/auth.json; never logged, never returned;
 *    deleted with the session.
 *  - Caller-supplied env is limited to the governed allowlist (B ∪ C); the
 *    host operator env is never merged beyond PATH. No operator HOME/SSH/Git
 *    credentials, sockets or agent-sockets exist in the process env.
 *  - Bounded stdout/stderr (256 KiB), bounded duration, no shell.
 *
 * This boundary is NOT Bubblewrap: it does not claim --unshare-net, and it
 * must not be confused with the LOCAL_ISOLATED tier.
 */
@Injectable()
export class CloudGovernedSandboxExecutor implements SandboxExecutor {
  private readonly logger = new Logger(CloudGovernedSandboxExecutor.name);
  private readonly sessionRoot: string;

  constructor(
    private readonly credentialResolver: CloudCredentialResolver,
    workspaceRoot: string,
    private readonly nodeEnv = process.env.NODE_ENV ?? 'development',
  ) {
    if (!isAbsolute(workspaceRoot)) {
      throw new SandboxStartupError(
        'CLOUD_WORKSPACE_ROOT_INVALID',
        'Cloud execution workspace root must be an absolute path',
      );
    }
    this.sessionRoot = join(workspaceRoot, SESSION_ROOT_RELATIVE);
  }

  async validateStartup(): Promise<void> {
    if (!this.credentialResolver) {
      throw new SandboxStartupError(
        'CLOUD_CREDENTIAL_RESOLVER_MISSING',
        'Cloud credential resolver is not configured',
      );
    }
    if (this.nodeEnv === 'production' && !isAbsolute(this.sessionRoot)) {
      throw new SandboxStartupError(
        'CLOUD_SESSION_ROOT_INVALID',
        'Cloud session root must be an absolute path',
      );
    }
    this.logger.log(
      `Cloud-governed execution boundary validated: session root ${this.sessionRoot}`,
    );
  }

  async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    if (request.executable.resolvedPath.length === 0) {
      throw new SandboxStartupError(
        'CLOUD_EXECUTABLE_EMPTY',
        'Cloud execution requires a non-empty resolved executable path',
      );
    }

    const sessionDir = this.createSessionDir();

    try {
      this.materializeCredential(sessionDir, request.credentialReference);

      const processEnv = this.buildProcessEnv(sessionDir, request.env);
      const capture = new BoundedOutputCapture(MAX_OUTPUT_BYTES);
      const startedAt = Date.now();
      const timeoutMs = Math.max(1_000, request.sandboxConfig.timeoutMs || DEFAULT_MAX_DURATION_MS);

      return await this.spawnBounded(
        request.executable.resolvedPath,
        request.args,
        request.prompt,
        request.workspace.worktreePath,
        processEnv,
        capture,
        startedAt,
        timeoutMs,
      );
    } catch (error) {
      if (error instanceof SandboxStartupError || error instanceof CloudSandboxError) {
        throw error;
      }
      throw new CloudSandboxError(
        'CLOUD_AGENT_EXECUTION_ERROR',
        error instanceof Error ? error.message : 'Unknown cloud agent execution error',
      );
    } finally {
      // Guaranteed teardown: credentials and all ephemeral cloud state are
      // removed on EVERY terminal path (success, timeout, spawn error).
      this.teardownSession(sessionDir);
    }
  }

  /**
   * Build the sparse process environment for the cloud agent.
   * The operator process env is NEVER merged wholesale. Caller-supplied keys
   * must be within the governed caller-permitted allowlist (B ∪ C); Class A
   * executor-owned keys are rejected as override attempts.
   */
  private buildProcessEnv(
    sessionDir: string,
    callerEnv: ReadonlyMap<string, string> | undefined,
  ): Record<string, string> {
    const env: Record<string, string> = {
      HOME: sessionDir,
      TMPDIR: join(sessionDir, 'tmp'),
      XDG_CONFIG_HOME: join(sessionDir, '.config'),
      XDG_CACHE_HOME: join(sessionDir, '.cache'),
      XDG_DATA_HOME: join(sessionDir, '.local/share'),
      // Deliberately allow the operator boundary to keep exec on PATH only.
      PATH: process.env.PATH ?? DEFAULT_PATH,
      OPENCODE_DISABLE_MODELS_FETCH: OPENCODE_DISABLE_MODELS_FETCH,
      OPENCODE_DISABLE_AUTOUPDATE: OPENCODE_DISABLE_AUTOUPDATE,
    };

    if (callerEnv) {
      for (const [key, value] of callerEnv.entries()) {
        if (SANDBOX_SYSTEM_MANAGED_ENV.has(key)) {
          throw new SandboxStartupError(
            'ENV_OVERRIDE_DENIED',
            `Environment variable '${key}' is system-managed and cannot be overridden by callers`,
          );
        }
        if (!SANDBOX_CALLER_PERMITTED_ENV.has(key)) {
          throw new SandboxStartupError(
            'ENV_NOT_ALLOWED',
            `Environment variable '${key}' is not in the caller-permitted sandbox allowlist`,
          );
        }
        env[key] = value;
      }
    }

    return env;
  }

  private createSessionDir(): string {
    mkdirSync(this.sessionRoot, { recursive: true });
    const sessionDir = join(
      this.sessionRoot,
      SESSION_PATH_TOKEN,
      randomUUID(),
    );
    mkdirSync(join(sessionDir, 'tmp'), { recursive: true });
    mkdirSync(join(sessionDir, '.config'), { recursive: true });
    mkdirSync(join(sessionDir, '.cache'), { recursive: true });
    mkdirSync(join(sessionDir, '.local/share'), { recursive: true });

    if (!this.isConfined(sessionDir)) {
      throw new SandboxStartupError(
        'CLOUD_SESSION_PATH_UNSAFE',
        'Cloud session path escaped the governed session root',
      );
    }

    return sessionDir;
  }

  /**
   * Materialize the server-owned auth.json payload into the ephemeral session
   * HOME. Missing reference or unresolved secret fails closed BEFORE spawn.
   * The payload is written with restrictive permissions and never leaves the
   * session directory.
   */
  private materializeCredential(
    sessionDir: string,
    credentialReference: string | undefined,
  ): string | undefined {
    if (credentialReference === undefined) {
      return undefined;
    }

    const authJson = this.credentialResolver.resolve(credentialReference);
    if (authJson === null) {
      throw new SandboxStartupError(
        'CREDENTIAL_RESOLUTION_FAILED',
        'Cloud credential reference could not be resolved (fail closed)',
      );
    }

    const dataHome = join(sessionDir, '.local/share');
    const authDir = join(dataHome, 'opencode');
    mkdirSync(authDir, { recursive: true });
    const authPath = join(authDir, 'auth.json');
    writeFileSync(authPath, authJson, { encoding: 'utf8', mode: 0o600 });
  }

  private isConfined(sessionDir: string): boolean {
    const rel = relative(this.sessionRoot + '/', sessionDir);
    return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
  }

  private spawnBounded(
    executablePath: string,
    args: readonly string[],
    prompt: string | undefined,
    cwd: string,
    processEnv: Record<string, string>,
    capture: BoundedOutputCapture,
    startedAt: number,
    timeoutMs: number,
  ): Promise<SandboxExecutionResult> {
    return new Promise<SandboxExecutionResult>((resolve) => {
      const child = spawn(executablePath, [...args], {
        cwd,
        env: processEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Own process group so a timeout can kill the whole agent tree.
        detached: true,
      });

      child.stdout.on('data', (chunk: Buffer) => capture.appendStdout(chunk));
      child.stderr.on('data', (chunk: Buffer) => capture.appendStderr(chunk));

      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        this.logger.warn(
          `Cloud-governed agent exceeded ${timeoutMs}ms; terminating process group`,
        );
        killProcessGroup(child.pid, 'SIGTERM');
        setTimeout(() => killProcessGroup(child.pid, 'SIGKILL'), SIGTERM_GRACE_MS).unref();
      }, timeoutMs);
      timer.unref();

      const settle = (result: SandboxExecutionResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      child.on('error', () => {
        killProcessGroup(child.pid, 'SIGKILL');
        settle({
          exitCode: null,
          stdout: capture.getStdout(),
          stderr: capture.getStderr(),
          durationMs: Date.now() - startedAt,
          timedOut,
          oomKilled: false,
          sandboxLog: 'cloud agent process error',
        });
      });

      child.on('close', (code) => {
        // Best-effort reaping of any surviving grandchildren.
        killProcessGroup(child.pid, 'SIGKILL');
        settle({
          exitCode: code,
          stdout: capture.getStdout(),
          stderr: capture.getStderr(),
          durationMs: Date.now() - startedAt,
          timedOut,
          oomKilled: false,
        });
      });

      if (prompt !== undefined) {
        child.stdin.end(prompt, 'utf8');
      } else {
        child.stdin.end();
      }
    });
  }

  /**
   * Remove the ephemeral session directory (confined). Safe to call multiple
   * times. If the path ever escapes the governed session root, nothing is
   * removed and a fail-closed error is thrown instead.
   *
   * Fail closed on cleanup failure (review §9 / MEDIUM): a session that still
   * contains credential/config artifacts must NEVER yield a successful cloud
   * execution result. When rmSync fails, an explicit sanitized terminal error
   * is thrown — from the finally block this discards any pending result
   * (success, timeout or failure) so cleanup failure is never silently hidden.
   */
  private teardownSession(sessionDir: string): void {
    if (!this.isConfined(sessionDir)) {
      this.logger.error(
        `Refusing to remove unconfined cloud session path: ${sessionDir}`,
      );
      throw new SandboxStartupError(
        'CLOUD_SESSION_PATH_UNSAFE',
        'Refusing to remove an unconfined cloud session path',
      );
    }
    try {
      rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // Static, sanitized text only: no path, no underlying error detail and
      // never a credential value may reach logs or the terminal error.
      this.logger.error(
        'Cloud session cleanup failed; ephemeral credential/config artifacts were not removed',
      );
      throw new CloudSandboxError(
        'CLOUD_SESSION_CLEANUP_FAILED',
        'Cloud session cleanup failed; refusing to report cloud execution success while ephemeral artifacts may remain',
      );
    }
  }
}

/**
 * Best-effort kill of an entire process group (detached leader pid).
 * Negative pid targets the group; a negative-kill failure falls back to the
 * leader pid so a lone process is still terminated.
 */
function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined || pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

export class CloudSandboxError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CloudSandboxError';
  }
}