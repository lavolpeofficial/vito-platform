import { ProviderType } from '@vito/contracts';
import type { CloudExecutionProfile, ProviderDeclaration } from '@vito/contracts';
import {
  CloudExecutionProfileRegistry,
  CloudExecutionProfileRegistryError,
  parseCloudExecutionProfilesFromEnv,
} from './cloud-execution-profile.registry';
import {
  CloudCredentialBroker,
  CloudCredentialResolver,
  parseCloudCredentialsFromEnv,
} from './cloud-credential.resolver';
import type { ProviderResolver } from '../governed-invocation/governed-invocation.service';

const PROVIDER_CODE = 'cloud.openai.main';
const CREDENTIAL_REF = 'cloud:main';

function makeProfile(overrides: Partial<CloudExecutionProfile> = {}): CloudExecutionProfile {
  return {
    profileId: 'profile-001',
    providerCode: PROVIDER_CODE,
    credentialRef: CREDENTIAL_REF,
    trustedLauncherAlias: 'worker-agent',
    maxDurationMs: 60_000,
    maxParallelism: 1,
    enabled: true,
    ...overrides,
  };
}

describe('CloudExecutionProfileRegistry (fail-closed binding)', () => {
  it('resolves an enabled profile for a known provider code', () => {
    const registry = new CloudExecutionProfileRegistry([makeProfile()]);
    expect(registry.resolve(PROVIDER_CODE)?.profileId).toBe('profile-001');
    expect(registry.all()).toHaveLength(1);
  });

  it('returns null for an unknown provider code (never executes)', () => {
    const registry = new CloudExecutionProfileRegistry([makeProfile()]);
    expect(registry.resolve('cloud.unbound')).toBeNull();
  });

  it('returns null for a DISABLED profile while peek still exposes it', () => {
    const registry = new CloudExecutionProfileRegistry([makeProfile({ enabled: false })]);
    expect(registry.resolve(PROVIDER_CODE)).toBeNull();
    expect(registry.peek(PROVIDER_CODE)?.enabled).toBe(false);
  });

  it('throws on a duplicate profile for the same provider code (config error)', () => {
    expect(
      () =>
        new CloudExecutionProfileRegistry([
          makeProfile(),
          makeProfile({ profileId: 'profile-002' }),
        ]),
    ).toThrow(/Duplicate cloud execution profile/);
  });

  describe('parseCloudExecutionProfilesFromEnv', () => {
    it('returns [] when the env var is absent', () => {
      expect(parseCloudExecutionProfilesFromEnv(undefined)).toEqual([]);
    });

    it('parses a valid JSON array of profile entries', () => {
      const raw = JSON.stringify([
        {
          profileId: 'profile-001',
          providerCode: PROVIDER_CODE,
          credentialRef: CREDENTIAL_REF,
          trustedLauncherAlias: 'worker-agent',
          maxDurationMs: 60_000,
          maxParallelism: 1,
          enabled: true,
        },
      ]);
      const profiles = parseCloudExecutionProfilesFromEnv(raw);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].providerCode).toBe(PROVIDER_CODE);
    });

    it('fails closed on invalid JSON (never a partial/empty silent binding)', () => {
      expect(() => parseCloudExecutionProfilesFromEnv('{ not json')).toThrow(
        /VITO_CLOUD_EXECUTION_PROFILES is not valid JSON/,
      );
    });

    it('fails closed on a non-array payload', () => {
      expect(() => parseCloudExecutionProfilesFromEnv('{"profileId":"x"}')).toThrow(
        /must be a JSON array/,
      );
    });

    it('drops malformed entries so no provider binds to an invalid boundary', () => {
      const raw = JSON.stringify([
        { profileId: 'ok', providerCode: 'cloud.ok', credentialRef: 'c:1', trustedLauncherAlias: 'a', maxDurationMs: 1000, maxParallelism: 1, enabled: true },
        { profileId: 'bad-enabled', providerCode: 'cloud.bad', credentialRef: 'c:2', trustedLauncherAlias: 'a', maxDurationMs: 500, maxParallelism: 1, enabled: true },
        'not-an-object',
      ]);
      const profiles = parseCloudExecutionProfilesFromEnv(raw);
      expect(profiles.map((p) => p.providerCode)).toEqual(['cloud.ok']);
    });
  });

  it('the registry cannot be widened to enabled from a disabled profile via env', () => {
    const raw = JSON.stringify([makeProfile({ enabled: false })]);
    const registry = new CloudExecutionProfileRegistry(parseCloudExecutionProfilesFromEnv(raw));
    expect(registry.resolve(PROVIDER_CODE)).toBeNull();
  });
});

describe('CloudCredentialResolver (server-owned secret store)', () => {
  it('resolves a known reference to its payload', () => {
    const resolver = new CloudCredentialResolver(new Map([[CREDENTIAL_REF, '{"x":1}']]));
    expect(resolver.resolve(CREDENTIAL_REF)).toBe('{"x":1}');
    expect(resolver.has(CREDENTIAL_REF)).toBe(true);
  });

  it('fails closed on an unknown reference', () => {
    const resolver = new CloudCredentialResolver(new Map([[CREDENTIAL_REF, '{"x":1}']]));
    expect(resolver.resolve('cloud:unknown')).toBeNull();
    expect(resolver.resolve('cloud not a valid ref!')).toBeNull();
    expect(resolver.has('cloud:unknown')).toBe(false);
  });

  describe('parseCloudCredentialsFromEnv', () => {
    it('returns an empty map when the env var is absent', () => {
      expect(parseCloudCredentialsFromEnv(undefined).size).toBe(0);
    });

    it('fails closed on invalid JSON', () => {
      expect(() => parseCloudCredentialsFromEnv('nope')).toThrow(
        /VITO_CLOUD_AGENT_CREDENTIALS is not valid JSON/,
      );
    });

    it('fails closed on a non-object payload', () => {
      expect(() => parseCloudCredentialsFromEnv('["a"]')).toThrow(/must be a JSON object/);
    });

    it('drops malformed keys and oversized values (fail closed)', () => {
      const raw = JSON.stringify({
        [CREDENTIAL_REF]: 'valid',
        'bad ref!': 'x',
        'cloud:big': 'b'.repeat(1024 * 1024 + 1),
      });
      const map = parseCloudCredentialsFromEnv(raw);
      expect(map.get(CREDENTIAL_REF)).toBe('valid');
      expect(map.has('bad ref!')).toBe(false);
      expect(map.has('cloud:big')).toBe(false);
    });
  });
});

describe('CloudCredentialBroker (authorization-bound ref resolution)', () => {
  function makeProviderResolver(provider: ProviderDeclaration | null): ProviderResolver {
    return { resolve: jest.fn().mockResolvedValue(provider) };
  }

  function makeBroker(provider: ProviderDeclaration | null, profiles: CloudExecutionProfile[], credentials: ReadonlyMap<string, string>) {
    const profileRegistry = new CloudExecutionProfileRegistry(profiles);
    const credentialResolver = new CloudCredentialResolver(credentials);
    return {
      broker: new CloudCredentialBroker(makeProviderResolver(provider), profileRegistry, credentialResolver),
    };
  }

  const cloudProvider: ProviderDeclaration = {
    providerId: 'p-1',
    providerType: ProviderType.CLOUD_LLM,
    providerCode: PROVIDER_CODE,
    name: 'openai main',
    version: '1',
  } as unknown as ProviderDeclaration;

  it('resolves the opaque reference for an enabled CLOUD_LLM provider with a secret bound', async () => {
    const { broker } = makeBroker(cloudProvider, [makeProfile()], new Map([[CREDENTIAL_REF, '{}']]));
    await expect(broker.getCredentialReference('p-1', 'org-1')).resolves.toBe(CREDENTIAL_REF);
  });

  it('returns null for a non-cloud (local) provider — no cloud authority leaks', async () => {
    const localProvider: ProviderDeclaration = {
      providerId: 'p-2',
      providerType: ProviderType.LOCAL_TOOL,
      providerCode: 'local',
      name: 'local',
      version: '1',
    } as unknown as ProviderDeclaration;
    const { broker } = makeBroker(localProvider, [makeProfile()], new Map([[CREDENTIAL_REF, '{}']]));
    await expect(broker.getCredentialReference('p-2', 'org-1')).resolves.toBeNull();
  });

  it('returns null when the provider resolves to nothing', async () => {
    const { broker } = makeBroker(null, [makeProfile()], new Map([[CREDENTIAL_REF, '{}']]));
    await expect(broker.getCredentialReference('p-missing', 'org-1')).resolves.toBeNull();
  });

  it('returns null when the profile is disabled (never injects)', async () => {
    const { broker } = makeBroker(cloudProvider, [makeProfile({ enabled: false })], new Map([[CREDENTIAL_REF, '{}']]));
    await expect(broker.getCredentialReference('p-1', 'org-1')).resolves.toBeNull();
  });

  it('returns null when the credential store cannot satisfy the profile credentialRef', async () => {
    const { broker } = makeBroker(cloudProvider, [makeProfile()], new Map());
    await expect(broker.getCredentialReference('p-1', 'org-1')).resolves.toBeNull();
  });

  it('validates a credential reference strictly (opaque ref exists)', async () => {
    const { broker } = makeBroker(cloudProvider, [makeProfile()], new Map([[CREDENTIAL_REF, '{}']]));
    await expect(broker.validateCredentialReference(CREDENTIAL_REF)).resolves.toBe(true);
    await expect(broker.validateCredentialReference('cloud:nope')).resolves.toBe(false);
  });

  it('never exposes the credential VALUE from the broker', async () => {
    const secret = 'SECRET_AUTH_VALUE_xyz';
    const { broker } = makeBroker(cloudProvider, [makeProfile()], new Map([[CREDENTIAL_REF, secret]]));
    const ref = await broker.getCredentialReference('p-1', 'org-1');
    expect(ref).toBe(CREDENTIAL_REF);
    expect(JSON.stringify({ ref })).not.toContain(secret);
  });
});