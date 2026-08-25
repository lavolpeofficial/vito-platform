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
 * Explicit allowlist of environment variables permitted inside the sandbox.
 * All other variables are REJECTED fail-closed.
 * The agent process receives only these keys plus HOME and TMPDIR.
 */
export const SANDBOX_ENV_ALLOWLIST: ReadonlySet<string> = Object.freeze(
  new Set([
    'HOME',
    'TMPDIR',
    'PATH',
    'USER',
    'LANG',
    'LC_ALL',
  ]),
);
