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
    const registry = new EnvRepositoryRegistry(undefined);
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

  it('CRITICAL: throws when config has VITO + attacker repository', () => {
    const config = [
      VALID_REPO,
      {
        repositoryId: 'attacker/malicious-repo',
        cloneUrl: 'https://github.com/attacker/malicious-repo.git',
        allowedBaseRefs: ['refs/heads/main'],
        enabled: true,
      },
    ];
    expect(() => new EnvRepositoryRegistry(JSON.stringify(config))).toThrow(
      /VITO-REW-001 v0.1 repository invariant/,
    );
    expect(() => new EnvRepositoryRegistry(JSON.stringify(config))).toThrow(
      /Found 2 repository entries/,
    );
  });

  it('CRITICAL: throws when config has attacker-only repository', () => {
    const config = [
      {
        repositoryId: 'attacker/evil',
        cloneUrl: 'https://github.com/attacker/evil.git',
        allowedBaseRefs: ['refs/heads/main'],
        enabled: true,
      },
    ];
    expect(() => new EnvRepositoryRegistry(JSON.stringify(config))).toThrow(
      /VITO-REW-001 v0.1 repository invariant/,
    );
    expect(() => new EnvRepositoryRegistry(JSON.stringify(config))).toThrow(
      /unauthorized repository 'attacker\/evil'/,
    );
  });

  it('CRITICAL: throws when config has 0 repositories', () => {
    expect(() => new EnvRepositoryRegistry('[]')).toThrow(
      /VITO-REW-001 v0.1 repository invariant/,
    );
  });
});
