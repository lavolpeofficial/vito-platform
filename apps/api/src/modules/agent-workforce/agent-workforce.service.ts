import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  ProviderType,
  type ExecutionBudget,
  type IndependenceContext,
} from '@vito/contracts';
import { randomUUID } from 'node:crypto';

import { ProviderRouterService } from '../provider-registry/provider-router.service';
import {
  GovernedRuntimeService,
  TRUSTED_RUNTIME_ORIGIN,
} from '../governed-runtime/governed-runtime.service';

const MAX_PROMPT_BYTES = 512 * 1024;
const MAX_DEFAULT_ARGS = 64;
const MAX_ARG_LENGTH = 4096;

export interface DispatchAgentTaskInput {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly capabilityCode: string;
  readonly prompt: string;
  readonly assuranceLevel?: string;
  readonly correlationId?: string;
  readonly independenceContext?: IndependenceContext;
  readonly executionBudget?: ExecutionBudget;
}

/**
 * Server-side bridge from "VITO needs a capability" to a governed provider
 * invocation. Callers choose the capability and task, never the executable or
 * provider. Provider selection stays with ProviderRouterService; executable
 * identity and credential authority are re-proven inside governed invocation.
 */
@Injectable()
export class AgentWorkforceService {
  constructor(
    private readonly providerRouter: ProviderRouterService,
    private readonly governedRuntime: GovernedRuntimeService,
  ) {}

  async dispatch(input: DispatchAgentTaskInput) {
    this.validateInput(input);
    const correlationId = input.correlationId ?? randomUUID();

    const routing = await this.providerRouter.route({
      organizationId: input.organizationId,
      capability: input.capabilityCode,
      assuranceLevel: input.assuranceLevel,
      workflowRunId: input.workflowRunId,
      workflowStepRunId: input.workflowStepRunId,
      independenceContext: input.independenceContext,
      budget:
        input.executionBudget?.maxCostMinorUnits !== undefined
          ? { maxCostMinorUnits: input.executionBudget.maxCostMinorUnits }
          : undefined,
      correlationId,
    });

    const provider = routing.selectedProvider;
    if (!provider) {
      throw new ServiceUnavailableException({
        code: 'NO_ELIGIBLE_AGENT_PROVIDER',
        routingDecisionId: routing.routingDecisionId,
        decisionReason: routing.decisionReason,
        rejectionReasons: routing.rejectionReasons,
      });
    }

    if (provider.providerType !== ProviderType.LOCAL_TOOL) {
      throw new ServiceUnavailableException({
        code: 'AGENT_PROVIDER_ADAPTER_NOT_READY',
        providerId: provider.id,
        providerType: provider.providerType,
        routingDecisionId: routing.routingDecisionId,
      });
    }

    const commandAlias = this.providerCommandAlias(provider.metadata);
    const defaultArgs = this.providerDefaultArgs(provider.metadata);

    const execution = await this.governedRuntime.executeWorkspaceFileOperation({
      trustOrigin: TRUSTED_RUNTIME_ORIGIN,
      organizationId: input.organizationId,
      providerId: provider.id,
      capabilityCode: input.capabilityCode,
      requestedAction: 'RUN_COMMAND',
      command: commandAlias,
      governedInputPayload: {
        args: defaultArgs,
        prompt: input.prompt,
      },
      correlationId,
      workflowRunId: input.workflowRunId,
      workflowStepRunId: input.workflowStepRunId,
      executionBudget: input.executionBudget,
    });

    return Object.freeze({
      routingDecisionId: routing.routingDecisionId,
      selectedProviderId: provider.id,
      selectedProviderCode: provider.providerCode,
      correlationId,
      execution,
    });
  }

  private validateInput(input: DispatchAgentTaskInput): void {
    if (!input.organizationId || !input.workflowRunId || !input.workflowStepRunId) {
      throw new BadRequestException('organizationId, workflowRunId and workflowStepRunId are required');
    }
    if (!input.capabilityCode || typeof input.capabilityCode !== 'string') {
      throw new BadRequestException('capabilityCode is required');
    }
    if (
      typeof input.prompt !== 'string' ||
      input.prompt.trim().length === 0 ||
      Buffer.byteLength(input.prompt, 'utf8') > MAX_PROMPT_BYTES
    ) {
      throw new BadRequestException('prompt must be a non-empty bounded string');
    }
  }

  private providerCommandAlias(metadata: Record<string, unknown>): string {
    const alias = metadata.commandAlias;
    if (typeof alias !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(alias)) {
      throw new ServiceUnavailableException({ code: 'AGENT_PROVIDER_COMMAND_ALIAS_INVALID' });
    }
    return alias;
  }

  private providerDefaultArgs(metadata: Record<string, unknown>): readonly string[] {
    const value = metadata.defaultArgs;
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_DEFAULT_ARGS) {
      throw new ServiceUnavailableException({ code: 'AGENT_PROVIDER_DEFAULT_ARGS_INVALID' });
    }

    const args: string[] = [];
    for (const arg of value) {
      if (typeof arg !== 'string' || arg.length > MAX_ARG_LENGTH || arg.includes('\0')) {
        throw new ServiceUnavailableException({ code: 'AGENT_PROVIDER_DEFAULT_ARGS_INVALID' });
      }
      args.push(arg);
    }
    return Object.freeze(args);
  }
}
