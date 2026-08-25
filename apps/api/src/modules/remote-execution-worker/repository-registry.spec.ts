import { EnvRepositoryRegistry } from './repository-registry';

const VALID_REPO = {
  repositoryId: 'lavolpeofficial/vito-platform',
  cloneUrl: 'https://github.com/lavolpeofficial/vito-platform.git',
  allowedBaseRefs: ['refs/heads/develop'],
  enabled: true,
};

describe('EnvRepositoryRegistry', () => {
  it('resolves exactly lavolpeofficial/vito-platform', () => {
    const registry = new EnvRepositoryRegistry(JSON.stringify([VALID_REPO]));
    const repo = registry.resolve('lavolpeofficial/vito-platform');
    expect(repo).not.toBeNull();
    expect(repo?.repositoryId).toBe('lavolpeofficial/vito-platform');
  });

  it('returns null for unknown repositoryId', () => {
    const registry = new EnvRepositoryRegistry(JSON.stringify([VALID_REPO]));
    expect(registry.resolve('unknown/repo')).toBeNull();
  });

  it('returns null for empty config', () => {
    const registry = new EnvRepositoryRegistry('[]');
    expect(registry.resolve('lavolpeofficial/vito-platform')).toBeNull();
  });

  it('accepts registered base ref', () => {
    const registry = new EnvRepositoryRegistry(JSON.stringify([VALID_REPO]));
    expect(
      registry.isBaseRefAllowed('lavolpeofficial/vito-platform', 'refs/heads/develop'),
    ).toBe(true);
  });

  it('rejects unregistered base ref (exact names only)', () => {
    const registry = new EnvRepositoryRegistry(JSON.stringify([VALID_REPO]));
    expect(
      registry.isBaseRefAllowed('lavolpeofficial/vito-platform', 'refs/heads/main'),
    ).toBe(false);
  });

  it('returns false for base ref on unknown repo', () => {
    const registry = new EnvRepositoryRegistry(JSON.stringify([VALID_REPO]));
    expect(registry.isBaseRefAllowed('unknown/repo', 'refs/heads/develop')).toBe(false);
  });

  it('rejects disabled repository', () => {
    const disabledRepo = { ...VALID_REPO, enabled: false };
    const registry = new EnvRepositoryRegistry(JSON.stringify([disabledRepo]));
    expect(registry.resolve('lavolpeofficial/vito-platform')).toBeNull();
  });

  it('throws on invalid JSON', () => {
    expect(() => new EnvRepositoryRegistry('not-json')).toThrow(
      'VITO_REPOSITORY_REGISTRY must be valid JSON',
    );
  });

  it('throws on non-array config', () => {
    expect(() => new EnvRepositoryRegistry(JSON.stringify({ foo: 'bar' }))).toThrow(
      'VITO_REPOSITORY_REGISTRY must be a JSON array',
    );
  });

  it('throws on missing repositoryId', () => {
    const config = [
      {
        cloneUrl: 'https://github.com/example/repo.git',
        allowedBaseRefs: ['refs/heads/develop'],
        enabled: true,
      },
    ];
    expect(() => new EnvRepositoryRegistry(JSON.stringify(config))).toThrow(
      'repositoryId is required',
    );
  });

  it('throws on empty allowedBaseRefs', () => {
    const config = [
      {
        repositoryId: 'lavolpeofficial/vito-platform',
        cloneUrl: 'https://github.com/lavolpeofficial/vito-platform.git',
        allowedBaseRefs: [],
        enabled: true,
      },
    ];
    expect(() => new EnvRepositoryRegistry(JSON.stringify(config))).toThrow(
      'allowedBaseRefs must be a non-empty string array',
    );
  });

  it('fails closed on wildcard base ref for org repos', () => {
    const config = [
      {
        repositoryId: 'lavolpeofficial/vito-platform',
        cloneUrl: 'https://github.com/lavolpeofficial/vito-platform.git',
        allowedBaseRefs: ['*'],
        enabled: true,
      },
    ];
    const registry = new EnvRepositoryRegistry(JSON.stringify(config));
    expect(
      registry.isBaseRefAllowed('lavolpeofficial/vito-platform', 'refs/heads/main'),
    ).toBe(false);
    expect(
      registry.isBaseRefAllowed('lavolpeofficial/vito-platform', 'refs/heads/develop'),
    ).toBe(false);
  });

  it('does NOT authorize a different organization repository', () => {
    const registry = new EnvRepositoryRegistry(JSON.stringify([VALID_REPO]));
    expect(registry.resolve('other-org/vito-platform')).toBeNull();
  });

  it('v0.1 does NOT accept arbitrary additional repos', () => {
    const registry = new EnvRepositoryRegistry(JSON.stringify([VALID_REPO]));
    expect(registry.resolve('arbitrary/org')).toBeNull();
    expect(registry.resolve('lavolpeofficial/other')).toBeNull();
  });
});
