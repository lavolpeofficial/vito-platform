import {
  parseServerCredentialsFromEnv,
  ServerCredentialResolver,
  ServerCredentialResolverError,
} from './server-credential.resolver';

describe('ServerCredentialResolver', () => {
  it('resolves only exact opaque references', () => {
    const resolver = new ServerCredentialResolver(new Map([['github.world.actions', 'secret-token']]));
    expect(resolver.resolve('github.world.actions')).toBe('secret-token');
    expect(resolver.resolve('github.world')).toBeNull();
    expect(resolver.resolve('../github.world.actions')).toBeNull();
  });

  it('parses valid server credentials and drops invalid entries', () => {
    const parsed = parseServerCredentialsFromEnv(JSON.stringify({
      'github.world.actions': 'token',
      '../invalid': 'ignored',
      empty: '',
      numeric: 123,
    }));
    expect(parsed.get('github.world.actions')).toBe('token');
    expect(parsed.size).toBe(1);
  });

  it('fails closed for malformed server credential configuration', () => {
    expect(() => parseServerCredentialsFromEnv('{not-json')).toThrow(ServerCredentialResolverError);
    expect(() => parseServerCredentialsFromEnv('[]')).toThrow('VITO_SERVER_CREDENTIALS must be a JSON object');
  });
});
