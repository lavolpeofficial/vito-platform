import { toValidatedCloudExecutionProfile } from './execution-tier.js';

const base = {
  profileId: 'p',
  providerCode: 'cloud.openai.main',
  credentialRef: 'cloud:openai:staging',
  trustedLauncherAlias: 'opencode',
  expectedProviderId: 'openai',
  maxDurationMs: 600000,
  maxParallelism: 1,
  enabled: true,
};

describe('CloudExecutionProfile TEST launcher binding', () => {
  it('accepts and freezes an explicit testExecutionLauncherAlias', () => {
    const profile = toValidatedCloudExecutionProfile({ ...base, testExecutionLauncherAlias: 'opencode' });
    expect(profile?.testExecutionLauncherAlias).toBe('opencode');
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it.each(['', 'bad;alias', 'UPPER', 42])('rejects malformed testExecutionLauncherAlias %p', (value) => {
    expect(toValidatedCloudExecutionProfile({ ...base, testExecutionLauncherAlias: value })).toBeNull();
  });
});
