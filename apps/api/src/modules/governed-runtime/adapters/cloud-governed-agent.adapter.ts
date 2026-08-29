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
import type {
  ExecuteSandboxedResult,
  RemoteExecutionWorkerService,
} from '../../remote-execution-worker/remote-execution-worker.service';
import { WorkerExecutionError } from '../../remote-execution-worker/remote-execution-worker.service';
import { CloudExecutionProfileRegistry } from '../../cloud-governed-execution/cloud-execution-profile.registry';
import { CloudSandboxError } from '../../cloud-governed-execution/cloud-governed-sandbox-executor';
import { evaluateFlight001Acceptance } from '../../cloud-governed-execution/flight-001-acceptance';

const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;
const MAX_PROMPT_BYTES = 512 * 1024;
const MIN_EXECUTION_DURATION_MS = 1_000;

interface CloudAgentPayload {
  readonly args?: readonly string[];
  readonly prompt?: string;
}

/**
 * CloudGovernedAgentAdapter
 *
 * Executes an already-authorized CLOUD_LLM provider through the ephemeral
 * cloud boundary (CloudGovernedSandboxExecutor) via the dedicated cloud
 * worker instance.
 *
 * Preconditions enforced here (ALL fail closed, before any execution):
 *  - the adapter is only reachable for CLOUD_LLM providers,
 *  - a server-owned, ENABLED CloudExecutionProfile is bound to the provider
 *    code,
 *  - the already-trusted executable alias equals the profile's launcher alias,
 *  - an opaque credential reference is present in the governed context.
 *
 * It never performs routing or policy decisions and never uses a shell.
 * The executable path must originate from TrustedExecutableResolver.
 *
 * Execution path (CLOUD_GOVERNED tier):
 *   GovernedInvocationService → CloudGovernedAgentAdapter → CLOUD_EXECUTION_WORKER
 *     → CloudGovernedSandboxExecutor (ephemeral session boundary)
 *
 * This adapter NEVER handles the LOCAL_ISOLATED tier and never touches
 * Bubblewrap; credential values never appear in inputs, outputs or logs.
 */
export class CloudGovernedAgentAdapter implements GovernedProviderAdapter {
  readonly providerType = ProviderType.CLOUD_LLM;

  constructor(
    private readonly cloudWorker: RemoteExecutionWorkerService,
    private readonly profileRegistry: CloudExecutionProfileRegistry,
  ) {}

  async execute(
    request: GovernedAdapterRequest,
    context: GovernedExecutionContext,
  ): Promise<GovernedAdapterResult> {
    if (context.policyDecision.requestedAction !== ExecutionAction.RUN_COMMAND) {
      return failed(
        'UNSUPPORTED_ACTION',
        'Cloud governed agent supports RUN_COMMAND only',
      );
    }

    const trustedExecutable = context.trustedExecutable;
    if (!trustedExecutable) {
      return failed('TRUSTED_EXECUTABLE_REQUIRED', 'A verified executable is required');
    }

    const profile = this.resolveEnabledProfile(context);
    if (!profile) {
      return failed(
        'CLOUD_EXECUTION_PROFILE_UNAVAILABLE',
        'No server-owned enabled cloud execution profile for this provider',
      );
    }

    if (trustedExecutable.commandName !== profile.trustedLauncherAlias) {
      return failed(
        'EXECUTABLE_PROFILE_MISMATCH',
        'Trusted executable does not match the server-owned cloud profile launcher',
      );
    }

    if (!context.credentialReference) {
      return failed(
        'CLOUD_CREDENTIAL_UNAVAILABLE',
        'Cloud execution requires a server-owned credential reference',
      );
    }

    const payload = parsePayload(request.governedInputPayload);
    if (!payload.ok) return failed(payload.code, payload.message);

    const timeoutMs = Math.max(
      MIN_EXECUTION_DURATION_MS,
      Math.min(context.timeoutMs, profile.maxDurationMs),
    );

    // The cloud boundary does NOT use Bubblewrap; technology 'none' here means
    // "no OS sandbox technology flag", governed instead by the ephemeral
    // session boundary (own process group, bounded IO, teardown on every path).
    const sandboxConfig: GovernedSandboxConfig = {
      technology: 'none',
      timeoutMs,
      maxMemoryBytes: 0,
      maxCpuTimeMs: 0,
      maxWorktreeBytes: 0,
    };

    try {
      const result = await this.cloudWorker.executeSandboxed({
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
        credentialReference: context.credentialReference,
        // Server-owned expected identity — derived ONLY from the immutable
        // server profile. Never from caller/operator input.
        expectedProviderIdentity: {
          providerId: profile.expectedProviderId,
          ...(profile.allowedModelIds ? { allowedModelIds: profile.allowedModelIds } : {}),
        },
      });

      return mapWorkerResult(
        result,
        trustedExecutable,
        context.invocationId,
        payload.value.args,
      );
    } catch (error) {
      if (error instanceof WorkerExecutionError) {
        const isChangesetError =
          error.code === 'CHANGESET_CAPTURE_FAILED' ||
          error.code === 'CHANGESET_TOO_LARGE';
        return failed(error.code, error.message, !isChangesetError);
      }
      if (error instanceof CloudSandboxError) {
        return failed(error.code, error.message, false);
      }
      return failed(
        'CLOUD_AGENT_EXECUTION_ERROR',
        error instanceof Error ? error.message : 'Unknown cloud agent execution error',
        true,
      );
    }
  }

  private resolveEnabledProfile(context: GovernedExecutionContext) {
    if (!context.providerCode) {
      return null;
    }
    return this.profileRegistry.resolve(context.providerCode);
  }
}

/**
 * Attach the Flight 001 acceptance evidence to the adapter result metadata.
 * The agent's own success exit code is NOT sufficient: acceptance additionally
 * requires the byte-exact canonical proof as the ONLY change-set. Evidence is
 * sanitized (booleans, paths, hashes — never content, never credentials).
 */
function buildFlight001AcceptanceEvidence(result: ExecuteSandboxedResult) {
  const settling = result.governedResultSettling;
  if (!settling) {
    return {
      checked: false,
    };
  }
  const acceptance = evaluateFlight001Acceptance(settling);
  return {
    checked: true,
    passed: acceptance.passed,
    expectedPath: acceptance.expectedPath,
    expectedSha256: acceptance.expectedSha256,
    actualSha256: acceptance.actualSha256,
  };
}

function mapWorkerResult(
  result: ExecuteSandboxedResult,
  trustedExecutable: { commandName: string; integrityHash?: string },
  invocationId: string,
  args: readonly string[],
): GovernedAdapterResult {
  const commandSummary = `${trustedExecutable.commandName}${args.length ? ' ' + args.join(' ') : ''}`;

  // OB002D-MEDIUM-PROVIDER-IDENTITY: acceptance/providership evidence is
  // sanitized (validated provider/model ids, booleans, paths, hashes — never
  // content, never credentials). Postcondition UNENFORCED would mean the
  // server-owned profile did not authorize an identity; enforced-false means
  // the observed identity failed the profile gate.
  const identityEvidence = result.observedProviderIdentity
    ? {
        observedProviderId: result.observedProviderIdentity.providerId,
        observedModelId: result.observedProviderIdentity.modelId,
      }
    : { observedProviderId: null, observedModelId: null };

  const flight001Acceptance = result.providerIdentityError
    ? { checked: false }
    : buildFlight001AcceptanceEvidence(result);

  const providerIdentityPostcondition = result.providerIdentityError
    ? {
        enforced: true,
        passed: false,
        code: result.providerIdentityError.code,
        ...identityEvidence,
      }
    : { enforced: true, passed: true, ...identityEvidence };

  const baseMetadata = {
    executableIntegrityHash: trustedExecutable.integrityHash ?? null,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    governedResultSettling: result.governedResultSettling,
    workspaceDisposition: result.workspaceDisposition,
    credentialDisposition: 'removed' as const,
    flight001Acceptance,
    providerIdentityPostcondition,
    sideEffects: {
      filesCreated: [],
      filesModified: result.governedResultSettling?.changedFiles ?? [],
      filesDeleted: [],
      commandsExecuted: [commandSummary],
    },
  };

  if (result.providerIdentityError) {
    return {
      status: AgentExecutionStatus.FAILED,
      providerExecutionMetadata: baseMetadata,
      usageMetadata: { durationMs: result.durationMs },
      error: {
        code: result.providerIdentityError.code,
        message: result.providerIdentityError.message,
        retryable: false,
      },
      completedAt: new Date(),
    };
  }

  if (result.timedOut) {
    return {
      status: AgentExecutionStatus.TIMED_OUT,
      providerExecutionMetadata: baseMetadata,
      usageMetadata: { durationMs: result.durationMs },
      error: {
        code: 'CLOUD_AGENT_TIMEOUT',
        message: 'Cloud governed agent exceeded the governed execution timeout',
        retryable: true,
      },
      completedAt: new Date(),
    };
  }

  const succeeded = result.exitCode === 0;
  return {
    status: succeeded ? AgentExecutionStatus.SUCCEEDED : AgentExecutionStatus.FAILED,
    outputReference: `gov://execution/${invocationId}`,
    providerExecutionMetadata: baseMetadata,
    usageMetadata: { durationMs: result.durationMs },
    ...(succeeded
      ? {}
      : {
          error: {
            code: 'CLOUD_AGENT_EXIT_NONZERO',
            message: `Cloud governed agent exited with code ${String(result.exitCode)}`,
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
  const payload = (value ?? {}) as CloudAgentPayload;
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