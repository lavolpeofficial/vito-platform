import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  WorkspaceHandle,
  WorkspaceProvisionRequest,
  SandboxExecutionRequest,
  RepositoryRegistry,
  WorkspaceProvisioner,
  SandboxExecutor,
  ExpectedProviderIdentity,
  ObservedProviderIdentity,
  ProviderIdentityError,
} from './types';
import type { GovernedSandboxConfig, TrustedExecutable } from '@vito/contracts';
import { captureGovernedResultSettling } from './change-set-capture';
import type { GovernedResultSettling } from './change-set-capture';
import { ChangeSetCaptureError } from './change-set-capture';

/**
 * Audit ownership note:
 * - Idempotency is owned by GovernedInvocationServiceImpl upstream.
 * - Audit event emission is delegated to the existing AuditModule/AuditService.
 * - This worker does NOT create a second idempotency or lifecycle engine.
 * - Worker emits lifecycle debug logs; authoritative audit records are produced
 *   by the governed invocation pipeline before and after adapter.execute().
 *
 * Sensitive payload logging policy:
 * - governedResultSettling.patch MUST NOT be logged verbatim.
 * - Lifecycle/debug logs may log only: executionId, baseSha, changed-file
 *   count, patch byte size, and status (empty/not-empty).
 * - No environment values or patch body appear in logs.
 */
export interface ExecuteSandboxedInput {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly repositoryId: string;
  readonly baseRef: string;
  readonly executable: TrustedExecutable;
  readonly args: readonly string[];
  readonly prompt?: string;
  readonly sandboxConfig: GovernedSandboxConfig;
  readonly env?: ReadonlyMap<string, string>;
  /**
   * Server-owned opaque credential reference (never a credential value).
   * The cloud-governed boundary resolves this ref into an ephemeral session
   * artifact ONLY; the local Bubblewrap path never receives credential refs.
   */
  readonly credentialReference?: string;
  /**
   * Server-authorized provider identity the CLOUD_GOVERNED boundary must
   * observe (OB002D-MEDIUM-PROVIDER-IDENTITY). Never caller-derived.
   */
  readonly expectedProviderIdentity?: ExpectedProviderIdentity;
}

export interface ExecuteSandboxedResult {
  readonly executionId: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly oomKilled: boolean;
  readonly baseSha: string;
  readonly repositoryId: string;
  /** Audit-only — workspace is cleaned before this result is returned. */
  readonly workspaceDisposition: 'CLEANED';
  readonly governedResultSettling: GovernedResultSettling;
  readonly observedProviderIdentity?: ObservedProviderIdentity;
  readonly providerIdentityError?: ProviderIdentityError;
}

@Injectable()
export class RemoteExecutionWorkerService {
  private readonly logger = new Logger(RemoteExecutionWorkerService.name);

  constructor(
    private readonly repositoryRegistry: RepositoryRegistry,
    private readonly workspaceProvisioner: WorkspaceProvisioner,
    private readonly sandboxExecutor: SandboxExecutor,
  ) {}

  async executeSandboxed(input: ExecuteSandboxedInput): Promise<ExecuteSandboxedResult> {
    const executionId = randomUUID();
    this.logger.debug(`Execution ${executionId} starting`);

    await this.sandboxExecutor.validateStartup();

    const repo = this.repositoryRegistry.resolve(input.repositoryId);
    if (!repo) {
      throw new WorkerExecutionError(
        'REPOSITORY_NOT_ALLOWED',
        `Repository '${input.repositoryId}' is not in the trusted registry`,
      );
    }

    if (!this.repositoryRegistry.isBaseRefAllowed(input.repositoryId, input.baseRef)) {
      throw new WorkerExecutionError(
        'BASE_REF_NOT_ALLOWED',
        `Base ref '${input.baseRef}' is not allowed for '${input.repositoryId}'`,
      );
    }

    let workspace: WorkspaceHandle;
    try {
      workspace = await this.workspaceProvisioner.provision({
        organizationId: input.organizationId,
        workflowRunId: input.workflowRunId,
        repositoryId: input.repositoryId,
        baseRef: input.baseRef,
        role: 'builder',
      });
    } catch (error) {
      throw new WorkerExecutionError(
        'WORKSPACE_PROVISION_FAILED',
        error instanceof Error ? error.message : 'Failed to provision workspace',
      );
    }

    try {
      const sandboxRequest: SandboxExecutionRequest = {
        workspace,
        executable: input.executable,
        args: input.args,
        prompt: input.prompt,
        sandboxConfig: input.sandboxConfig,
        env: input.env,
        credentialReference: input.credentialReference,
        expectedProviderIdentity: input.expectedProviderIdentity,
      };

      const sandboxResult = await this.sandboxExecutor.execute(sandboxRequest);

      let governedResultSettling: GovernedResultSettling;
      try {
        governedResultSettling = await captureGovernedResultSettling(
          workspace,
          executionId,
        );
      } catch (error) {
        const code = error instanceof ChangeSetCaptureError
          ? error.code
          : 'CHANGESET_CAPTURE_FAILED';

        this.logger.error(
          `Change-set capture failed: execution=${executionId} code=${code}`,
        );

        throw new WorkerExecutionError(
          code,
          error instanceof Error ? error.message : 'Failed to capture governed change-set',
        );
      }

      this.logger.debug(
        `Change-set captured: execution=${executionId} files=${governedResultSettling.changedFiles.length} patchBytes=${Buffer.byteLength(governedResultSettling.patch, 'utf8')} empty=${governedResultSettling.empty}`,
      );

      return Object.freeze({
        executionId,
        exitCode: sandboxResult.exitCode,
        stdout: sandboxResult.stdout,
        stderr: sandboxResult.stderr,
        durationMs: sandboxResult.durationMs,
        timedOut: sandboxResult.timedOut,
        oomKilled: sandboxResult.oomKilled,
        baseSha: workspace.baseSha,
        repositoryId: workspace.repositoryId,
        workspaceDisposition: 'CLEANED' as const,
        governedResultSettling,
        ...(sandboxResult.observedProviderIdentity
          ? { observedProviderIdentity: sandboxResult.observedProviderIdentity }
          : {}),
        ...(sandboxResult.providerIdentityError
          ? { providerIdentityError: sandboxResult.providerIdentityError }
          : {}),
      });
    } finally {
      await this.workspaceProvisioner.cleanup(workspace);
    }
  }
}

export class WorkerExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkerExecutionError';
  }
}
