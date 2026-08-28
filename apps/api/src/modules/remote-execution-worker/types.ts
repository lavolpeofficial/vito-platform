import type { TrustedExecutable, GovernedSandboxConfig } from '@vito/contracts';

export type SandboxTechnology = 'bubblewrap' | 'none';

export interface RegisteredRepository {
  readonly repositoryId: string;
  readonly cloneUrl: string;
  readonly allowedBaseRefs: ReadonlyArray<string>;
  readonly registeredAt: Date;
  readonly enabled: boolean;
}

export interface RepositoryRegistry {
  resolve(repositoryId: string): RegisteredRepository | null;
  isBaseRefAllowed(repositoryId: string, baseRef: string): boolean;
}

export interface WorkspaceProvisionRequest {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly repositoryId: string;
  readonly baseRef: string;
  readonly role: 'builder' | 'reviewer';
  readonly allowedPaths?: ReadonlyArray<string>;
  readonly deniedPaths?: ReadonlyArray<string>;
}

export interface WorkspaceHandle {
  readonly worktreePath: string;
  readonly baseSha: string;
  readonly role: 'builder' | 'reviewer';
  readonly repositoryId: string;
  readonly createdAt: Date;
}

export interface SandboxExecutionRequest {
  readonly workspace: WorkspaceHandle;
  readonly executable: TrustedExecutable;
  readonly args: readonly string[];
  readonly prompt?: string;
  readonly sandboxConfig: GovernedSandboxConfig;
  readonly env?: ReadonlyMap<string, string>;
}

export interface SandboxExecutionResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly oomKilled: boolean;
  readonly sandboxLog?: string;
}

export interface WorkspaceProvisioner {
  provision(request: WorkspaceProvisionRequest): Promise<WorkspaceHandle>;
  cleanup(handle: WorkspaceHandle): Promise<void>;
}

export interface SandboxExecutor {
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>;
  validateStartup(): Promise<void>;
}

export interface OutputCapture {
  getStdout(): string;
  getStderr(): string;
  appendStdout(chunk: Buffer): void;
  appendStderr(chunk: Buffer): void;
}

/**
 * Sandbox environment classification — single authoritative source is the
 * governed sandbox-environment contract in @vito/contracts (OB-002A).
 * The sandbox boundary MUST NOT maintain an independent key list; additions
 * or removals must happen in the contract and be mirrored by contract-drift
 * tests. See SANDBOX_* comments there.
 *
 * SANDBOX_SYSTEM_MANAGED_ENV   — Class A: executor-owned; callers may never
 *                                override (ENV_OVERRIDE_DENIED).
 * SANDBOX_PROCESS_COMPATIBILITY_ENV — Class B: explicitly permitted from the
 *                                trusted adapter boundary.
 * SANDBOX_GOVERNED_EXECUTION_METADATA_ENV — Class C: server-generated governed
 *                                execution context the invocation layer may
 *                                forward.
 * SANDBOX_CALLER_PERMITTED_ENV = B ∪ C.
 * SANDBOX_ENV_ALLOWLIST        = A ∪ B ∪ C.
 */
export {
  SANDBOX_SYSTEM_MANAGED_ENV,
  SANDBOX_PROCESS_COMPATIBILITY_ENV,
  SANDBOX_GOVERNED_EXECUTION_METADATA_ENV,
  SANDBOX_CALLER_PERMITTED_ENV,
  SANDBOX_ENV_ALLOWLIST,
} from '@vito/contracts';

