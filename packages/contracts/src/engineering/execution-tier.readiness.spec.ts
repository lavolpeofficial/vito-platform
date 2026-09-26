import { toValidatedCloudExecutionProfile } from './execution-tier.js';

const base = {
  profileId: 'probe-test', providerCode: 'cloud.openai.main', credentialRef: 'cloud:openai:staging',
  trustedLauncherAlias: 'opencode', expectedProviderId: 'openai', allowedModelIds: ['gpt-6-astra'],
  maxDurationMs: 600000, maxParallelism: 1, enabled: true,
};

describe('CloudExecutionProfile readiness probe boundary', () => {
  it('accepts an exact bounded readiness probe launcher alias', () => {
    expect(toValidatedCloudExecutionProfile({ ...base, readinessProbeLauncherAlias: 'opencode-openai-probe' })?.readinessProbeLauncherAlias)
      .toBe('opencode-openai-probe');
  });
  it('rejects shell-like readiness probe aliases', () => {
    expect(toValidatedCloudExecutionProfile({ ...base, readinessProbeLauncherAlias: 'probe;rm' })).toBeNull();
  });
});
