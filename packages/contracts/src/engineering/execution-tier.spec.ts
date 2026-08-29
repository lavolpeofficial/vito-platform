/**
 * Unit Tests für die Execution-Tier / CloudExecutionProfile-Contracts (OB-002D).
 *
 * Invarianten:
 *  - Der Tier ist NIE ein Caller-Feld; er wird server-seitig aus ProviderType
 *    + server-eigenem CloudExecutionProfile abgeleitet.
 *  - resolveExecutionTier failt geschlossen (null) bei jeder uneindeutigen
 *    oder fehlkonfigurierten Kombination — kein stilles Downgrade.
 *  - toValidatedCloudExecutionProfile liefert bei JEDEM ungültigen Feld null.
 */

import { ProviderType } from './provider-registry.js';
import {
  ExecutionTier,
  resolveExecutionTier,
  toValidatedCloudExecutionProfile,
  isCloudGovernedProviderType,
  type CloudExecutionProfile,
} from './execution-tier.js';

function makeProfile(overrides: Partial<CloudExecutionProfile> = {}): CloudExecutionProfile {
  return Object.freeze({
    profileId: 'flight-001',
    providerCode: 'openai',
    credentialRef: 'cloud:openai:flight-001',
    trustedLauncherAlias: 'opencode',
    maxDurationMs: 600_000,
    maxParallelism: 1,
    enabled: true,
    ...overrides,
  });
}

describe('resolveExecutionTier (OB-002D)', () => {
  it('maps LOCAL_TOOL without a cloud profile to LOCAL_ISOLATED', () => {
    expect(resolveExecutionTier(ProviderType.LOCAL_TOOL, null)).toBe(
      ExecutionTier.LOCAL_ISOLATED,
    );
  });

  it('denies a cloud profile bound to a LOCAL_TOOL provider (server config error)', () => {
    const profile = makeProfile();
    expect(resolveExecutionTier(ProviderType.LOCAL_TOOL, profile)).toBeNull();
  });

  it('maps CLOUD_LLM with an enabled profile to CLOUD_GOVERNED', () => {
    expect(resolveExecutionTier(ProviderType.CLOUD_LLM, makeProfile())).toBe(
      ExecutionTier.CLOUD_GOVERNED,
    );
  });

  it('denies CLOUD_LLM without a profile (fail closed)', () => {
    expect(resolveExecutionTier(ProviderType.CLOUD_LLM, null)).toBeNull();
  });

  it('denies CLOUD_LLM with a disabled profile (fail closed)', () => {
    expect(resolveExecutionTier(ProviderType.CLOUD_LLM, makeProfile({ enabled: false }))).toBeNull();
  });

  it('denies all other provider types', () => {
    for (const type of [ProviderType.DETERMINISTIC_TOOL]) {
      expect(resolveExecutionTier(type, null)).toBeNull();
      expect(resolveExecutionTier(type, makeProfile())).toBeNull();
    }
  });
});

describe('isCloudGovernedProviderType', () => {
  it('classifies CLOUD_LLM as cloud-governed', () => {
    expect(isCloudGovernedProviderType(ProviderType.CLOUD_LLM)).toBe(true);
  });

  it('does not classify any other provider type', () => {
    expect(isCloudGovernedProviderType(ProviderType.LOCAL_TOOL)).toBe(false);
    expect(isCloudGovernedProviderType(ProviderType.LOCAL_LLM)).toBe(false);
    expect(isCloudGovernedProviderType(ProviderType.DETERMINISTIC_TOOL)).toBe(false);
  });
});

describe('toValidatedCloudExecutionProfile', () => {
  it('accepts a complete valid raw profile and freezes it', () => {
    const profile = toValidatedCloudExecutionProfile({
      profileId: 'flight-001',
      providerCode: 'openai',
      credentialRef: 'cloud:openai:flight-001',
      trustedLauncherAlias: 'opencode',
      maxDurationMs: 600_000,
      maxParallelism: 1,
      enabled: true,
    });
    expect(profile).toEqual(makeProfile());
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it('rejects missing, empty or malformed profileId', () => {
    const base = {
      providerCode: 'openai',
      credentialRef: 'cloud:openai:flight-001',
      trustedLauncherAlias: 'opencode',
      maxDurationMs: 600_000,
      maxParallelism: 1,
      enabled: true,
    };
    expect(toValidatedCloudExecutionProfile({ ...base, profileId: undefined })).toBeNull();
    expect(toValidatedCloudExecutionProfile({ ...base, profileId: '' })).toBeNull();
    expect(toValidatedCloudExecutionProfile({ ...base, profileId: 'bad profile id' })).toBeNull();
  });

  it('rejects a credentialRef that is not opaque-alphanumeric', () => {
    expect(
      toValidatedCloudExecutionProfile({
        profileId: 'p',
        providerCode: 'openai',
        credentialRef: 'with spaces',
        trustedLauncherAlias: 'opencode',
        maxDurationMs: 600_000,
        maxParallelism: 1,
        enabled: true,
      }),
    ).toBeNull();
  });

  it('rejects a trustedLauncherAlias that does not match the alias pattern', () => {
    expect(
      toValidatedCloudExecutionProfile({
        profileId: 'p',
        providerCode: 'openai',
        credentialRef: 'ref',
        trustedLauncherAlias: 'dangerous;rm',
        maxDurationMs: 600_000,
        maxParallelism: 1,
        enabled: true,
      }),
    ).toBeNull();
  });

  it('rejects non-integer, too-small or too-large durations', () => {
    const base = {
      profileId: 'p',
      providerCode: 'openai',
      credentialRef: 'ref',
      trustedLauncherAlias: 'opencode',
      maxParallelism: 1,
      enabled: true,
    };
    expect(toValidatedCloudExecutionProfile({ ...base, maxDurationMs: 999 })).toBeNull();
    expect(toValidatedCloudExecutionProfile({ ...base, maxDurationMs: 86_400_001 })).toBeNull();
    expect(toValidatedCloudExecutionProfile({ ...base, maxDurationMs: -1 })).toBeNull();
    expect(toValidatedCloudExecutionProfile({ ...base, maxDurationMs: 599.5 })).toBeNull();
  });

  it('rejects parallelism outside 1..3', () => {
    const base = {
      profileId: 'p',
      providerCode: 'openai',
      credentialRef: 'ref',
      trustedLauncherAlias: 'opencode',
      maxDurationMs: 600_000,
      enabled: true,
    };
    expect(toValidatedCloudExecutionProfile({ ...base, maxParallelism: 0 })).toBeNull();
    expect(toValidatedCloudExecutionProfile({ ...base, maxParallelism: 4 })).toBeNull();
  });

  it('rejects non-boolean enabled', () => {
    const base = {
      profileId: 'p',
      providerCode: 'openai',
      credentialRef: 'ref',
      trustedLauncherAlias: 'opencode',
      maxDurationMs: 600_000,
      maxParallelism: 1,
    };
    expect(toValidatedCloudExecutionProfile({ ...base, enabled: 'true' })).toBeNull();
  });

  it('rejects non-object and array input', () => {
    expect(toValidatedCloudExecutionProfile(null)).toBeNull();
    expect(toValidatedCloudExecutionProfile('openai')).toBeNull();
    expect(toValidatedCloudExecutionProfile([{}])).toBeNull();
  });
});