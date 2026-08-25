import { EnvRepositoryRegistry } from './repository-registry';

describe('EnvRepositoryRegistry', () => {
  const VITO_REPO = 'lavolpeofficial/vito-platform';

  function registry(config?: string) {
    return new EnvRepositoryRegistry(config);
  }

  function makeConfig(
    overrides: Partial<{
      repositoryId: string;
      cloneUrl: string;
      allowedBaseRefs: string[];
      enabled: boolean;
    }> = {},
  ) {
    return JSON.stringify([
      {
        repositoryId: VITO_REPO,
        cloneUrl: 'git@github.com:lavolpeofficial/vito-platform.git',
        allowedBaseRefs: ['main', 'develop'],
        enabled: true,
        ...overrides,
      },
    ]);
  }

  it('resolves exactly lavolpeofficial/vito-platform', () => {
    const reg = registry(makeConfig());
    const repo = reg.resolve(VITO_REPO);
    expect(repo).not.toBeNull();
    expect(repo?.repositoryId).toBe(VITO_REPO);
    expect(repo?.cloneUrl).toBe(
      'git@github.com:lavolpeofficial/vito-platform.git',
    );
  });

  it('returns null for unknown repositoryId', () => {
    const reg = registry(makeConfig());
    expect(reg.resolve('attacker/evil-repo')).toBeNull();
  });

  it('returns null for empty config', () => {
    const reg = registry(undefined);
    expect(reg.resolve(VITO_REPO)).toBeNull();
  });

  it('accepts registered base ref', () => {
    const reg = registry(makeConfig());
    expect(reg.isBaseRefAllowed(VITO_REPO, 'main')).toBe(true);
    expect(reg.isBaseRefAllowed(VITO_REPO, 'develop')).toBe(true);
  });

  it('rejects unregistered base ref', () => {
    const reg = registry(makeConfig());
    expect(reg.isBaseRefAllowed(VITO_REPO, 'attacker-branch')).toBe(false);
  });

  it('returns false for base ref on unknown repo', () => {
    const reg = registry(makeConfig());
    expect(reg.isBaseRefAllowed('unknown', 'main')).toBe(false);
  });

  it('rejects disabled repository', () => {
    const reg = registry(makeConfig({ enabled: false }));
    expect(reg.resolve(VITO_REPO)).toBeNull();
  });

  it('throws on invalid JSON', () => {
    expect(() => registry('not-json')).toThrow('VITO_REPOSITORY_REGISTRY must be valid JSON');
  });

  it('throws on non-array config', () => {
    expect(() => registry('{"key":"value"}')).toThrow(
      'VITO_REPOSITORY_REGISTRY must be a JSON array',
    );
  });

  it('throws on missing repositoryId', () => {
    expect(() =>
      registry(
        JSON.stringify([
          { cloneUrl: 'x', allowedBaseRefs: ['main'] },
        ]),
      ),
    ).toThrow('repositoryId is required');
  });

  it('throws on empty allowedBaseRefs', () => {
    expect(() =>
      registry(
        JSON.stringify([
          { repositoryId: 'r', cloneUrl: 'x', allowedBaseRefs: [] },
        ]),
      ),
    ).toThrow('allowedBaseRefs must be a non-empty string array');
  });

  it('fails closed on wildcard base ref for org repos', () => {
    const reg = registry(
      JSON.stringify([
        {
          repositoryId: VITO_REPO,
          cloneUrl: 'git@github.com:lavolpeofficial/vito-platform.git',
          allowedBaseRefs: ['main'],
        },
      ]),
    );
    expect(reg.isBaseRefAllowed(VITO_REPO, '*')).toBe(false);
    expect(reg.isBaseRefAllowed(VITO_REPO, 'refs/heads/main')).toBe(false);
  });

  it('does not authorize a different organization repository', () => {
    const reg = registry(makeConfig());
    expect(reg.resolve('lavolpeofficial/other-repo')).toBeNull();
    expect(reg.resolve('other-org/vito-platform')).toBeNull();
  });
});
