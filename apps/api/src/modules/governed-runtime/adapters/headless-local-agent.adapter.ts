import {
  AgentExecutionStatus,
  ExecutionAction,
  ProviderType,
  type GovernedAdapterRequest,
  type GovernedAdapterResult,
  type GovernedExecutionContext,
  type GovernedProviderAdapter,
  type GovernedSandboxConfig,
} from '@vito/contracts';
import type { RemoteExecutionWorkerService, ExecuteSandboxedResult } from '../../remote-execution-worker/remote-execution-worker.service';

const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;
const MAX_PROMPT_BYTES = 512 * 1024;

interface LocalAgentPayload {
  readonly args?: readonly string[];
  readonly prompt?: string;
}

/**
 * HeadlessLocalAgentAdapter
 *
 * Executes an already-authorized LOCAL_TOOL provider through a verified
 * executable via RemoteExecutionWorkerService (Bubblewrap sandbox).
 * It never performs routing or policy decisions and never uses a shell.
 * The executable path must originate from TrustedExecutableResolver.
 *
 * Execution path:
 *   GovernedInvocationService → HeadlessLocalAgentAdapter → RemoteExecutionWorkerService → BubblewrapSandboxExecutor
 */
export class HeadlessLocalAgentAdapter implements GovernedProviderAdapter {
  readonly providerType = ProviderType.LOCAL_TOOL;

  constructor(
    private readonly workerService: RemoteExecutionWorkerService,
  ) {}

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

    const sandboxConfig: GovernedSandboxConfig = {
      technology: 'bubblewrap',
      timeoutMs: context.timeoutMs,
      maxMemoryBytes: 0,
      maxCpuTimeMs: 0,
      maxWorktreeBytes: 0,
    };

    try {
      const result = await this.workerService.executeSandboxed({
        organizationId: context.organizationId,
        workflowRunId: context.workflowRunId,
        workflowStepRunId: context.workflowStepRunId,
        repositoryId: 'lavolpeofficial/vito-platform',
        baseRef: 'main',
        executable: trustedExecutable,
        args: payload.value.args,
        prompt: payload.value.prompt,
        sandboxConfig,
        env: context.environment.allowlist.size > 0 ? context.environment.allowlist : undefined,
      });

      return mapWorkerResult(result, trustedExecutable, context.invocationId, payload.value.args);
    } catch (error) {
      return failed(
        'LOCAL_AGENT_EXECUTION_ERROR',
        error instanceof Error ? error.message : 'Unknown local agent execution error',
        true,
      );
    }
  }
}

function mapWorkerResult(
  result: ExecuteSandboxedResult,
  trustedExecutable: { commandName: string; integrityHash?: string },
  invocationId: string,
  args: readonly string[],
): GovernedAdapterResult {
  const commandSummary = `${trustedExecutable.commandName}${args.length ? ' ' + args.join(' ') : ''}`;

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
      usageMetadata: { durationMs: result.durationMs },
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
    outputReference: `gov://execution/${invocationId}`,
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
    usageMetadata: { durationMs: result.durationMs },
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
