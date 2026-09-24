import {
  ExecutionTier,
  type GovernedExecutionContext,
} from '@vito/contracts';

export const CODE_BUILD_EXECUTION_TARGET_VERSION = 'CODE_BUILD_TARGET_V1' as const;
export const CODE_BUILD_REPOSITORY = 'lavolpeofficial/vito-platform' as const;
export const CODE_BUILD_BASE_REF = 'main' as const;

const FEATURE_BRANCH = /^feat\/[a-z0-9][a-z0-9-]*$/;
const PROVIDER_CODE = /^[a-zA-Z0-9._-]{1,128}$/;
const COMMAND_ALIAS = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface CodeBuildExecutionTarget {
  readonly version: typeof CODE_BUILD_EXECUTION_TARGET_VERSION;
  readonly organizationId: string;
  readonly missionId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly repository: typeof CODE_BUILD_REPOSITORY;
  readonly publicationBranch: string;
  readonly baseRef: typeof CODE_BUILD_BASE_REF;
  readonly providerId: string;
  readonly providerCode: string;
  readonly executionTier: ExecutionTier;
  readonly commandAlias: string;
}

export function buildCodeBuildExecutionTarget(
  input: Omit<CodeBuildExecutionTarget, 'version' | 'baseRef'>,
): CodeBuildExecutionTarget {
  const target: CodeBuildExecutionTarget = Object.freeze({
    version: CODE_BUILD_EXECUTION_TARGET_VERSION,
    ...input,
    baseRef: CODE_BUILD_BASE_REF,
  });
  if (!isCodeBuildExecutionTarget(target)) {
    throw new Error('INVALID_CODE_BUILD_EXECUTION_TARGET');
  }
  return target;
}

export function readCodeBuildExecutionTarget(value: unknown): CodeBuildExecutionTarget | null {
  return isCodeBuildExecutionTarget(value) ? value : null;
}

export function isCodeBuildExecutionTarget(value: unknown): value is CodeBuildExecutionTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  return (
    target.version === CODE_BUILD_EXECUTION_TARGET_VERSION &&
    typeof target.organizationId === 'string' && target.organizationId.length > 0 &&
    typeof target.missionId === 'string' && target.missionId.length > 0 &&
    typeof target.workflowRunId === 'string' && target.workflowRunId.length > 0 &&
    typeof target.workflowStepRunId === 'string' && target.workflowStepRunId.length > 0 &&
    target.repository === CODE_BUILD_REPOSITORY &&
    typeof target.publicationBranch === 'string' && FEATURE_BRANCH.test(target.publicationBranch) &&
    target.baseRef === CODE_BUILD_BASE_REF &&
    typeof target.providerId === 'string' && target.providerId.length > 0 &&
    typeof target.providerCode === 'string' && PROVIDER_CODE.test(target.providerCode) &&
    (target.executionTier === ExecutionTier.LOCAL_ISOLATED ||
      target.executionTier === ExecutionTier.CLOUD_GOVERNED) &&
    typeof target.commandAlias === 'string' && COMMAND_ALIAS.test(target.commandAlias)
  );
}

export function codeBuildTargetMatchesApprovalScope(
  target: CodeBuildExecutionTarget,
  input: {
    readonly organizationId: string;
    readonly missionId: string;
    readonly repository: string;
    readonly branch: string;
  },
): boolean {
  return (
    target.organizationId === input.organizationId &&
    target.missionId === input.missionId &&
    target.repository === input.repository &&
    target.publicationBranch === input.branch
  );
}

export function codeBuildTargetMatchesContext(
  target: CodeBuildExecutionTarget,
  context: GovernedExecutionContext,
  expectedTier: ExecutionTier,
): boolean {
  return (
    context.capabilityCode === 'CODE_BUILD' &&
    target.organizationId === context.organizationId &&
    target.workflowRunId === context.workflowRunId &&
    target.workflowStepRunId === context.workflowStepRunId &&
    target.providerId === context.providerId &&
    target.providerCode === context.providerCode &&
    target.executionTier === expectedTier &&
    target.commandAlias === context.trustedExecutable?.commandName
  );
}
