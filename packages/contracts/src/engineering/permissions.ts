/**
 * Execution Permission Policy for the Engineering Runtime.
 *
 * Fail-closed security defaults for VITO-EO:
 * - allowSecrets = false
 * - allowGitCommit = false
 * - allowGitPush = false
 * - allowMerge = false
 * - allowBranchDelete = false
 *
 * Finding E correction: This interface is a legacy convenience layer.
 * The authoritative execution-policy boundary is evaluatePolicy() in
 * execution-policy.ts (EO-01.4). Do not add conflicting denials here;
 * path security is enforced by EO-01.4's canonicalized path evaluation.
 *
 * In particular, prisma/ paths inside a builder worktree are legitimate
 * source modifications and must not be blanket-denied.
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
    deniedPaths: ['.env', '.env.*'],
  };
}
