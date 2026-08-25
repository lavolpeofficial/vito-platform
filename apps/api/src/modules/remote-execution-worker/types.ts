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
 * System-managed sandbox environment keys.
 * These are set by the executor to sandbox-visible paths.
 * Callers MUST NOT override them — attempts are rejected fail-closed.
 */
export const SANDBOX_SYSTEM_MANAGED_ENV: ReadonlySet<string> = Object.freeze(
  new Set([
    'HOME',
    'TMPDIR',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
  ]),
);

/**
 * Caller-permitted environment keys.
 * Callers may supply values for these keys in request.env.
 * All other keys (including system-managed keys) are REJECTED.
 */
export const SANDBOX_CALLER_PERMITTED_ENV: ReadonlySet<string> = Object.freeze(
  new Set([
    'PATH',
    'USER',
    'LANG',
    'LC_ALL',
  ]),
);

/**
 * Combined allowlist: system-managed + caller-permitted.
 * Used for backward-compatible validation in buildSandboxEnv.
 */
export const SANDBOX_ENV_ALLOWLIST: ReadonlySet<string> = Object.freeze(
  new Set([
    ...SANDBOX_SYSTEM_MANAGED_ENV,
    ...SANDBOX_CALLER_PERMITTED_ENV,
  ]),
);

export const MAX_PATCH_BYTES = 2 * 1024 * 1024;
