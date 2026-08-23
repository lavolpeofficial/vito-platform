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
  ProviderQuotaStatus,
  providerSupportsCapability,
  providerSupportsAssuranceLevel,
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
  isConsequentialExecutionAction,
  isFileMutationExecutionAction,
  GovernedInvocationIdempotencyStore,
  type GovernedInvocationClaimState,
  buildGovernedInvocationFingerprint,
  buildGovernedLogicalOperationKey,
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
  /**
   * Trusted idempotency boundary (Phase 3H). Null is only acceptable for
   * invocations without consequential actions — consequential actions fail
   * closed (IDEMPOTENCY_STORE_MISSING) before adapter.execute().
   */
  idempotencyStore: GovernedInvocationIdempotencyStore | null;
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
      // Phase 3G: die konkrete Action, deren Gate die Genehmigung befriedigen
      // soll. Nur Lookup-/Validierungs-Kontext — niemals Caller-Autorität.
      requestedAction: request.requestedAction,
    });

    effectiveReleaseGateStatus = validateHumanGateBinding(binding, {
      organizationId: request.organizationId,
      workflowRunId: request.workflowRunId,
      workflowStepRunId: request.workflowStepRunId,
      capabilityCode: request.capabilityCode,
      providerId: request.providerId,
      inputReference: request.inputReference,
      // Phase 3G: Action-Scope-Bindung fail-closed gegen die evaluierte
      // Action (GIT_COMMIT/GIT_PUSH ohne deklarierten Scope => keine
      // Wildcard-Autorität).
      requestedAction: request.requestedAction,
      // Phase 3G/Follow-up: Das Invocation-Modell trägt heute KEINE
      // autoritative artifactReference; eine artifact-gebundene Genehmigung
      // kann ihren Scope daher nicht beweisen und failt geschlossen
      // (validateHumanGateBinding). Kein erfundenes Artifact-Architecture.
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
  credentialReference?: string,
): GovernedCapabilityInvocationResult {
  const durationMs = completedAt.getTime() - startedAt.getTime();

  const trustedSecretValues = credentialReference ? [credentialReference] : [];

  const sanitizedProviderMetadata = redactTrustedSecretsDeep(
    sanitizeProviderExecutionMetadata(adapterResult.providerExecutionMetadata),
    trustedSecretValues,
  );

  const sanitizedUsageMetadata = adapterResult.usageMetadata
    ? redactTrustedSecretsDeep(
        sanitizeProviderExecutionMetadata(adapterResult.usageMetadata),
        trustedSecretValues,
      )
    : undefined;

  const error = adapterResult.error
    ? {
        reason: 'EXECUTION_FAILED' as InvocationFailureReason,
        // Leakage-Boundary: die Diagnose bleibt nützlich, Geheimmaterial
        // (z. B. die credentialReference dieser Invocation) wird redactiert.
        message: redactSecretMaterial(adapterResult.error.message, trustedSecretValues),
        executionOutcome: undefined,
        agentExecutionStatus: adapterResult.status,
        retryable: adapterResult.error.retryable,
        providerMetadata: redactTrustedSecretsDeep(
          sanitizeErrorProviderMetadata(adapterResult.error.providerMetadata),
          trustedSecretValues,
        ),
      }
    : undefined;

  const se = sanitizedProviderMetadata?.sideEffects as Partial<SideEffectSummary> | undefined;

  // Leakage-Boundary: das provider-kontrollierte Roh-Side-Effect-Objekt wird
  // aus den Metadaten entfernt; die alleinige, redactierte Repräsentation ist
  // sideEffectSummary.
  let outputProviderMetadata = sanitizedProviderMetadata;
  if (outputProviderMetadata && 'sideEffects' in outputProviderMetadata) {
    const { sideEffects: _stripped, ...rest } = outputProviderMetadata;
    outputProviderMetadata = rest as typeof outputProviderMetadata;
  }

  const sideEffectSummary: SideEffectSummary = {
    filesCreated: sanitizeSideEffectTextList(se?.filesCreated, trustedSecretValues),
    filesModified: sanitizeSideEffectTextList(se?.filesModified, trustedSecretValues),
    filesDeleted: sanitizeSideEffectTextList(se?.filesDeleted, trustedSecretValues),
    commandsExecuted: sanitizeSideEffectTextList(se?.commandsExecuted, trustedSecretValues),
    networkCalls: se?.networkCalls
      ? se.networkCalls.map((call) => ({
          ...call,
          destination: redactSecretMaterial(String(call.destination ?? ''), trustedSecretValues),
        }))
      : [],
    artifactsCreated: sanitizeGovernedReferenceList(
      adapterResult.artifactReferences,
      trustedSecretValues,
    ),
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
    // Leakage-Boundary: nur validierte gov://-Referenzen ohne Geheimmaterial.
    outputReference: sanitizeGovernedReference(adapterResult.outputReference, trustedSecretValues),
    artifactReferences: sanitizeGovernedReferenceList(
      adapterResult.artifactReferences,
      trustedSecretValues,
    ),
    evidenceReferences: sanitizeGovernedReferenceList(
      adapterResult.evidenceReferences,
      trustedSecretValues,
    ),
    providerExecutionMetadata: outputProviderMetadata,
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

/**
 * Fail-closed-Ergebnis der Idempotenz-Grenze (Phase 3H/3H.1): DUPLICATE oder
 * CONTEXT_CONFLICT verweigern die produktive Ausführung NACH bestehendem
 * EO-01.4 ALLOW. Kein zweiter Side Effect, kein stiller Retry. Für einen
 * blockierten Retry unter fremder Attempt-Identität wird der Besitzer der
 * logischen Operation als sanitisierte Audit-Evidenz mitgeführt (IDs only).
 */
function createIdempotencyBlockedResult(
  request: GovernedCapabilityInvocationRequest,
  provider: ProviderDeclaration,
  reason: 'INVOCATION_DUPLICATE' | 'INVOCATION_IDEMPOTENCY_CONFLICT',
  startedAt: Date,
  duplicateOfInvocationId?: string,
): GovernedCapabilityInvocationResult {
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

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
      reason,
      message: INVOCATION_FAILURE_MESSAGES[reason],
      executionOutcome: ExecutionOutcome.POLICY_BLOCKED,
      agentExecutionStatus: AgentExecutionStatus.POLICY_BLOCKED,
      retryable: false,
      providerMetadata: sanitizeProviderExecutionMetadata({
        idempotencyReason: reason,
        ...(duplicateOfInvocationId !== undefined
          ? { duplicateOfInvocationId }
          : {}),
      }),
    },
    policyDecisionReference: 'idempotency-boundary',
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

// ---------------------------------------------------------------------------
// Runtime Failure Boundary (nach EO-01.4 ALLOW, um adapter.execute())
// ---------------------------------------------------------------------------

/**
 * Konservative Abbildung eines Terminal-Status auf den Idempotenz-Claim-
 * Zustand (Phase 3H). Nur SUCCEEDED beweist einen vollständigen, gewollten
 * Side Effect; TIMED_OUT lässt den Ausgang offen (der Adapter kann weiter-
 * laufen); jeder andere Status wird als unbekannter Ausgang behandelt.
 * Es gibt KEINEN Zustand, der einen Claim freigibt.
 */
function claimStateForResultStatus(status: AgentExecutionStatus): GovernedInvocationClaimState {
  switch (status) {
    case AgentExecutionStatus.SUCCEEDED:
      return 'COMPLETED';
    case AgentExecutionStatus.TIMED_OUT:
      return 'TIMED_OUT_UNKNOWN';
    default:
      return 'FAILED_UNKNOWN';
  }
}

/**
 * Interner Marker für die EO-01.5-eigene Timeout-Grenze. Der Adapter wird
 * NICHT darauf vertraut, context.timeoutMs freiwillig zu honorieren —
 * EO-01.5 begrenzt nicht zurückkehrende Adapter selbst.
 */
class AdapterExecutionTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Adapter execution did not return within the governed time budget of ${timeoutMs}ms`);
    this.name = 'AdapterExecutionTimeoutError';
  }
}

/**
 * Normalisiert Runtime-Fehler NACH echtem EO-01.4 ALLOW zu einem audit-
 * sicheren Ergebnis auf Basis des BESTEHENDEN Vokabulars
 * (AgentExecutionStatus / ExecutionOutcome / InvocationFailureReason).
 * Kein Retry, kein Provider-Fallback, keine zweite State-Machine.
 */
function createRuntimeFailureResult(
  request: GovernedCapabilityInvocationRequest,
  provider: ProviderDeclaration,
  policyDecision: PolicyDecision,
  startedAt: Date,
  status: AgentExecutionStatus,
  message: string,
  providerMetadata?: Record<string, unknown>,
  credentialReference?: string,
): GovernedCapabilityInvocationResult {
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  const executionOutcome =
    status === AgentExecutionStatus.TIMED_OUT ? ExecutionOutcome.TIMED_OUT : undefined;

  const trustedSecretValues = credentialReference ? [credentialReference] : [];

  return {
    invocationId: request.invocationId,
    organizationId: request.organizationId,
    workflowRunId: request.workflowRunId,
    workflowStepRunId: request.workflowStepRunId,
    correlationId: request.correlationId,
    capabilityCode: request.capabilityCode,
    providerId: provider.id,
    status,
    startedAt,
    completedAt,
    durationMs,
    providerExecutionMetadata: {},
    normalizedError: {
      reason: 'EXECUTION_FAILED',
      message: redactSecretMaterial(message, trustedSecretValues),
      executionOutcome,
      agentExecutionStatus: status,
      retryable: false,
      providerMetadata: redactTrustedSecretsDeep(
        sanitizeErrorProviderMetadata(providerMetadata),
        trustedSecretValues,
      ),
    },
    policyDecisionReference: `${policyDecision.policyVersion}-${policyDecision.evaluatedAt.toISOString()}`,
    sideEffectSummary: {
      filesCreated: [],
      filesModified: [],
      filesDeleted: [],
      commandsExecuted: [],
      networkCalls: [],
      artifactsCreated: [],
    },
  };
}

/**
 * Normalisiert einen geworfenen Adapter-Fehler:
 * - EO-01.5-Timeout-Grenze → TIMED_OUT / ExecutionOutcome.TIMED_OUT
 * - sonstige Adapter-Exception → FAILED / EXECUTION_FAILED mit sicherer,
 *   gekürzter Fehlermeldung (kein Stack-/Klassen-Material).
 */
function normalizeAdapterRuntimeFailure(
  request: GovernedCapabilityInvocationRequest,
  provider: ProviderDeclaration,
  policyDecision: PolicyDecision,
  startedAt: Date,
  error: unknown,
  credentialReference?: string,
): GovernedCapabilityInvocationResult {
  if (error instanceof AdapterExecutionTimeoutError) {
    return createRuntimeFailureResult(
      request,
      provider,
      policyDecision,
      startedAt,
      AgentExecutionStatus.TIMED_OUT,
      `EXECUTION_FAILED: ${error.message}`,
      undefined,
      credentialReference,
    );
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  // Defensive Kürzung: nur die Meldung, niemals Stack oder Error-Objekt.
  // Die Leakage-Boundary redactiert Geheimmaterial aus der Meldung.
  const safeMessage =
    rawMessage.length > 2000 ? `${rawMessage.slice(0, 2000)}…` : rawMessage;

  return createRuntimeFailureResult(
    request,
    provider,
    policyDecision,
    startedAt,
    AgentExecutionStatus.FAILED,
    `EXECUTION_FAILED: Adapter execution failed: ${safeMessage}`,
    undefined,
    credentialReference,
  );
}

/**
 * Illegaler Lifecycle-Terminalstatus: Ein abgeschlossener produktiver
 * Adapter-Aufruf muss einen von RUNNING aus erreichbaren Terminalstatus
 * liefern. QUEUED/STARTING/RUNNING (bzw. jeder andere illegale Übergang)
 * wird via bestehender isValidInvocationTransition()-Semantik fail-closed
 * auf FAILED normalisiert — niemals als valides Ergebnis durchgereicht.
 */
function createIllegalLifecycleFailureResult(
  request: GovernedCapabilityInvocationRequest,
  provider: ProviderDeclaration,
  policyDecision: PolicyDecision,
  startedAt: Date,
  rejectedStatus: AgentExecutionStatus,
  credentialReference?: string,
): GovernedCapabilityInvocationResult {
  return createRuntimeFailureResult(
    request,
    provider,
    policyDecision,
    startedAt,
    AgentExecutionStatus.FAILED,
    `EXECUTION_FAILED: Adapter returned illegal non-terminal lifecycle status "${rejectedStatus}" as terminal result`,
    { rejectedLifecycleStatus: rejectedStatus },
    credentialReference,
  );
}

// ---------------------------------------------------------------------------
// Output & Error Leakage Boundary
// ---------------------------------------------------------------------------

/** Maximale Länge freier Textfelder im normalisierten Ergebnis. */
const MAX_SAFE_TEXT_LENGTH = 2000;
/** Maximale Länge einer regierten Referenz. */
const MAX_GOVERNED_REFERENCE_LENGTH = 512;
const REDACTED = '[REDACTED]';

/**
 * Bekannte Formen geheimen Materials in Freitext — unanchored, gleiche
 * Vokabular-Familie wie auditSafe() in @vito/contracts. Bewusst begrenzt
 * und explizit, kein DLP-Ersatz. Ohne /g-Flag für sicheres .test().
 */
const LEAK_SECRET_TEXT_PATTERNS: readonly RegExp[] = [
  /-----BEGIN\s+(RSA\s+)?(EC\s+)?PRIVATE\s+KEY-----[\s\S]*?(-----END\s+([A-Z0-9]+\s+)?PRIVATE\s+KEY-----|$)/,
  /\bBearer\s+[A-Za-z0-9._\-]{20,}\b/,
  /\bBasic\s+[A-Za-z0-9+/=]{20,}\b/,
  /\beyJhbGciOi[A-Za-z0-9._\-]+\.eyJ[A-Za-z0-9._\-]+/,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bgh[posr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[bpsa]-[A-Za-z0-9\-]{10,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
];

function containsSecretMaterial(
  value: string,
  trustedSecretValues: readonly string[],
): boolean {
  if (
    trustedSecretValues.some((secret) => secret.length > 0 && value.includes(secret))
  ) {
    return true;
  }
  return LEAK_SECRET_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Exakte Wert-Redaction: ersetzt Vorkommen vertrauenswürdiger Geheimwerte
 * (z. B. die credentialReference dieser Invocation) unabhängig vom
 * Feldnamen. Kein Rate von Schlüsselnamen — der Wert selbst ist das Kriterium.
 */
function redactExactSecretValues(
  text: string,
  trustedSecretValues: readonly string[],
): string {
  let redacted = text;
  for (const secret of trustedSecretValues) {
    if (secret.length > 0 && redacted.includes(secret)) {
      redacted = redacted.split(secret).join(REDACTED);
    }
  }
  return redacted;
}

/**
 * Rekursive exakte Wert-Redaction für beliebig verschachtelte
 * Metadaten-Strukturen (Objekte und Arrays). Objekt-Schlüssel werden mit
 * derselben exakten Wert-Logik redactiert — die credentialReference darf
 * weder als Wert noch als Schlüssel entweichen. Kollisionen nach der
 * Schlüssel-Redaction werden kollisions-sicher aufgelöst: der erste
 * Eintrag gewinnt deterministisch, attacker-kontrollierte Duplikate werden
 * verworfen statt zu überschreiben. Date-Instanzen und primitive
 * Nicht-Strings bleiben unverändert.
 */
function redactTrustedSecretsDeep<T>(value: T, trustedSecretValues: readonly string[]): T {
  if (typeof value === 'string') {
    return redactExactSecretValues(value, trustedSecretValues) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactTrustedSecretsDeep(entry, trustedSecretValues)) as unknown as T;
  }
  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof Date)
  ) {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const safeKey = redactExactSecretValues(key, trustedSecretValues);
      if (Object.prototype.hasOwnProperty.call(output, safeKey)) {
        continue;
      }
      output[safeKey] = redactTrustedSecretsDeep(entry, trustedSecretValues);
    }
    return output as unknown as T;
  }
  return value;
}

/**
 * Redactiert Geheimmaterial aus freiem Text:
 * 1. exakte vertrauenswürdige Werte (z. B. die credentialReference dieser
 *    Invocation — niemals selbst persistiert),
 * 2. bekannte Geheim-Materialformen,
 * 3. Längenbegrenzung.
 * Deterministisch; es wird nie der Rohwert geloggt.
 */
function redactSecretMaterial(
  text: string,
  trustedSecretValues: readonly string[],
): string {
  let redacted = redactExactSecretValues(text, trustedSecretValues);
  for (const pattern of LEAK_SECRET_TEXT_PATTERNS) {
    redacted = redacted.replace(new RegExp(pattern.source, `${pattern.flags}g`), REDACTED);
  }
  if (redacted.length > MAX_SAFE_TEXT_LENGTH) {
    redacted = `${redacted.slice(0, MAX_SAFE_TEXT_LENGTH)}…`;
  }
  return redacted;
}

/**
 * Regierte Referenzen sind opake gov://-Referenzen (bestehende
 * Repository-Konvention). Fail-closed: beliebige provider-kontrollierte
 * Strings oder Referenzen mit Geheimmaterial werden verworfen — niemals
 * durchgereicht.
 */
function sanitizeGovernedReference(
  value: string | undefined | null,
  trustedSecretValues: readonly string[],
): string | undefined {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  if (
    value.length === 0 ||
    value.length > MAX_GOVERNED_REFERENCE_LENGTH ||
    !/^gov:\/\/[A-Za-z0-9._~:/?#%-]+$/.test(value)
  ) {
    return undefined;
  }
  if (containsSecretMaterial(value, trustedSecretValues)) {
    return undefined;
  }
  return value;
}

function sanitizeGovernedReferenceList(
  values: readonly string[] | undefined,
  trustedSecretValues: readonly string[],
): readonly string[] {
  if (!values) {
    return [];
  }
  return values.flatMap((value) => {
    const sanitized = sanitizeGovernedReference(value, trustedSecretValues);
    return sanitized === undefined ? [] : [sanitized];
  });
}

function sanitizeSideEffectTextList(
  values: readonly string[] | undefined,
  trustedSecretValues: readonly string[],
): readonly string[] {
  if (!values) {
    return [];
  }
  return values.map((value) => redactSecretMaterial(String(value), trustedSecretValues));
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

    // Phase 3H Fail-closed: consequential Aktionen ohne trusted
    // Idempotenz-Store können Duplicate-Safety nicht beweisen und dürfen
    // adapter.execute() nie erreichen (Timeout != Cancellation).
    if (
      isConsequentialExecutionAction(request.requestedAction) &&
      !this.dependencies.idempotencyStore
    ) {
      throw new Error(
        'IDEMPOTENCY_STORE_MISSING: Consequential invocation requires a trusted idempotency store',
      );
    }

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

    // Phase 3H/3H.1/3H.2 Claim-Gate: so spät wie möglich, unmittelbar vor
    // dem einzigen produktiven adapter.execute(). Identitäts-Trennung:
    // - ATTEMPT IDENTITY: request.invocationId (Besitzer-/Audit-Evidenz)
    // - LOGICAL OPERATION IDENTITY: trusted abgeleiteter Operationsschlüssel
    //   OHNE Ausführungsmechanismus-Felder (Provider/Profil/Assurance) —
    //   dafür MIT autoritativer Ziel-Referenz (requestedPath/requestedCommand)
    //   und inputReference. Ein Retry mit neuer invocationId ODER anderem
    //   Provider auf derselben Operation ist DUPLICATE.
    // - GOVERNED CONTEXT FINGERPRINT: vollständige Kontextbindung inkl.
    //   Mechanismus-Felder; Differenzen sind Forensik-Evidenz, niemals
    //   Ausführungsberechtigung.
    let executionClaimed = false;
    let claimedLogicalOperationKey: string | undefined;
    // F1 Freeze-Blocker-Korrektur: Die Claim-Grenze gilt AUSSCHLIESSLICH für
    // Aktionen, die die kanonische Vertragshilfsfunktion
    // isConsequentialExecutionAction() als consequential klassifiziert
    // (CONSEQUENTIAL_INVOCATION_ACTIONS). Lese-Aktionen (READ_FILE/GIT_READ)
    // erwerben keinen Claim und kollidieren nicht als DUPLICATE — auch wenn
    // ein trusted Store injiziert ist. Keine zweite Aktionsliste, keine
    // duplizierte Klassifikation.
    if (
      isConsequentialExecutionAction(request.requestedAction) &&
      this.dependencies.idempotencyStore
    ) {
      const contextFingerprint = buildGovernedInvocationFingerprint({
        organizationId: request.organizationId,
        workflowRunId: request.workflowRunId,
        workflowStepRunId: request.workflowStepRunId,
        capabilityCode: request.capabilityCode,
        providerId: provider.id,
        requestedAction: request.requestedAction,
        executionProfile,
        assuranceLevel: request.assuranceLevel,
        inputReference: request.inputReference,
      });
      const logicalOperationKey = buildGovernedLogicalOperationKey({
        organizationId: request.organizationId,
        workflowRunId: request.workflowRunId,
        workflowStepRunId: request.workflowStepRunId,
        capabilityCode: request.capabilityCode,
        requestedAction: request.requestedAction,
        requestedPath: request.requestedPath,
        requestedCommand: request.requestedCommand,
        inputReference: request.inputReference,
      });

      let claimResult: Awaited<ReturnType<GovernedInvocationIdempotencyStore['claim']>>;
      try {
        claimResult = await this.dependencies.idempotencyStore.claim(
          logicalOperationKey,
          request.invocationId,
          contextFingerprint,
        );
      } catch (error) {
        this.logger.warn(
          `Governed idempotency claim failed for ${request.invocationId}: ${String(error)}`,
        );
        return this.finalizeInvocation(
          request,
          provider,
          executionProfile,
          createRuntimeFailureResult(
            request,
            provider,
            policyDecision,
            startedAt,
            AgentExecutionStatus.FAILED,
            `EXECUTION_FAILED: Governed idempotency claim failed: ${INVOCATION_FAILURE_MESSAGES.INVOCATION_DUPLICATE}`,
            undefined,
            executionContext.credentialReference,
          ),
          false,
          undefined,
        );
      }

      if (claimResult.outcome === 'DUPLICATE') {
        // Audit-Unterscheidung (Phase 3H.1): Blockierter Retry unter fremder
        // Attempt-Identität trägt den Besitzer der logischen Operation als
        // sanitisierte Evidenz (IDs only, keine Payload).
        return this.finalizeInvocation(
          request,
          provider,
          executionProfile,
          createIdempotencyBlockedResult(
            request,
            provider,
            'INVOCATION_DUPLICATE',
            startedAt,
            claimResult.existing.invocationId !== request.invocationId
              ? claimResult.existing.invocationId
              : undefined,
          ),
          false,
          undefined,
        );
      }
      if (claimResult.outcome === 'CONTEXT_CONFLICT') {
        return this.finalizeInvocation(
          request,
          provider,
          executionProfile,
          createIdempotencyBlockedResult(
            request,
            provider,
            'INVOCATION_IDEMPOTENCY_CONFLICT',
            startedAt,
          ),
          false,
          undefined,
        );
      }
      executionClaimed = true;
      claimedLogicalOperationKey = logicalOperationKey;
    }

    // Runtime Failure Boundary: ALLES nach echtem EO-01.4 ALLOW wird
    // normalisiert — Timeout, Adapter-Exception, illegaler Lifecycle-Status.
    // Kein Retry, kein Provider-Fallback, keine zweite State-Machine.

    let adapterResult: GovernedAdapterResult;
    try {
      adapterResult = await this.invokeAdapterWithTimeout(adapter, adapterRequest, executionContext);
    } catch (error) {
      return this.finalizeInvocation(
        request,
        provider,
        executionProfile,
        normalizeAdapterRuntimeFailure(
          request,
          provider,
          policyDecision,
          startedAt,
          error,
          executionContext.credentialReference,
        ),
        executionClaimed,
        claimedLogicalOperationKey,
      );
    }

    // Lifecycle-Enforcement über die bestehende Transition-Semantik:
    // nur von RUNNING aus erreichbare Terminalstatus sind gültige
    // Abschlusszustände einer produktiven Invocation.
    if (!isValidInvocationTransition(AgentExecutionStatus.RUNNING, adapterResult.status)) {
      return this.finalizeInvocation(
        request,
        provider,
        executionProfile,
        createIllegalLifecycleFailureResult(
          request,
          provider,
          policyDecision,
          startedAt,
          adapterResult.status,
          executionContext.credentialReference,
        ),
        executionClaimed,
        claimedLogicalOperationKey,
      );
    }

    const completedAt = new Date();

        const result = normalizeAdapterResult(
          request,
          provider,
          policyDecision,
          adapterResult,
          startedAt,
          completedAt,
          executionContext.credentialReference,
        );

    return this.finalizeInvocation(
      request,
      provider,
      executionProfile,
      result,
      executionClaimed,
      claimedLogicalOperationKey,
    );
  }

  /**
   * Führt adapter.execute() unter EO-01.5-eigener Zeitbegrenzung aus.
   * Der Adapter wird NICHT darauf vertraut, context.timeoutMs freiwillig zu
   * honorieren: ein nicht zurückkehrender Adapter wird von dieser Grenze
   * deterministisch terminiert. Genau ein Aufruf, kein Retry, kein Fallback.
   */
  private async invokeAdapterWithTimeout(
    adapter: GovernedProviderAdapter,
    adapterRequest: GovernedAdapterRequest,
    context: GovernedExecutionContext,
  ): Promise<GovernedAdapterResult> {
    const execution = adapter.execute(adapterRequest, context);

    // Verhindert unhandled rejection, falls die Timeout-Grenze das Rennen
    // gegen eine später rejectende Adapter-Promise gewinnt.
    void execution.catch(() => undefined);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new AdapterExecutionTimeoutError(context.timeoutMs)),
        context.timeoutMs,
      );
    });

    try {
      return await Promise.race([execution, timeoutPromise]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Konsistente audit-sichere Completion-Semantik für ALLE Terminalpfade
   * nach bestehendem EO-01.4 ALLOW (Phase 3H): Erfolg, Runtime-Fehler,
   * illegaler Lifecycle-Status und Idempotenz-Verweigerung.
   *
   * markCompleted wird NUR ausgeführt, wenn dieser Aufruf den Claim selbst
   * gesetzt hat (executionClaimed) — ein raced-out später Adapter-Abschluss
   * oder ein Duplikat-Versuch manipuliert den Claim nie. Die Zuweisung
   * adressiert den Claim über (logicalOperationKey, invocationId); der
   * Store vollzieht ausschließlich dem Besitzer nach (Ownership wird nie
   * übertragen). Die Abbildung ist bewusst konservativ: Timeout ist keine
   * Cancellation (TIMED_OUT_UNKNOWN), jeder andere Nicht-Erfolg ist
   * FAILED_UNKNOWN — Claims werden NIE freigegeben. Best-effort: ein
   * Store-Fehler maskiert niemals das eigentliche Invocation-Ergebnis.
   */
  private async finalizeInvocation(
    request: GovernedCapabilityInvocationRequest,
    provider: ProviderDeclaration,
    executionProfile: ExecutionProfile,
    result: GovernedCapabilityInvocationResult,
    markCompletion: boolean,
    logicalOperationKey?: string,
  ): Promise<GovernedCapabilityInvocationResult> {
    if (
      markCompletion &&
      this.dependencies.idempotencyStore &&
      logicalOperationKey !== undefined
    ) {
      try {
        await this.dependencies.idempotencyStore.markCompleted(
          logicalOperationKey,
          request.invocationId,
          claimStateForResultStatus(result.status),
        );
      } catch (error) {
        this.logger.warn(
          `Governed idempotency completion marking failed for ${request.invocationId}: ${String(error)}`,
        );
      }
    }

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
    // Phase 3H.3 Fail-closed: widersprüchliche Aktions-/Ziel-Feld-Kombinationen
    // werden abgewiesen, bevor Provider-Auflösung, Policy oder Idempotenz-
    // Claim erreicht werden. Irrelevante Felder dürfen weder die logische
    // Operations-Identität verschieben noch stillschweigend toleriert werden.
    if (isFileMutationExecutionAction(request.requestedAction) && request.requestedCommand !== undefined) {
      throw new Error(
        'MALFORMED_INVOCATION: requestedCommand is not authoritative for file mutation actions',
      );
    }
    if (
      request.requestedAction === ExecutionAction.RUN_COMMAND &&
      request.requestedPath !== undefined
    ) {
      throw new Error('MALFORMED_INVOCATION: requestedPath is not authoritative for RUN_COMMAND');
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

    // Stale-Routing-/TOCTOU-Schutz: Die CURRENT Declaration muss unmittelbar
    // vor produktiver Ausführung weiterhin vollständig eligibility-geeignet
    // sein. isProviderRoutable() deckt Status/Health ab; die QUOTA-Semantik
    // von EO-01.3 (EXHAUSTED ineligible, UNKNOWN fail-closed,
    // AVAILABLE/LIMITED routbar) wird hier deterministisch nachgeprüft.
    // Historische Routing-Auswahl ist KEIN Execution-Permission-Token.
    if (
      provider.quotaStatus === ProviderQuotaStatus.EXHAUSTED ||
      provider.quotaStatus === ProviderQuotaStatus.UNKNOWN
    ) {
      throw new Error(
        `PROVIDER_NOT_ELIGIBLE: Provider quota status ${provider.quotaStatus} is not eligible for productive invocation`,
      );
    }

    // Assurance-Revalidation mit der bestehenden EO-01.3-Semantik
    // (providerSupportsAssuranceLevel): leere assuranceLevels bleiben
    // kompatibel; explizite Level verlangen Mitgliedschaft.
    if (
      request.assuranceLevel !== undefined &&
      !providerSupportsAssuranceLevel(provider, request.assuranceLevel)
    ) {
      throw new Error(
        `PROVIDER_NOT_ELIGIBLE: Provider does not support the requested assurance level ${request.assuranceLevel}`,
      );
    }

    // Budget-/Kosten-Revalidation gemäß EO-01.3 Phase-6-Semantik:
    // nur explizite estimatedCostMinorUnits sind monetäre Authorität —
    // costScore ist und bleibt reines Ranking-Signal.
    const maxCostMinorUnits = request.executionBudget.maxCostMinorUnits;
    if (maxCostMinorUnits !== undefined) {
      const estimatedCost = provider.estimatedCostMinorUnits;
      if (estimatedCost === undefined || estimatedCost === null) {
        throw new Error(
          'PROVIDER_NOT_ELIGIBLE: Provider estimated cost is unknown while an execution budget is bounded',
        );
      }
      if (estimatedCost > maxCostMinorUnits) {
        throw new Error(
          `PROVIDER_NOT_ELIGIBLE: Provider estimated cost ${estimatedCost} exceeds the bounded execution budget of ${maxCostMinorUnits}`,
        );
      }
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