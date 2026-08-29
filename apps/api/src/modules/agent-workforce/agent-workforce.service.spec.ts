import { ServiceUnavailableException } from '@nestjs/common';
import { AgentExecutionStatus, ProviderType } from '@vito/contracts';
import type { CloudExecutionProfile } from '@vito/contracts';

import { AgentWorkforceService } from './agent-workforce.service';
import { CloudExecutionProfileRegistry } from '../cloud-governed-execution/cloud-execution-profile.registry';

describe('AgentWorkforceService', () => {
  const route = jest.fn();
  const executeWorkspaceFileOperation = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const input = {
    organizationId: 'org-1',
    workflowRunId: 'run-1',
    workflowStepRunId: 'step-1',
    capabilityCode: 'CODE_BUILD',
    prompt: 'Implement the bounded task and run tests.',
    assuranceLevel: 'AL-3',
    correlationId: 'corr-1',
    executionBudget: { maxDurationMs: 120_000, maxCostMinorUnits: 50 },
  };

  function service(registry?: CloudExecutionProfileRegistry) {
    return new AgentWorkforceService(
      { route } as any,
      { executeWorkspaceFileOperation } as any,
      registry,
    );
  }

  function enabledCloudProfile(providerCode: string): CloudExecutionProfile {
    return {
      profileId: 'profile-cloud',
      providerCode,
      credentialRef: 'cloud:test',
      trustedLauncherAlias: 'worker-agent',
      expectedProviderId: 'openai',
      maxDurationMs: 60_000,
      maxParallelism: 1,
      enabled: true,
    };
  }

  it('routes by capability and dispatches the selected local tool through governed runtime', async () => {
    route.mockResolvedValue({
      selectedProvider: {
        id: 'provider-1',
        providerCode: 'opencode-local',
        providerType: ProviderType.LOCAL_TOOL,
        metadata: { commandAlias: 'opencode', defaultArgs: ['run', '--auto'] },
      },
      routingDecisionId: 'route-1',
      rejectionReasons: {},
      decisionReason: 'selected',
    });
    executeWorkspaceFileOperation.mockResolvedValue({
      invocationId: 'inv-1',
      status: AgentExecutionStatus.SUCCEEDED,
    });

    const result = await service().dispatch(input);

    expect(route).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        capability: 'CODE_BUILD',
        assuranceLevel: 'AL-3',
        workflowRunId: 'run-1',
        workflowStepRunId: 'step-1',
        budget: { maxCostMinorUnits: 50 },
        correlationId: 'corr-1',
      }),
    );
    expect(executeWorkspaceFileOperation).toHaveBeenCalledWith({
      trustOrigin: 'SERVER_RUNTIME',
      organizationId: 'org-1',
      providerId: 'provider-1',
      capabilityCode: 'CODE_BUILD',
      requestedAction: 'RUN_COMMAND',
      command: 'opencode',
      governedInputPayload: {
        args: ['run', '--auto'],
        prompt: input.prompt,
      },
      correlationId: 'corr-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      executionBudget: input.executionBudget,
    });
    expect(result.selectedProviderCode).toBe('opencode-local');
    expect(result.routingDecisionId).toBe('route-1');
  });

  it('fails closed when no provider is eligible', async () => {
    route.mockResolvedValue({
      selectedProvider: null,
      routingDecisionId: 'route-none',
      rejectionReasons: { p1: 'QUOTA_EXHAUSTED' },
      decisionReason: 'no eligible provider',
    });

    await expect(service().dispatch(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(executeWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('does not execute a routed CLOUD_LLM provider without an enabled cloud profile', async () => {
    route.mockResolvedValue({
      selectedProvider: {
        id: 'cloud-1',
        providerCode: 'cloud-reviewer',
        providerType: ProviderType.CLOUD_LLM,
        metadata: { commandAlias: 'ignored' },
      },
      routingDecisionId: 'route-cloud',
      rejectionReasons: {},
      decisionReason: 'selected',
    });

    await expect(service().dispatch(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service().dispatch(input)).rejects.toMatchObject({
      response: { code: 'AGENT_PROVIDER_ADAPTER_NOT_READY' },
    });
    expect(executeWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('CRITICAL: dispatches a CLOUD_LLM provider to CLOUD_GOVERNED only with an enabled server-owned profile', async () => {
    route.mockResolvedValue({
      selectedProvider: {
        id: 'cloud-1',
        providerCode: 'cloud.openai.main',
        providerType: ProviderType.CLOUD_LLM,
        metadata: { commandAlias: 'worker-agent', defaultArgs: ['--run'] },
      },
      routingDecisionId: 'route-cloud',
      rejectionReasons: {},
      decisionReason: 'selected',
    });
    executeWorkspaceFileOperation.mockResolvedValue({ status: AgentExecutionStatus.SUCCEEDED });
    const registry = new CloudExecutionProfileRegistry([enabledCloudProfile('cloud.openai.main')]);

    await service(registry).dispatch(input);

    expect(executeWorkspaceFileOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'cloud-1',
        command: 'worker-agent',
        requestedAction: 'RUN_COMMAND',
      }),
    );
  });

  it('CRITICAL: denies a CLOUD_LLM provider when the bound profile is disabled', async () => {
    route.mockResolvedValue({
      selectedProvider: {
        id: 'cloud-1',
        providerCode: 'cloud.openai.main',
        providerType: ProviderType.CLOUD_LLM,
        metadata: { commandAlias: 'worker-agent' },
      },
      routingDecisionId: 'route-cloud',
      rejectionReasons: {},
      decisionReason: 'selected',
    });
    const disabled = { ...enabledCloudProfile('cloud.openai.main'), enabled: false };
    const registry = new CloudExecutionProfileRegistry([disabled]);

    await expect(service(registry).dispatch(input)).rejects.toMatchObject({
      response: { code: 'AGENT_PROVIDER_ADAPTER_NOT_READY' },
    });
    expect(executeWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('CRITICAL: a cloud profile bound to a LOCAL_TOOL provider is a config error → deny (never downgrade)', async () => {
    route.mockResolvedValue({
      selectedProvider: {
        id: 'provider-1',
        providerCode: 'cloud.openai.main',
        providerType: ProviderType.LOCAL_TOOL,
        metadata: { commandAlias: 'opencode' },
      },
      routingDecisionId: 'route-1',
      rejectionReasons: {},
      decisionReason: 'selected',
    });
    const registry = new CloudExecutionProfileRegistry([enabledCloudProfile('cloud.openai.main')]);

    await expect(service(registry).dispatch(input)).rejects.toMatchObject({
      response: { code: 'AGENT_PROVIDER_ADAPTER_NOT_READY' },
    });
    expect(executeWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('LOCAL_TOOL without any cloud profile still dispatches through LOCAL_ISOLATED', async () => {
    route.mockResolvedValue({
      selectedProvider: {
        id: 'provider-1',
        providerCode: 'opencode-local',
        providerType: ProviderType.LOCAL_TOOL,
        metadata: { commandAlias: 'opencode', defaultArgs: [] },
      },
      routingDecisionId: 'route-1',
      rejectionReasons: {},
      decisionReason: 'selected',
    });
    executeWorkspaceFileOperation.mockResolvedValue({ status: AgentExecutionStatus.SUCCEEDED });

    await service().dispatch(input);

    expect(executeWorkspaceFileOperation).toHaveBeenCalled();
  });

  it('fails closed when provider metadata does not bind a trusted command alias', async () => {
    route.mockResolvedValue({
      selectedProvider: {
        id: 'provider-1',
        providerCode: 'local-agent',
        providerType: ProviderType.LOCAL_TOOL,
        metadata: {},
      },
      routingDecisionId: 'route-1',
      rejectionReasons: {},
      decisionReason: 'selected',
    });

    await expect(service().dispatch(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(executeWorkspaceFileOperation).not.toHaveBeenCalled();
  });

  it('rejects shell-like default arguments only when structurally invalid, while never using a shell', async () => {
    route.mockResolvedValue({
      selectedProvider: {
        id: 'provider-1',
        providerCode: 'local-agent',
        providerType: ProviderType.LOCAL_TOOL,
        metadata: { commandAlias: 'opencode', defaultArgs: ['run', '&&', 'rm -rf /'] },
      },
      routingDecisionId: 'route-1',
      rejectionReasons: {},
      decisionReason: 'selected',
    });
    executeWorkspaceFileOperation.mockResolvedValue({ status: AgentExecutionStatus.SUCCEEDED });

    await service().dispatch(input);

    expect(executeWorkspaceFileOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'opencode',
        governedInputPayload: expect.objectContaining({
          args: ['run', '&&', 'rm -rf /'],
        }),
      }),
    );
  });
});
