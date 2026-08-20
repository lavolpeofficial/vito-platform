/**
 * Execution Permission Policy für den Engineering Runtime.
 *
 * Fail-closed Sicherheitsdefaults für VITO-EO:
 * - allowSecrets = false
 * - allowGitCommit = false
 * - allowGitPush = false
 * - allowMerge = false
 * - allowBranchDelete = false
 */
export interface ExecutionPermissionPolicy {
  readonly allowRead: boolean;
  readonly allowWrite: boolean;
  readonly allowTests: boolean;
  readonly allowNetwork: boolean;
  readonly allowSecrets: boolean;

  readonly allowGitCommit: boolean;
  readonly allowGitPush: boolean;
  readonly allowMerge: boolean;
  readonly allowBranchDelete: boolean;

  readonly allowedPaths: readonly string[];
  readonly deniedPaths: readonly string[];
}

/** Sichere Defaults für VITO-Engineering-Operations */
export function createDefaultEngineeringPermissionPolicy(): ExecutionPermissionPolicy {
  return {
    allowRead: true,
    allowWrite: true,
    allowTests: true,
    allowNetwork: false,
    allowSecrets: false,

    allowGitCommit: false,
    allowGitPush: false,
    allowMerge: false,
    allowBranchDelete: false,

    allowedPaths: ['packages/', 'apps/'],
    deniedPaths: ['.env', '.env.*', 'prisma/'],
  };
}
