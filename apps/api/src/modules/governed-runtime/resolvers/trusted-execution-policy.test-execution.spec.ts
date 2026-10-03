import {
  EngineeringCapability,
  ExecutionAction,
  ExecutionProfile,
  ProviderType,
  type CloudExecutionProfile,
} from '@vito/contracts';
import { CloudExecutionProfileRegistry } from '../../cloud-governed-execution/cloud-execution-profile.registry';
import { TrustedExecutionPolicyResolver } from './trusted-execution-policy.resolver';

const ROOT = '/var/lib/vito/workspaces';
const BASE_CONTEXT = {
  organizationId: 'org-1',
  workflowRunId: 'run-1',
  workflowStepRunId: 'step-1',
  capabilityCode: EngineeringCapability.TEST_EXECUTION,
  providerId: 'provider-1',
  executionProfile: ExecutionProfile.BUILDER,
  requestedAction: ExecutionAction.RUN_COMMAND,
};

const profile = (enabled = true): CloudExecutionProfile => ({
  profileId: 'test-openai',
  providerCode: 'cloud.openai.main',
  credentialRef: 'cloud:openai:staging',
  trustedLauncherAlias: 'opencode',
  testExecutionLauncherAlias: 'opencode',
  expectedProviderId: 'openai',
  allowedModelIds: ['gpt-5.6-sol'],
  maxDurationMs: 600000,
  maxParallelism: 1,
  enabled,
});

describe('TrustedExecutionPolicyResolver TEST_EXECUTION authority', () => {
  const providerResolver = { resolve: jest.fn() };
  const trustedExecutableResolver = { resolve: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    providerResolver.resolve.mockResolvedValue({
      providerType: ProviderType.CLOUD_LLM,
      providerCode: 'cloud.openai.main',
    });
    trustedExecutableResolver.resolve.mockResolvedValue({
      commandName: 'opencode',
      resolvedPath: '/opt/vito/trusted-launchers/opencode',
      integrityHash: 'a'.repeat(64),
      verifiedAt: new Date(),
    });
  });

  it('adds only the explicit server-owned TEST launcher after provider/profile/executable proof', async () => {
    const resolver = new TrustedExecutionPolicyResolver(
      ROOT,
      providerResolver as any,
      new CloudExecutionProfileRegistry([profile()]),
      trustedExecutableResolver as any,
    );
    const policy = await resolver.resolve(BASE_CONTEXT);
    expect(policy?.trustedCodingAgentAliases).toEqual(['opencode']);
    expect(trustedExecutableResolver.resolve).toHaveBeenCalledWith('opencode', expect.objectContaining({
      providerId: 'provider-1',
      capabilityCode: EngineeringCapability.TEST_EXECUTION,
    }));
  });

  it.each([
    ['disabled profile', ProviderType.CLOUD_LLM, false, true],
    ['local provider', ProviderType.LOCAL_TOOL, true, true],
    ['untrusted executable', ProviderType.CLOUD_LLM, true, false],
  ])('fails closed for %s', async (_name, providerType, enabled, trusted) => {
    providerResolver.resolve.mockResolvedValue({ providerType, providerCode: 'cloud.openai.main' });
    if (!trusted) trustedExecutableResolver.resolve.mockResolvedValue(null);
    const resolver = new TrustedExecutionPolicyResolver(
      ROOT,
      providerResolver as any,
      new CloudExecutionProfileRegistry([profile(enabled)]),
      trustedExecutableResolver as any,
    );
    const policy = await resolver.resolve(BASE_CONTEXT);
    expect(policy?.trustedCodingAgentAliases ?? []).toEqual([]);
  });

  it('does not grant TEST authority to another capability', async () => {
    const resolver = new TrustedExecutionPolicyResolver(
      ROOT,
      providerResolver as any,
      new CloudExecutionProfileRegistry([profile()]),
      trustedExecutableResolver as any,
    );
    const policy = await resolver.resolve({ ...BASE_CONTEXT, capabilityCode: EngineeringCapability.CODE_BUILD });
    expect(policy?.trustedCodingAgentAliases ?? []).toEqual([]);
  });
});
