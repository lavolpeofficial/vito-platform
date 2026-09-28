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
  capabilityCode: EngineeringCapability.REVIEW_PACKAGE,
  providerId: 'provider-1',
  executionProfile: ExecutionProfile.REVIEWER,
  requestedAction: ExecutionAction.RUN_COMMAND,
};

const profile = (enabled = true): CloudExecutionProfile => ({
  profileId: 'review-openai',
  providerCode: 'cloud.openai.main',
  credentialRef: 'cloud:openai:staging',
  trustedLauncherAlias: 'opencode',
  testExecutionLauncherAlias: 'opencode',
  expectedProviderId: 'openai',
  allowedModelIds: ['gpt-6-astra'],
  maxDurationMs: 600000,
  maxParallelism: 1,
  enabled,
});

describe('TrustedExecutionPolicyResolver REVIEW_PACKAGE authority', () => {
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

  it('adds only the server-owned REVIEW_PACKAGE launcher after all proofs agree', async () => {
    const resolver = new TrustedExecutionPolicyResolver(
      ROOT,
      providerResolver as any,
      new CloudExecutionProfileRegistry([profile()]),
      trustedExecutableResolver as any,
    );
    const policy = await resolver.resolve(BASE_CONTEXT);
    expect(policy?.trustedReviewerAgentAliases).toEqual(['opencode']);
    expect(policy?.trustedCodingAgentAliases ?? []).toEqual([]);
    expect(trustedExecutableResolver.resolve).toHaveBeenCalledWith(
      'opencode',
      expect.objectContaining({
        providerId: 'provider-1',
        capabilityCode: EngineeringCapability.REVIEW_PACKAGE,
      }),
    );
  });

  it('adds the server-owned RED_TEAM launcher after all proofs agree', async () => {
    const resolver = new TrustedExecutionPolicyResolver(
      ROOT,
      providerResolver as any,
      new CloudExecutionProfileRegistry([profile()]),
      trustedExecutableResolver as any,
    );
    const policy = await resolver.resolve({
      ...BASE_CONTEXT,
      capabilityCode: EngineeringCapability.RED_TEAM,
    });
    expect(policy?.trustedReviewerAgentAliases).toEqual(['opencode']);
    expect(policy?.trustedCodingAgentAliases ?? []).toEqual([]);
    expect(trustedExecutableResolver.resolve).toHaveBeenCalledWith(
      'opencode',
      expect.objectContaining({
        providerId: 'provider-1',
        capabilityCode: EngineeringCapability.RED_TEAM,
      }),
    );
  });

  it.each([
    ['disabled profile', ProviderType.CLOUD_LLM, false, true, 'cloud.openai.main'],
    ['local provider', ProviderType.LOCAL_TOOL, true, true, 'cloud.openai.main'],
    ['untrusted executable', ProviderType.CLOUD_LLM, true, false, 'cloud.openai.main'],
    ['provider/profile mismatch', ProviderType.CLOUD_LLM, true, true, 'cloud.other'],
  ])('fails closed for %s', async (_name, providerType, enabled, trusted, providerCode) => {
    providerResolver.resolve.mockResolvedValue({ providerType, providerCode });
    if (!trusted) trustedExecutableResolver.resolve.mockResolvedValue(null);
    const resolver = new TrustedExecutionPolicyResolver(
      ROOT,
      providerResolver as any,
      new CloudExecutionProfileRegistry([profile(enabled)]),
      trustedExecutableResolver as any,
    );
    const policy = await resolver.resolve(BASE_CONTEXT);
    expect(policy?.trustedReviewerAgentAliases ?? []).toEqual([]);
  });

  it('does not grant REVIEW_PACKAGE launcher authority to another reviewer capability', async () => {
    const resolver = new TrustedExecutionPolicyResolver(
      ROOT,
      providerResolver as any,
      new CloudExecutionProfileRegistry([profile()]),
      trustedExecutableResolver as any,
    );
    const policy = await resolver.resolve({
      ...BASE_CONTEXT,
      capabilityCode: EngineeringCapability.CODE_REVIEW,
    });
    expect(policy?.trustedReviewerAgentAliases ?? []).toEqual([]);
    expect(trustedExecutableResolver.resolve).not.toHaveBeenCalled();
  });

  it('does not grant launcher authority for a non-command REVIEW_PACKAGE action', async () => {
    const resolver = new TrustedExecutionPolicyResolver(
      ROOT,
      providerResolver as any,
      new CloudExecutionProfileRegistry([profile()]),
      trustedExecutableResolver as any,
    );
    const policy = await resolver.resolve({
      ...BASE_CONTEXT,
      requestedAction: ExecutionAction.READ_FILE,
    });
    expect(policy?.trustedReviewerAgentAliases ?? []).toEqual([]);
    expect(trustedExecutableResolver.resolve).not.toHaveBeenCalled();
  });

  it('fails closed when dependency evidence lookup throws', async () => {
    providerResolver.resolve.mockRejectedValue(new Error('lookup failed'));
    const resolver = new TrustedExecutionPolicyResolver(
      ROOT,
      providerResolver as any,
      new CloudExecutionProfileRegistry([profile()]),
      trustedExecutableResolver as any,
    );
    const policy = await resolver.resolve(BASE_CONTEXT);
    expect(policy?.trustedReviewerAgentAliases ?? []).toEqual([]);
  });
});
