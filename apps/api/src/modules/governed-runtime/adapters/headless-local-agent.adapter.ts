import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  AgentExecutionStatus,
  ExecutionAction,
  ProviderType,
  type GovernedAdapterRequest,
  type GovernedAdapterResult,
  type GovernedExecutionContext,
  type GovernedProviderAdapter,
} from '@vito/contracts';

const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;
const MAX_PROMPT_BYTES = 512 * 1024;
const MAX_CAPTURE_BYTES = 256 * 1024;

interface LocalAgentPayload {
  readonly args?: readonly string[];
  readonly prompt?: string;
}

/**
 * HeadlessLocalAgentAdapter
 *
 * Executes an already-authorized LOCAL_TOOL provider through a verified
 * executable. It never performs routing or policy decisions and never uses a
 * shell. The executable path must originate from TrustedExecutableResolver.
 *
 * Typical provider aliases are `opencode` / `codex`; the adapter itself is
 * intentionally vendor-neutral.
 */
export class HeadlessLocalAgentAdapter implements GovernedProviderAdapter {
  readonly providerType = ProviderType.LOCAL_TOOL;

  async execute(
    request: GovernedAdapterRequest,
    context: GovernedExecutionContext,
  ): Promise<GovernedAdapterResult> {
    if (context.policyDecision.requestedAction !== ExecutionAction.RUN_COMMAND) {
      return failed('UNSUPPORTED_ACTION', 'Headless local agent supports RUN_COMMAND only');
    }

    const trustedExecutable = context.trustedExecutable;
    if (!trustedExecutable) {
      return failed('TRUSTED_EXECUTABLE_REQUIRED', 'A verified executable is required');
    }

    const payload = parsePayload(request.governedInputPayload);
    if (!payload.ok) return failed(payload.code, payload.message);

    const workspace = context.environment.workingDirectory;
    const agentHome = join(workspace, '.vito-agent-home');
    const tmpDir = join(workspace, '.vito-agent-tmp');
    await mkdir(agentHome, { recursive: true });
    await mkdir(tmpDir, { recursive: true });

    const env: Record<string, string> = {};
    for (const [key, value] of context.environment.allowlist.entries()) env[key] = value;
    env.HOME = agentHome;
    env.XDG_CONFIG_HOME = join(agentHome, '.config');
    env.XDG_CACHE_HOME = join(agentHome, '.cache');
    env.TMPDIR = tmpDir;

    const startedAt = Date.now();

    try {
      const result = await runProcess({
        executable: trustedExecutable.resolvedPath,
        args: payload.value.args,
        prompt: payload.value.prompt,
        cwd: workspace,
        env,
        timeoutMs: context.timeoutMs,
      });

      const durationMs = Date.now() - startedAt;
      const commandSummary = `${trustedExecutable.commandName}${payload.value.args.length ? ' ' + payload.value.args.join(' ') : ''}`;

      if (result.timedOut) {
        return {
          status: AgentExecutionStatus.TIMED_OUT,
          providerExecutionMetadata: {
            executableIntegrityHash: trustedExecutable.integrityHash ?? null,
            exitCode: null,
            stdout: result.stdout,
            stderr: result.stderr,
            sideEffects: {
              filesCreated: [],
              filesModified: [],
              filesDeleted: [],
              commandsExecuted: [commandSummary],
            },
          },
          usageMetadata: { durationMs },
          error: {
            code: 'LOCAL_AGENT_TIMEOUT',
            message: 'Headless local agent exceeded the governed execution timeout',
            retryable: true,
          },
          completedAt: new Date(),
        };
      }

      const succeeded = result.exitCode === 0;
      return {
        status: succeeded ? AgentExecutionStatus.SUCCEEDED : AgentExecutionStatus.FAILED,
        outputReference: `gov://execution/${context.invocationId}`,
        providerExecutionMetadata: {
          executableIntegrityHash: trustedExecutable.integrityHash ?? null,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          sideEffects: {
            filesCreated: [],
            filesModified: [],
            filesDeleted: [],
            commandsExecuted: [commandSummary],
          },
        },
        usageMetadata: { durationMs },
        ...(succeeded
          ? {}
          : {
              error: {
                code: 'LOCAL_AGENT_EXIT_NONZERO',
                message: `Headless local agent exited with code ${String(result.exitCode)}`,
                retryable: false,
              },
            }),
        completedAt: new Date(),
      };
    } catch (error) {
      return failed(
        'LOCAL_AGENT_EXECUTION_ERROR',
        error instanceof Error ? error.message : 'Unknown local agent execution error',
        true,
      );
    }
  }
}

function parsePayload(
  value: Record<string, unknown> | undefined,
):
  | { ok: true; value: { args: string[]; prompt?: string } }
  | { ok: false; code: string; message: string } {
  const payload = (value ?? {}) as LocalAgentPayload;
  const args = payload.args ?? [];

  if (!Array.isArray(args) || args.length > MAX_ARGS) {
    return { ok: false, code: 'INVALID_AGENT_ARGS', message: 'args must be a bounded string array' };
  }

  const normalizedArgs: string[] = [];
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length > MAX_ARG_LENGTH || arg.includes('\0')) {
      return { ok: false, code: 'INVALID_AGENT_ARG', message: 'agent argument is invalid or too large' };
    }
    normalizedArgs.push(arg);
  }

  if (payload.prompt !== undefined) {
    if (typeof payload.prompt !== 'string' || Buffer.byteLength(payload.prompt, 'utf8') > MAX_PROMPT_BYTES) {
      return { ok: false, code: 'INVALID_AGENT_PROMPT', message: 'prompt must be a bounded string' };
    }
    return { ok: true, value: { args: normalizedArgs, prompt: payload.prompt } };
  }

  return { ok: true, value: { args: normalizedArgs } };
}

async function runProcess(input: {
  executable: string;
  args: readonly string[];
  prompt?: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const appendBounded = (current: string, chunk: Buffer): string => {
      const combined = current + chunk.toString('utf8');
      const bytes = Buffer.from(combined, 'utf8');
      if (bytes.byteLength <= MAX_CAPTURE_BYTES) return combined;
      return bytes.subarray(bytes.byteLength - MAX_CAPTURE_BYTES).toString('utf8');
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on('error', reject);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, Math.max(1, input.timeoutMs));
    timer.unref();

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });

    if (input.prompt !== undefined) child.stdin.end(input.prompt, 'utf8');
    else child.stdin.end();
  });
}

function failed(
  code: string,
  message: string,
  retryable = false,
): GovernedAdapterResult {
  return {
    status: AgentExecutionStatus.FAILED,
    providerExecutionMetadata: {},
    error: { code, message, retryable },
    completedAt: new Date(),
  };
}
