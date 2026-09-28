import {
  EngineeringCapability,
  ExecutionAction,
  ExecutionProfile,
  createBuilderPolicy,
  createReviewerPolicy,
  isCloudGovernedProviderType,
  type ExecutionPolicyConfig,
  type ExecutionPolicyResolutionContext,
  type ExecutionPolicyResolver,
  type ProviderDeclaration,
  type TrustedExecutableResolver,
} from '@vito/contracts';
import type { CloudExecutionProfileRegistry } from '../../cloud-governed-execution/cloud-execution-profile.registry';
import { parseGovernedWorkspaceRoot } from './governed-workspace.resolvers';

interface ProviderDeclarationResolver {
  resolve(providerId: string, organizationId: string): Promise<ProviderDeclaration | null>;
}

/**
 * Trusted EO-01.5 policy resolver. The frozen policy factories remain the
 * source of truth. TEST_EXECUTION, REVIEW_PACKAGE, and RED_TEAM receive
 * distinct exact launcher authority only when server-owned provider/profile/executable
 * evidence all agree.
 */
export class TrustedExecutionPolicyResolver implements ExecutionPolicyResolver {
  private readonly workspaceRoot: string;

  constructor(
    workspaceRoot: string,
    private readonly providerResolver?: ProviderDeclarationResolver,
    private readonly cloudProfileRegistry?: CloudExecutionProfileRegistry,
    private readonly trustedExecutableResolver?: TrustedExecutableResolver,
  ) {
    this.workspaceRoot = parseGovernedWorkspaceRoot(workspaceRoot);
  }

  async resolve(context: ExecutionPolicyResolutionContext): Promise<ExecutionPolicyConfig | null> {
    switch (context.executionProfile) {
      case ExecutionProfile.BUILDER:
        return this.resolveBuilderPolicy(context);
      case ExecutionProfile.REVIEWER:
        return this.resolveReviewerPolicy(context);
      default:
        return null;
    }
  }

  private async resolveBuilderPolicy(
    context: ExecutionPolicyResolutionContext,
  ): Promise<ExecutionPolicyConfig> {
    const base = createBuilderPolicy(this.workspaceRoot);
    if (
      context.capabilityCode !== EngineeringCapability.TEST_EXECUTION ||
      context.requestedAction !== ExecutionAction.RUN_COMMAND ||
      !this.providerResolver ||
      !this.cloudProfileRegistry ||
      !this.trustedExecutableResolver
    ) {
      return base;
    }

    try {
      const provider = await this.providerResolver.resolve(context.providerId, context.organizationId);
      if (!provider || !isCloudGovernedProviderType(provider.providerType)) return base;

      const profile = this.cloudProfileRegistry.resolve(provider.providerCode);
      const alias = profile?.enabled === true ? profile.testExecutionLauncherAlias : undefined;
      if (!alias) return base;

      const trusted = await this.trustedExecutableResolver.resolve(alias, {
        organizationId: context.organizationId,
        workflowRunId: context.workflowRunId,
        capabilityCode: context.capabilityCode,
        providerId: context.providerId,
      });
      return trusted ? { ...base, trustedCodingAgentAliases: [alias] } : base;
    } catch {
      return base;
    }
  }

  private async resolveReviewerPolicy(
    context: ExecutionPolicyResolutionContext,
  ): Promise<ExecutionPolicyConfig> {
    const base = createReviewerPolicy(this.workspaceRoot);
    if (
      (context.capabilityCode !== EngineeringCapability.REVIEW_PACKAGE &&
        context.capabilityCode !== EngineeringCapability.RED_TEAM) ||
      context.requestedAction !== ExecutionAction.RUN_COMMAND ||
      !this.providerResolver ||
      !this.cloudProfileRegistry ||
      !this.trustedExecutableResolver
    ) {
      return base;
    }

    try {
      const provider = await this.providerResolver.resolve(context.providerId, context.organizationId);
      if (!provider || !isCloudGovernedProviderType(provider.providerType)) return base;

      const profile = this.cloudProfileRegistry.resolve(provider.providerCode);
      const alias = profile?.enabled === true ? profile.trustedLauncherAlias : undefined;
      if (!alias) return base;

      const trusted = await this.trustedExecutableResolver.resolve(alias, {
        organizationId: context.organizationId,
        workflowRunId: context.workflowRunId,
        capabilityCode: context.capabilityCode,
        providerId: context.providerId,
      });
      return trusted ? { ...base, trustedReviewerAgentAliases: [alias] } : base;
    } catch {
      return base;
    }
  }
}
