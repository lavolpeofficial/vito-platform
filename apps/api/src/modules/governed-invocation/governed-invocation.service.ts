import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  GovernedCapabilityInvocationRequest,
  GovernedCapabilityInvocationResult,
  InvocationFailureReason,
  INVOCATION_FAILURE_MESSAGES,
  GovernedAdapterRegistry,
  GovernedProviderAdapter,
  GovernedExecutionContext,
  GovernedAdapterRequest,
  GovernedAdapterResult,
  GovernedExecutionEnvironment,
  TrustedExecutable,
  AgentExecutionStatus,
  ExecutionOutcome,
  ProviderDeclaration,
  ProviderType,
  providerSupportsCapability,
  isProviderRoutable,
  ExecutionProfile,
  ExecutionAction,
  PolicyEvaluationContext,
  PolicyDecision,
  PolicyReasonCode,
  ExecutionBudget,
  CredentialBroker,
  HumanGateBinding,
  SideEffectSummary,
  NetworkCallSummary,
  isValidInvocationTransition,
  invocationFailureToStatus,
  invocationFailureToOutcome,
  ReleaseGateStatus,
  evaluatePolicy,
  ExecutionPolicyConfig,
  ExecutionPolicyResolver,
  ExecutionProfileResolver,
  TrustedExecutableResolver,
  WorkingDirectoryResolver,
  validateHumanGateBinding,
  HumanGateResolver,
  ProviderCredentialRequirement,
  sanitizeProviderExecutionMetadata,
  sanitizeErrorProviderMetadata,
} from '@vito/contracts';
import { AuditService } from '../audit/audit.service';

export interface ProviderResolver {
  resolve(providerId: string, organizationId: string): Promise<ProviderDeclaration | null>;
}

export interface HomeDirectoryResolver {
  resolve(context: {
    organizationId: string;
    workflowRunId: string;
    workflowStepRunId: string;
    capabilityCode: string;
    providerId: string;
  }): Promise<string | null>;
}

export interface GovernedInvocationDependencies {
  providerResolver: ProviderResolver;
  adapterRegistry: GovernedAdapterRegistry;
  credentialBroker: CredentialBroker | null;
  auditService: AuditService;
  /**
   * Trusted authority for the EFFECTIVE ExecutionProfile.
   * The caller-supplied request.executionProfile is a non-authoritative hint
   * and MUST NOT reach policy authorization. Fail closed when this resolver
   * is missing, returns null/invalid or throws — before adapter.execute().
   */
  executionProfileResolver: ExecutionProfileResolver | null;
  trustedExecutableResolver: TrustedExecutableResolver | null;
  workingDirectoryResolver: WorkingDirectoryResolver | null;
  humanGateResolver: HumanGateResolver | null;
  homeDirectoryResolver: HomeDirectoryResolver | null;
  executionPolicyResolver: ExecutionPolicyResolver | null;
}

export interface GovernedInvocationService {
  invoke(request: GovernedCapabilityInvocationRequest): Promise<GovernedCapabilityInvocationResult>;
}

/**
 * Trusted ExecutionProfileResolver-Auflösung.
 *
 * Das effektive ExecutionProfile ist NIEMALS caller-autoritativ. Der
 * request.executionProfile-Wert ist nur ein nicht-autoritativer Hinweis;
 * die Authorität kommt ausschließlich über die injizierte, vertrauenswürdige
 * Abstraktion (z. B. Workflow-Step-Run-Bindung).
 * Fail closed: fehlender Resolver, null-Ergebnis, ungültiger Wert oder
 * Resolver-Fehler führen zu EXECUTION_PROFILE_NOT_GOVERNED und verhindern
 * die Ausführung VOR adapter.execute().
 */
async function resolveTrustedExecutionProfile(
  request: GovernedCapabilityInvocationRequest,
  dependencies: GovernedInvocationDependencies,
  logger?: Logger,
): Promise<ExecutionProfile | null> {
  if (!dependencies.executionProfileResolver) {
    return null;
  }

  try {
    return await dependencies.executionProfileResolver.resolve({
      organizationId: request.organizationId,
      workflowRunId: request.workflowRunId,
      workflowStepRunId: request.workflowStepRunId,
      capabilityCode: request.capabilityCode,
      providerId: request.providerId,
    });
  } catch (error) {
    logger?.warn(
      `EXECUTION_PROFILE_NOT_GOVERNED: Trusted execution profile resolver failed: ${String(error)}`,
    );
    return null;
  }
}

/**
 * Trusted ExecutionPolicyConfig-Auflösung (EO-01.4 Handoff).
 *
 * Der Caller kann KEINE Policy-Authorität liefern. Die Policy kommt
 * ausschließlich über die injizierte, vertrauenswürdige Abstraktion.
 * Fail closed: fehlender Resolver, null-Ergebnis oder Resolver-Fehler
 * verhindern die Ausführung VOR adapter.execute().
 */
async function resolveTrustedExecutionPolicy(
  request: GovernedCapabilityInvocationRequest,
  executionProfile: ExecutionProfile,
  dependencies: GovernedInvocationDependencies,
): Promise<ExecutionPolicyConfig> {
  if (!dependencies.executionPolicyResolver) {
    throw new Error('POLICY_MISSING: No trusted execution policy resolver configured');
  }

  const resolvedPolicy = await dependencies.executionPolicyResolver.resolve({
    organizationId: request.organizationId,
    workflowRunId: request.workflowRunId,
    workflowStepRunId: request.workflowStepRunId,
    capabilityCode: request.capabilityCode,
    providerId: request.providerId,
    executionProfile,
    requestedAction: request.requestedAction,
  });

  if (!resolvedPolicy) {
    throw new Error('POLICY_MISSING: Trusted execution policy could not be resolved');
  }

  return resolvedPolicy;
}

async function createPolicyEvaluationContext(
  request: GovernedCapabilityInvocationRequest,
  provider: ProviderDeclaration,
  executionProfile: ExecutionProfile,
  dependencies: GovernedInvocationDependencies,
): Promise<PolicyEvaluationContext> {
  let effectiveReleaseGateStatus = ReleaseGateStatus.NOT_REQUESTED;

  if (request.humanApprovalReference && dependencies.humanGateResolver) {
    const binding = await dependencies.humanGateResolver.resolve(request.humanApprovalReference, {
      organizationId: request.organizationId,
      workflowRunId: request.workflowRunId,
      workflowStepRunId: request.workflowStepRunId,
      capabilityCode: request.capabilityCode,
      providerId: request.providerId,
      inputReference: request.inputReference,
    });

    effectiveReleaseGateStatus = validateHumanGateBinding(binding, {
      organizationId: request.organizationId,
      workflowRunId: request.workflowRunId,
      workflowStepRunId: request.workflowStepRunId,
      capabilityCode: request.capabilityCode,
      providerId: request.providerId,
      inputReference: request.inputReference,
    });
  } else if (request.humanApprovalReference && !dependencies.humanGateResolver) {
    effectiveReleaseGateStatus = ReleaseGateStatus.NOT_REQUESTED;
  }

  let homeDir: string | undefined;

  if (request.requestedPath) {
    if (!dependencies.homeDirectoryResolver) {
      throw new Error(
        'WORKING_DIRECTORY_NOT_GOVERNED: No trusted home directory resolver configured for path-sensitive execution',
      );
    }

    const resolvedHomeDir = await dependencies.homeDirectoryResolver.resolve({
      organizationId: request.organizationId,
      workflowRunId: request.workflowRunId,
      workflowStepRunId: request.workflowStepRunId,
      capabilityCode: request.capabilityCode,
      providerId: request.providerId,
    });

    if (!resolvedHomeDir) {
      throw new Error(
        'WORKING_DIRECTORY_NOT_GOVERNED: Trusted home directory context could not be established',
      );
    }

    homeDir = resolvedHomeDir;
  }

  const resolvedPolicy = await resolveTrustedExecutionPolicy(request, executionProfile, dependencies);

  return {
    // Autoritatives Profil aus dem trusted ExecutionProfileResolver —
    // niemals der caller-kontrollierte request.executionProfile-Hinweis.
    executionProfile,
    requestedAction: request.requestedAction,
    requestedPath: request.requestedPath,
    requestedCommand: request.requestedCommand,
    homeDir,
    releaseGateStatus: effectiveReleaseGateStatus,
    organizationId: request.organizationId,
    workflowRunId: request.workflowRunId,
    workflowStepRunId: request.workflowStepRunId,
    correlationId: request.correlationId,
    policy: resolvedPolicy,
  };
}

async function buildGovernedExecutionEnvironment(
  request: GovernedCapabilityInvocationRequest,
  provider: ProviderDeclaration,
  workingDirectoryResolver: WorkingDirectoryResolver | null,
): Promise<GovernedExecutionEnvironment> {
  const allowlist = new Map<string, string>();

  if (request.executionBudget.maxDurationMs !== undefined) {
    allowlist.set('EXECUTION_TIMEOUT_MS', String(request.executionBudget.maxDurationMs));
  }
  if (request.executionBudget.maxTokens !== undefined) {
    allowlist.set('EXECUTION_MAX_TOKENS', String(request.executionBudget.maxTokens));
  }
  if (request.executionBudget.maxCostMinorUnits !== undefined) {
    allowlist.set('EXECUTION_MAX_COST_MINOR_UNITS', String(request.executionBudget.maxCostMinorUnits));
  }

  allowlist.set('CAPABILITY_CODE', request.capabilityCode);
  allowlist.set('PROVIDER_ID', provider.id);
  allowlist.set('ORGANIZATION_ID', request.organizationId);
  allowlist.set('WORKFLOW_RUN_ID', request.workflowRunId);
  allowlist.set('WORKFLOW_STEP_RUN_ID', request.workflowStepRunId);
  allowlist.set('CORRELATION_ID', request.correlationId);
  allowlist.set('INVOCATION_ID', request.invocationId);

  if (!workingDirectoryResolver) {
    throw new Error('WORKING_DIRECTORY_NOT_GOVERNED: No working directory resolver configured');
  }

  const workingDirectory = await workingDirectoryResolver.resolve({
    organizationId: request.organizationId,
    workflowRunId: request.workflowRunId,
    workflowStepRunId: request.workflowStepRunId,
    capabilityCode: request.capabilityCode,
    providerId: request.providerId,
  });

  if (!workingDirectory) {
    throw new Error('WORKING_DIRECTORY_NOT_GOVERNED: No governed working directory could be resolved');
  }

  return {
    allowlist,
    workingDirectory,
  };
}

async function resolveTrustedExecutable(
  requestedCommand: string | undefined,
  resolver: TrustedExecutableResolver | null,
  context: {
    organizationId: string;
    workflowRunId: string;
    capabilityCode: string;
    providerId: string;
  },
): Promise<TrustedExecutable | undefined> {
  if (!requestedCommand) return undefined;

  if (!resolver) {
    throw new Error('EXECUTABLE_NOT_TRUSTED: No trusted executable resolver configured');
  }

  const executable = await resolver.resolve(requestedCommand, context);

  if (!executable) {
    throw new Error('EXECUTABLE_NOT_TRUSTED: Could not verify executable trust');
  }

  return executable;
}

function normalizeAdapterResult(
  request: GovernedCapabilityInvocationRequest,
  provider: ProviderDeclaration,
  policyDecision: PolicyDecision,
  adapterResult: GovernedAdapterResult,
  startedAt: Date,
  completedAt: Date,
): GovernedCapabilityInvocationResult {
  const durationMs = completedAt.getTime() - startedAt.getTime();

  const sanitizedProviderMetadata =
    sanitizeProviderExecutionMetadata(adapterResult.providerExecutionMetadata);

  const sanitizedUsageMetadata = adapterResult.usageMetadata
    ? sanitizeProviderExecutionMetadata(adapterResult.usageMetadata)
    : undefined;

  const error = adapterResult.error
    ? {
        reason: 'EXECUTION_FAILED' as InvocationFailureReason,
        message: adapterResult.error.message,
        executionOutcome: undefined,
        agentExecutionStatus: adapterResult.status,
        retryable: adapterResult.error.retryable,
        providerMetadata: sanitizeErrorProviderMetadata(adapterResult.error.providerMetadata),
      }
    : undefined;

  const se = sanitizedProviderMetadata?.sideEffects as Partial<SideEffectSummary> | undefined;

  const sideEffectSummary: SideEffectSummary = {
    filesCreated: se?.filesCreated ? [...se.filesCreated] : [],
    filesModified: se?.filesModified ? [...se.filesModified] : [],
    filesDeleted: se?.filesDeleted ? [...se.filesDeleted] : [],
    commandsExecuted: se?.commandsExecuted ? [...se.commandsExecuted] : [],
    networkCalls: se?.networkCalls ? [...se.networkCalls] : [],
    artifactsCreated: adapterResult.artifactReferences ? [...adapterResult.artifactReferences] : [],
  };

  return {
    invocationId: request.invocationId,
    organizationId: request.organizationId,
    workflowRunId: request.workflowRunId,
    workflowStepRunId: request.workflowStepRunId,
    correlationId: request.correlationId,
    capabilityCode: request.capabilityCode,
    providerId: provider.id,
    status: adapterResult.status,
    startedAt,
    completedAt,
    durationMs,
    outputReference: adapterResult.outputReference,
    artifactReferences: adapterResult.artifactReferences,
    evidenceReferences: adapterResult.evidenceReferences,
    providerExecutionMetadata: sanitizedProviderMetadata,
    normalizedError: error,
    policyDecisionReference: `${policyDecision.policyVersion}-${policyDecision.evaluatedAt.toISOString()}`,
    sideEffectSummary,
    usageMetadata: sanitizedUsageMetadata,
  };
}

function createPolicyBlockedResult(
  request: GovernedCapabilityInvocationRequest,
  provider: ProviderDeclaration,
  policyDecision: PolicyDecision,
  startedAt: Date,
): GovernedCapabilityInvocationResult {
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  // Map EO-01.4 reasonCode to appropriate invocation failure reason
  let invocationReason: InvocationFailureReason = 'POLICY_BLOCKED';
  if (policyDecision.reasonCode === 'RELEASE_GATE_NOT_APPROVED') {
    invocationReason = 'HUMAN_GATE_NOT_BOUND';
  }

  const sanitizedPolicyMetadata = sanitizeProviderExecutionMetadata({
    policyReasonCode: policyDecision.reasonCode,
    policyVersion: policyDecision.policyVersion,
  });

  return {
    invocationId: request.invocationId,
    organizationId: request.organizationId,
    workflowRunId: request.workflowRunId,
    workflowStepRunId: request.workflowStepRunId,
    correlationId: request.correlationId,
    capabilityCode: request.capabilityCode,
    providerId: provider.id,
    status: AgentExecutionStatus.POLICY_BLOCKED,
    startedAt,
    completedAt,
    durationMs,
    providerExecutionMetadata: {},
    normalizedError: {
      reason: invocationReason,
      message: policyDecision.reason,
      executionOutcome: ExecutionOutcome.POLICY_BLOCKED,
      agentExecutionStatus: AgentExecutionStatus.POLICY_BLOCKED,
      retryable: false,
      providerMetadata: sanitizedPolicyMetadata,
    },
    policyDecisionReference: `${policyDecision.policyVersion}-${policyDecision.evaluatedAt.toISOString()}`,
  };
}

function createInvocationErrorResult(
  request: GovernedCapabilityInvocationRequest,
  provider: ProviderDeclaration | null,
  reason: InvocationFailureReason,
  startedAt: Date,
  message?: string,
): GovernedCapabilityInvocationResult {
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  const providerId = provider?.id ?? 'unknown';
  const status = invocationFailureToStatus(reason);
  const outcome = invocationFailureToOutcome(reason);

  return {
    invocationId: request.invocationId,
    organizationId: request.organizationId,
    workflowRunId: request.workflowRunId,
    workflowStepRunId: request.workflowStepRunId,
    correlationId: request.correlationId,
    capabilityCode: request.capabilityCode,
    providerId,
    status,
    startedAt,
    completedAt,
    durationMs,
    providerExecutionMetadata: {},
    normalizedError: {
      reason,
      message: message ?? INVOCATION_FAILURE_MESSAGES[reason],
      executionOutcome: outcome ?? undefined,
      agentExecutionStatus: status,
      retryable: false,
    },
    policyDecisionReference: 'invocation-validation-failed',
  };
}

@Injectable()
export class GovernedInvocationServiceImpl implements GovernedInvocationService {
  private readonly logger = new Logger(GovernedInvocationServiceImpl.name);

  constructor(
    private readonly dependencies: GovernedInvocationDependencies,
  ) {}

  async invoke(request: GovernedCapabilityInvocationRequest): Promise<GovernedCapabilityInvocationResult> {
    const startedAt = new Date();

    this.validateRequest(request);

    const provider = await this.resolveAndValidateProvider(request);

    const adapter = this.resolveAdapter(provider);

    // Trust boundary: das autoritative ExecutionProfile kommt ausschließlich
    // aus dem trusted ExecutionProfileResolver. Der caller-kontrollierte
    // request.executionProfile-Hinweis fließt NICHT in Autorisierung ein.
    const executionProfile = await resolveTrustedExecutionProfile(
      request,
      this.dependencies,
      this.logger,
    );

    if (!executionProfile || !Object.values(ExecutionProfile).includes(executionProfile)) {
      return createInvocationErrorResult(
        request,
        provider,
        'EXECUTION_PROFILE_NOT_GOVERNED',
        startedAt,
      );
    }

    const policyContext = await createPolicyEvaluationContext(
      request,
      provider,
      executionProfile,
      this.dependencies,
    );
    const policyDecision = evaluatePolicy(policyContext);

    if (!policyDecision.allowed) {
      await this.auditPolicyDecision(request, provider, executionProfile, policyDecision, false);
      return createPolicyBlockedResult(request, provider, policyDecision, startedAt);
    }

    await this.auditPolicyDecision(request, provider, executionProfile, policyDecision, true);

    const credentialReference = await this.resolveCredentials(provider, request.organizationId);

    const executionContext = await this.buildExecutionContext(
      request,
      provider,
      executionProfile,
      policyDecision,
      credentialReference,
    );

    const adapterRequest: GovernedAdapterRequest = {
      inputReference: request.inputReference,
      governedInputPayload: request.governedInputPayload,
    };

    const adapterResult = await adapter.execute(adapterRequest, executionContext);

    const completedAt = new Date();

    const result = normalizeAdapterResult(
      request,
      provider,
      policyDecision,
      adapterResult,
      startedAt,
      completedAt,
    );

    await this.auditInvocationComplete(request, provider, executionProfile, result);

    return result;
  }

  private validateRequest(request: GovernedCapabilityInvocationRequest): void {
    if (!request.invocationId || !request.organizationId || !request.workflowRunId || !request.workflowStepRunId) {
      throw new Error('MALFORMED_INVOCATION: Missing required identifiers');
    }
    if (!request.capabilityCode || !request.providerId) {
      throw new Error('MALFORMED_INVOCATION: Missing capabilityCode or providerId');
    }
    // Strukturelle Validierung des NICHT-autoritativen Profil-Hinweises.
    // Autorisierung nutzt ausschließlich den trusted ExecutionProfileResolver.
    if (!request.executionProfile || !Object.values(ExecutionProfile).includes(request.executionProfile)) {
      throw new Error('MALFORMED_INVOCATION: Invalid requestedExecutionProfile hint');
    }
    if (!request.requestedAction || !Object.values(ExecutionAction).includes(request.requestedAction)) {
      throw new Error('MALFORMED_INVOCATION: Invalid requestedAction');
    }
    if (!request.executionBudget) {
      throw new Error('MALFORMED_INVOCATION: Missing executionBudget');
    }
    if (!request.requestedAt || !(request.requestedAt instanceof Date)) {
      throw new Error('MALFORMED_INVOCATION: Missing or invalid requestedAt');
    }
  }

  private async resolveAndValidateProvider(
    request: GovernedCapabilityInvocationRequest,
  ): Promise<ProviderDeclaration> {
    const provider = await this.dependencies.providerResolver.resolve(request.providerId, request.organizationId);

    if (!provider) {
      throw new Error('PROVIDER_UNAVAILABLE: Provider not found');
    }

    if (provider.organizationId !== request.organizationId) {
      throw new Error('ORGANIZATION_MISMATCH: Provider does not belong to requesting organization');
    }

    if (!providerSupportsCapability(provider, request.capabilityCode)) {
      throw new Error('CAPABILITY_NOT_SUPPORTED: Provider does not support the requested capability');
    }

    if (!isProviderRoutable(provider)) {
      throw new Error('PROVIDER_NOT_ELIGIBLE: Provider is not routable (status/health/quota)');
    }

    return provider;
  }

  private resolveAdapter(provider: ProviderDeclaration): GovernedProviderAdapter {
    const adapter = this.dependencies.adapterRegistry.get(provider.providerType);

    if (!adapter) {
      throw new Error('ADAPTER_NOT_REGISTERED: No adapter registered for provider type');
    }

    return adapter;
  }

  private async resolveCredentials(
    provider: ProviderDeclaration,
    organizationId: string,
  ): Promise<string | undefined> {
    const credentialRequirement =
      provider.credentialRequirement ?? ProviderCredentialRequirement.UNKNOWN;

    if (credentialRequirement === ProviderCredentialRequirement.NOT_REQUIRED) {
      return undefined;
    }

    if (credentialRequirement === ProviderCredentialRequirement.REQUIRED) {
      if (!this.dependencies.credentialBroker) {
        throw new Error('CREDENTIAL_INJECTION_FAILED: Credential broker not configured but provider requires credentials');
      }

      const reference = await this.dependencies.credentialBroker.getCredentialReference(provider.id, organizationId);

      if (!reference) {
        throw new Error('CREDENTIAL_INJECTION_FAILED: Credential reference not available but provider requires credentials');
      }

      const valid = await this.dependencies.credentialBroker.validateCredentialReference(reference);
      if (!valid) {
        throw new Error('CREDENTIAL_INJECTION_FAILED: Credential reference is no longer valid');
      }

      return reference;
    }

    throw new Error('CREDENTIAL_INJECTION_FAILED: Provider credential requirement is UNKNOWN, failing closed');
  }

  private async buildExecutionContext(
    request: GovernedCapabilityInvocationRequest,
    provider: ProviderDeclaration,
    executionProfile: ExecutionProfile,
    policyDecision: PolicyDecision,
    credentialReference: string | undefined,
  ): Promise<GovernedExecutionContext> {
    const environment = await buildGovernedExecutionEnvironment(
      request,
      provider,
      this.dependencies.workingDirectoryResolver,
    );

    const trustedExecutable = await resolveTrustedExecutable(
      request.requestedCommand,
      this.dependencies.trustedExecutableResolver,
      {
        organizationId: request.organizationId,
        workflowRunId: request.workflowRunId,
        capabilityCode: request.capabilityCode,
        providerId: request.providerId,
      },
    );

    return {
      invocationId: request.invocationId,
      organizationId: request.organizationId,
      workflowRunId: request.workflowRunId,
      workflowStepRunId: request.workflowStepRunId,
      correlationId: request.correlationId,
      capabilityCode: request.capabilityCode,
      providerId: provider.id,
      providerType: provider.providerType,
      executionProfile,
      assuranceLevel: request.assuranceLevel,
      executionBudget: request.executionBudget,
      policyDecision,
      environment,
      trustedExecutable,
      credentialReference,
      startedAt: new Date(),
      timeoutMs: request.executionBudget.maxDurationMs ?? 300000,
    };
  }

  private async auditPolicyDecision(
    request: GovernedCapabilityInvocationRequest,
    provider: ProviderDeclaration,
    executionProfile: ExecutionProfile,
    decision: PolicyDecision,
    allowed: boolean,
  ): Promise<void> {
    await this.dependencies.auditService.record({
      organizationId: request.organizationId,
      actorType: 'SYSTEM',
      action: allowed ? 'POLICY_ALLOWED' : 'POLICY_DENIED',
      entityType: 'PolicyDecision',
      entityId: `${decision.policyVersion}-${decision.evaluatedAt.toISOString()}`,
      metadata: {
        correlationId: request.correlationId,
        invocationId: request.invocationId,
        capabilityCode: request.capabilityCode,
        providerId: provider.id,
        providerType: provider.providerType,
        executionProfile,
        requestedAction: request.requestedAction,
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        allowed: decision.allowed,
      },
    });
  }

  private async auditInvocationComplete(
    request: GovernedCapabilityInvocationRequest,
    provider: ProviderDeclaration,
    executionProfile: ExecutionProfile,
    result: GovernedCapabilityInvocationResult,
  ): Promise<void> {
    await this.dependencies.auditService.record({
      organizationId: request.organizationId,
      actorType: 'SYSTEM',
      action: 'GOVERNED_INVOCATION_COMPLETE',
      entityType: 'GovernedCapabilityInvocation',
      entityId: request.invocationId,
      metadata: {
        correlationId: request.correlationId,
        capabilityCode: request.capabilityCode,
        providerId: provider.id,
        providerType: provider.providerType,
        executionProfile,
        status: result.status,
        durationMs: result.durationMs,
        policyDecisionReference: result.policyDecisionReference,
        normalizedError: result.normalizedError
          ? {
              reason: result.normalizedError.reason,
              message: result.normalizedError.message,
              retryable: result.normalizedError.retryable,
            }
          : null,
        sideEffectSummary: result.sideEffectSummary,
      },
    });
  }
}