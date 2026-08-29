import { ProviderType } from './provider-registry.js';

/**
 * Execution tiers the governed runtime can bind a provider to (OB-002D).
 *
 * The tier is NEVER a caller/request field. It is derived server-side from
 * the immutable ProviderDeclaration and the server-owned CloudExecutionProfile
 * registry. Callers can only select a capability; the tier is a consequence of
 * which provider the server routes to and which profile the server binds.
 */
export enum ExecutionTier {
  /** Bubblewrap-isolated local agent execution (no network). */
  LOCAL_ISOLATED = 'LOCAL_ISOLATED',
  /**
   * Server-governed cloud agent execution through a dedicated, ephemeral
   * execution boundary. The operator process does NOT gain the agent's
   * network or credential authority; all cloud execution state is torn down
   * on every terminal path.
   */
  CLOUD_GOVERNED = 'CLOUD_GOVERNED',
}

/**
 * Server-owned, immutable profile binding a provider code to CLOUD_GOVERNED
 * execution.
 *
 * NEVER constructible or overridable from operator/caller input. Configured
 * exclusively through server environment/config. Missing/disabled profiles
 * fail closed (resolveExecutionTier returns null).
 */
export interface CloudExecutionProfile {
  readonly profileId: string;
  readonly providerCode: string;
  /** Opaque reference into the server-owned credential store. Never a value. */
  readonly credentialRef: string;
  /**
   * The exact trusted-agent launcher alias this profile may authorize.
   * Must resolve through TrustedExecutableResolver; mismatch fails closed.
   */
  readonly trustedLauncherAlias: string;
  /**
   * Server-authorized provider identity that the CLOUD_GOVERNED boundary MUST
   * observe on the coding agent execution path (OB002D-MEDIUM-PROVIDER-IDENTITY).
   * Missing, ambiguous or mismatched observed identity fails closed. This value
   * is server-owned and can never be overridden by caller/operator input.
   */
  readonly expectedProviderId: string;
  /**
   * Optional exact server-authorized model allow-list. When present, an
   * observed model identity outside this list fails closed.
   */
  readonly allowedModelIds?: readonly string[];
  readonly maxDurationMs: number;
  /** Reserved hard cap; v0.2D executes at most one concurrent session. */
  readonly maxParallelism: number;
  readonly enabled: boolean;
}

/**
 * Providers whose cloud-side capability is executed through the governed
 * cloud boundary. Single authoritative classification — reused by the policy
 * alias augmentation, dispatch gate and adapters so no code path keeps its
 * own copy of the provider list.
 */
export function isCloudGovernedProviderType(providerType: ProviderType): boolean {
  return providerType === ProviderType.CLOUD_LLM;
}

/**
 * Deterministic tier derivation.
 *
 * Fail closed: any ambiguous or misconfigured combination returns null
 * (no execution tier), never a silent downgrade:
 *  - LOCAL_TOOL   → LOCAL_ISOLATED, but ONLY with no cloud profile bound
 *    (a cloud profile on a local-tool provider is a server config error and
 *    must deny, not misclassify).
 *  - CLOUD_LLM    → CLOUD_GOVERNED, but ONLY with an enabled server-owned
 *    profile. No profile / disabled profile → null → denied.
 *  - anything else → null → denied.
 */
export function resolveExecutionTier(
  providerType: ProviderType,
  cloudProfile: CloudExecutionProfile | null,
): ExecutionTier | null {
  if (providerType === ProviderType.LOCAL_TOOL) {
    return cloudProfile === null ? ExecutionTier.LOCAL_ISOLATED : null;
  }
  if (isCloudGovernedProviderType(providerType)) {
    return cloudProfile !== null && cloudProfile.enabled
      ? ExecutionTier.CLOUD_GOVERNED
      : null;
  }
  return null;
}

const PROFILE_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const PROVIDER_CODE_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const CREDENTIAL_REF_PATTERN = /^[a-zA-Z0-9._:-]{1,256}$/;
const LAUNCHER_ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;
const MODEL_ID_PATTERN = /^[a-zA-Z0-9._:\/-]{1,128}$/;
const MAX_ALLOWED_MODEL_IDS = 64;

export const CLOUD_EXECUTION_PROFILE_MIN_DURATION_MS = 1_000;
export const CLOUD_EXECUTION_PROFILE_MAX_DURATION_MS = 86_400_000;
export const CLOUD_EXECUTION_PROFILE_MAX_PARALLELISM = 3;

/**
 * Parse + validate a raw (env/config) cloud-execution-profile entry.
 * Returns null on ANY invalid field (fail closed). Frozen output.
 */
export function toValidatedCloudExecutionProfile(
  raw: unknown,
): CloudExecutionProfile | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;

  const profileId = value.profileId;
  if (typeof profileId !== 'string' || !PROFILE_ID_PATTERN.test(profileId)) {
    return null;
  }

  const providerCode = value.providerCode;
  if (typeof providerCode !== 'string' || !PROVIDER_CODE_PATTERN.test(providerCode)) {
    return null;
  }

  const credentialRef = value.credentialRef;
  if (typeof credentialRef !== 'string' || !CREDENTIAL_REF_PATTERN.test(credentialRef)) {
    return null;
  }

  const trustedLauncherAlias = value.trustedLauncherAlias;
  if (
    typeof trustedLauncherAlias !== 'string' ||
    !LAUNCHER_ALIAS_PATTERN.test(trustedLauncherAlias)
  ) {
    return null;
  }

  const expectedProviderId = value.expectedProviderId;
  if (
    typeof expectedProviderId !== 'string' ||
    !PROVIDER_ID_PATTERN.test(expectedProviderId)
  ) {
    return null;
  }

  let allowedModelIds: readonly string[] | undefined;
  if (value.allowedModelIds !== undefined) {
    if (
      !Array.isArray(value.allowedModelIds) ||
      value.allowedModelIds.length === 0 ||
      value.allowedModelIds.length > MAX_ALLOWED_MODEL_IDS
    ) {
      return null;
    }
    const normalized: string[] = [];
    for (const entry of value.allowedModelIds) {
      if (typeof entry !== 'string' || !MODEL_ID_PATTERN.test(entry)) {
        return null;
      }
      normalized.push(entry);
    }
    if (new Set(normalized).size !== normalized.length) {
      return null;
    }
    allowedModelIds = Object.freeze(normalized);
  }
  if (allowedModelIds !== undefined && allowedModelIds.length === 0) {
    return null;
  }

  const maxDurationMs = value.maxDurationMs;
  if (
    typeof maxDurationMs !== 'number' ||
    !Number.isInteger(maxDurationMs) ||
    maxDurationMs < CLOUD_EXECUTION_PROFILE_MIN_DURATION_MS ||
    maxDurationMs > CLOUD_EXECUTION_PROFILE_MAX_DURATION_MS
  ) {
    return null;
  }

  const maxParallelism = value.maxParallelism;
  if (
    typeof maxParallelism !== 'number' ||
    !Number.isInteger(maxParallelism) ||
    maxParallelism < 1 ||
    maxParallelism > CLOUD_EXECUTION_PROFILE_MAX_PARALLELISM
  ) {
    return null;
  }

  const enabled = value.enabled;
  if (typeof enabled !== 'boolean') {
    return null;
  }

  return Object.freeze({
    profileId,
    providerCode,
    credentialRef,
    trustedLauncherAlias,
    expectedProviderId,
    ...(allowedModelIds !== undefined ? { allowedModelIds } : {}),
    maxDurationMs,
    maxParallelism,
    enabled,
  });
}