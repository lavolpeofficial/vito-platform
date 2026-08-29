import { Injectable, Logger } from '@nestjs/common';
import {
  toValidatedCloudExecutionProfile,
  type CloudExecutionProfile,
} from '@vito/contracts';

/**
 * Server-owned immutable CloudExecutionProfile registry.
 *
 * Never constructible or overridable from operator/caller input. Configured
 * exclusively through the VITO_CLOUD_EXECUTION_PROFILES environment variable
 * (JSON array of profile entries). Missing, invalid or disabled profiles fail
 * closed (resolve -> null); a CLOUD_LLM provider without an enabled profile
 * can therefore never execute through the cloud boundary.
 */
@Injectable()
export class CloudExecutionProfileRegistry {
  private readonly logger = new Logger(CloudExecutionProfileRegistry.name);
  private readonly profilesByProviderCode: ReadonlyMap<string, CloudExecutionProfile>;

  constructor(profiles: readonly CloudExecutionProfile[]) {
    const byProvider = new Map<string, CloudExecutionProfile>();
    for (const profile of profiles) {
      const existing = byProvider.get(profile.providerCode);
      if (existing) {
        throw new CloudExecutionProfileRegistryError(
          `CLOUD_PROFILE_DUPLICATE_PROVIDER`,
          `Duplicate cloud execution profile for providerCode '${profile.providerCode}'`,
        );
      }
      byProvider.set(profile.providerCode, profile);
    }
    this.profilesByProviderCode = byProvider;

    for (const profile of profiles) {
      this.logger.log(
        `Cloud execution profile registered: ${profile.profileId} (providerCode=${profile.providerCode}, ` +
          `launcher=${profile.trustedLauncherAlias}, enabled=${String(profile.enabled)})`,
      );
    }
  }

  /**
   * Resolve the profile bound to a provider code.
   * Fail closed: unknown provider code, missing or disabled profile -> null.
   */
  resolve(providerCode: string): CloudExecutionProfile | null {
    const profile = this.profilesByProviderCode.get(providerCode) ?? null;
    if (!profile) {
      return null;
    }
    return profile.enabled ? profile : null;
  }

  /** Raw lookup used by tests/assembly to observe disabled profiles. */
  peek(providerCode: string): CloudExecutionProfile | null {
    return this.profilesByProviderCode.get(providerCode) ?? null;
  }

  all(): readonly CloudExecutionProfile[] {
    return [...this.profilesByProviderCode.values()];
  }
}

/**
 * Parse the server-owned profile configuration from environment.
 * Invalid entries are dropped deterministically; an invalid entry is a
 * server-config error and must NOT silently bind a provider to a boundary it
 * was not configured for.
 */
export function parseCloudExecutionProfilesFromEnv(
  raw: string | undefined,
): readonly CloudExecutionProfile[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CloudExecutionProfileRegistryError(
      'CLOUD_PROFILE_CONFIG_INVALID',
      'VITO_CLOUD_EXECUTION_PROFILES is not valid JSON — failing closed with no profiles',
    );
  }

  if (!Array.isArray(parsed)) {
    throw new CloudExecutionProfileRegistryError(
      'CLOUD_PROFILE_CONFIG_INVALID',
      'VITO_CLOUD_EXECUTION_PROFILES must be a JSON array of profile entries',
    );
  }

  const profiles: CloudExecutionProfile[] = [];
  for (const entry of parsed) {
    const validated = toValidatedCloudExecutionProfile(entry);
    if (validated) {
      profiles.push(validated);
    }
  }
  return profiles;
}

export class CloudExecutionProfileRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CloudExecutionProfileRegistryError';
  }
}