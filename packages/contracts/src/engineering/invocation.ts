/**
 * EO-01.5 — Governed Capability Invocation & Provider Adapter Boundary
 *
 * Core invariant: Routing eligibility != execution permission != execution.
 * All three must remain separate.
 *
 * EO-01.3 remains the routing authority.
 * EO-01.4 evaluatePolicy() remains the mandatory execution-policy authority.
 * No adapter execution may occur before an EO-01.4 ALLOW decision.
 */

import { ExecutionProfile, ExecutionAction, PolicyEvaluationContext, PolicyDecision, PolicyReasonCode, ExecutionOutcome, ReleaseGateStatus } from './execution-policy.js';
import type { ExecutionPolicyConfig } from './execution-policy.js';
import type { ExecutionBudget } from './execution.js';
import type { ProviderDeclaration, ProviderType } from './provider-registry.js';
import { AgentExecutionStatus } from './execution.js';

// ---------------------------------------------------------------------------
// Invocation Failure Reason Codes
// ---------------------------------------------------------------------------

/**
 * Maschinenlesbare Fehlergründe für Governed Capability Invocation.
 * Diese sind KEIN neuer Lifecycle-Status, sondern Reason-Codes, die auf
 * AgentExecutionStatus und ExecutionOutcome abgebildet werden.
 */
export type InvocationFailureReason =
  | 'PROVIDER_UNAVAILABLE'
  | 'ADAPTER_NOT_REGISTERED'
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'PROVIDER_NOT_ELIGIBLE'
  | 'INVOCATION_INVALID'
  | 'EXECUTION_FAILED'
  | 'CAPABILITY_PROVIDER_MISMATCH'
  | 'ORGANIZATION_MISMATCH'
  | 'UNKNOWN_ADAPTER_TYPE'
  | 'UNKNOWN_PROVIDER_TYPE'
  | 'MALFORMED_INVOCATION'
  | 'HUMAN_GATE_NOT_BOUND'
  | 'HUMAN_GATE_EXPIRED'
  | 'HUMAN_GATE_CONTEXT_MISMATCH'
  | 'EXECUTABLE_NOT_TRUSTED'
  | 'ENVIRONMENT_NOT_ALLOWED'
  | 'CREDENTIAL_INJECTION_FAILED'
  | 'POLICY_BLOCKED'
  | 'WORKING_DIRECTORY_NOT_GOVERNED'
  | 'EXECUTION_PROFILE_NOT_GOVERNED';

export const INVOCATION_FAILURE_MESSAGES: Record<InvocationFailureReason, string> = {
  PROVIDER_UNAVAILABLE: 'Provider ist aktuell nicht verfügbar',
  ADAPTER_NOT_REGISTERED: 'Kein Adapter für den Provider-Typ registriert',
  CAPABILITY_NOT_SUPPORTED: 'Provider unterstützt die angeforderte Capability nicht',
  PROVIDER_NOT_ELIGIBLE: 'Provider ist nicht routing-berechtigt (Status/Health/Quota)',
  INVOCATION_INVALID: 'Invocation-Request ist ungültig oder unvollständig',
  EXECUTION_FAILED: 'Adapter-Ausführung ist fehlgeschlagen',
  CAPABILITY_PROVIDER_MISMATCH: 'Capability und Provider stimmen nicht überein',
  ORGANIZATION_MISMATCH: 'Provider gehört nicht zur anfragenden Organisation',
  UNKNOWN_ADAPTER_TYPE: 'Unbekannter Adapter-Typ',
  UNKNOWN_PROVIDER_TYPE: 'Unbekannter Provider-Typ',
  MALFORMED_INVOCATION: 'Invocation-Request ist fehlerhaft strukturiert',
  HUMAN_GATE_NOT_BOUND: 'Human-Gate-Genehmigung ist nicht an den Invocation-Kontext gebunden',
  HUMAN_GATE_EXPIRED: 'Human-Gate-Genehmigung ist abgelaufen',
  HUMAN_GATE_CONTEXT_MISMATCH: 'Human-Gate-Genehmigung passt nicht zum Invocation-Kontext',
  EXECUTABLE_NOT_TRUSTED: 'Ausführbare Datei kann nicht als vertrauenswürdig verifiziert werden',
  ENVIRONMENT_NOT_ALLOWED: 'Angeforderte Umgebungsvariablen sind nicht in der Allowlist',
  CREDENTIAL_INJECTION_FAILED: 'Credential-Injektion am Adapter-Boundary fehlgeschlagen',
  POLICY_BLOCKED: 'Ausführung durch Policy verweigert',
  WORKING_DIRECTORY_NOT_GOVERNED: 'Kein regierter Arbeitsverzeichnis-Kontext verfügbar',
  EXECUTION_PROFILE_NOT_GOVERNED: 'Kein vertrauenswürdiger Execution-Profile-Kontext auflösbar (Fail-closed)',
};

// ---------------------------------------------------------------------------
// Governed Capability Invocation Request
// ---------------------------------------------------------------------------

/**
 * Strongly typed Governed Capability Invocation Request.
 *
 * Does NOT include raw credentials.
 * Does NOT include unrestricted process environment.
 * Does NOT assume provider eligibility implies execution permission.
 * Does NOT include caller-supplied policyDecision.
 * Does NOT include weak string-only policy authority.
 * Does NOT include caller-authoritative HumanGateBinding (authority bypass).
 * Does NOT include caller-controlled homeDir (path security bypass).
 * Contains only the minimum strongly typed information needed to construct
 * PolicyEvaluationContext internally.
 *
 * executionProfile is a NON-AUTHORITATIVE requested-profile hint retained for
 * compatibility only. It MUST NOT authorize execution: the effective
 * ExecutionProfile is established exclusively by the trusted
 * ExecutionProfileResolver before policy resolution/evaluation.
 */
export interface GovernedCapabilityInvocationRequest {
  readonly invocationId: string;
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly correlationId: string;
  readonly capabilityCode: string;
  readonly providerId: string;
  /**
   * Non-authoritative requested-profile hint (compatibility only).
   * Authorization uses ONLY the trusted ExecutionProfileResolver result.
   */
  readonly executionProfile: ExecutionProfile;
  readonly assuranceLevel?: string;
  readonly inputReference?: string;
  readonly governedInputPayload?: Record<string, unknown>;
  readonly executionBudget: ExecutionBudget;
  readonly requestedAction: ExecutionAction;
  readonly requestedPath?: string;
  readonly requestedCommand?: string;
  readonly humanApprovalReference?: string;
  readonly requestedAt: Date;
}

/**
 * Human Gate Approval Binding.
 * Must be bound to the specific invocation context.
 * A generic APPROVED boolean is NOT sufficient.
 */
export interface HumanGateBinding {
  readonly approvalId: string;
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly capabilityCode: string;
  readonly providerId?: string;
  readonly artifactReference?: string;
  readonly inputReference?: string;
  readonly approverIdentity: string;
  readonly approvedAt: Date;
  readonly expiresAt?: Date;
  readonly validityContext?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Adapter Boundary Contracts
// ---------------------------------------------------------------------------

/**
 * Minimal environment contract for adapter execution.
 * Adapters MUST NOT inherit unrestricted process environment by default.
 */
export interface GovernedExecutionEnvironment {
  readonly allowlist: ReadonlyMap<string, string>;
  readonly workingDirectory: string;
}

/**
 * Trusted executable resolution for command-backed adapters.
 * A safe command name MUST NOT be sufficient authorization if the executable
 * implementation can be replaced by the same actor controlling the worktree.
 */
export interface TrustedExecutable {
  readonly commandName: string;
  readonly resolvedPath: string;
  readonly integrityHash?: string;
  readonly verifiedAt: Date;
}

/**
 * Governed execution context passed to adapters.
 * Contains ONLY already-approved, policy-validated context.
 * Adapters MUST NOT decide authorization.
 * Adapters MUST receive an already-approved governed execution context.
 * Adapters MUST NOT silently elevate permissions.
 * Adapters MUST NOT perform fallback routing themselves.
 */
export interface GovernedExecutionContext {
  readonly invocationId: string;
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly correlationId: string;
  readonly capabilityCode: string;
  readonly providerId: string;
  readonly providerType: ProviderType;
  readonly executionProfile: ExecutionProfile;
  readonly assuranceLevel?: string;
  readonly executionBudget: ExecutionBudget;
  readonly policyDecision: PolicyDecision;
  readonly environment: GovernedExecutionEnvironment;
  readonly trustedExecutable?: TrustedExecutable;
  readonly credentialReference?: string;
  readonly startedAt: Date;
  readonly timeoutMs: number;
}

/**
 * Request passed to the adapter's execute method.
 * Contains the domain-specific input (referenced or governed payload).
 */
export interface GovernedAdapterRequest {
  readonly inputReference?: string;
  readonly governedInputPayload?: Record<string, unknown>;
}

/**
 * Normalized result envelope from adapter execution.
 * Domain output may be returned by governed artifact/reference;
 * VITO must not need to understand the full domain payload schema.
 */
export interface GovernedAdapterResult {
  readonly status: AgentExecutionStatus;
  readonly outputReference?: string;
  readonly artifactReferences?: readonly string[];
  readonly evidenceReferences?: readonly string[];
  readonly providerExecutionMetadata: Record<string, unknown>;
  readonly usageMetadata?: Record<string, unknown>;
  readonly error?: AdapterError;
  readonly completedAt: Date;
}

/**
 * Normalized adapter error information.
 */
export interface AdapterError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly providerMetadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Governed Provider Adapter Interface
// ---------------------------------------------------------------------------

/**
 * Provider adapter interface.
 * Adapters MUST NOT decide authorization.
 * Adapters MUST receive an already-approved governed execution context.
 * Adapters MUST NOT silently elevate permissions.
 * Adapters MUST NOT perform fallback routing themselves.
 * Provider fallback remains an orchestration/router concern.
 */
export interface GovernedProviderAdapter {
  readonly providerType: ProviderType;

  /**
   * Execute the capability through this provider.
   * Precondition: EO-01.4 policy evaluation has returned ALLOW.
   * The context contains only already-validated, governed execution parameters.
   */
  execute(
    request: GovernedAdapterRequest,
    context: GovernedExecutionContext,
  ): Promise<GovernedAdapterResult>;
}

// ---------------------------------------------------------------------------
// Adapter Registry
// ---------------------------------------------------------------------------

/**
 * Adapter registration entry.
 */
export interface AdapterRegistration {
  readonly providerType: ProviderType;
  readonly adapter: GovernedProviderAdapter;
  readonly registeredAt: Date;
  readonly version: string;
}

/**
 * Adapter registry for looking up adapters by provider type.
 * Fail closed for unknown adapter/provider type.
 */
export interface GovernedAdapterRegistry {
  register(registration: AdapterRegistration): void;
  get(providerType: ProviderType): GovernedProviderAdapter | undefined;
  has(providerType: ProviderType): boolean;
  getSupportedProviderTypes(): readonly ProviderType[];
}

// ---------------------------------------------------------------------------
// Governed Capability Invocation Result
// ---------------------------------------------------------------------------

/**
 * Normalized result envelope for governed capability invocation.
 * Preserves workflowRunId, workflowStepRunId and correlationId end-to-end.
 * Domain output may be referenced through governed artifacts or typed domain payloads.
 */
export interface GovernedCapabilityInvocationResult {
  readonly invocationId: string;
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly correlationId: string;
  readonly capabilityCode: string;
  readonly providerId: string;
  readonly status: AgentExecutionStatus;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly durationMs: number;
  readonly outputReference?: string;
  readonly artifactReferences?: readonly string[];
  readonly evidenceReferences?: readonly string[];
  readonly providerExecutionMetadata: Record<string, unknown>;
  readonly normalizedError?: InvocationError;
  readonly policyDecisionReference: string;
  readonly sideEffectSummary?: SideEffectSummary;
  readonly usageMetadata?: Record<string, unknown>;
}

/**
 * Normalized error information for invocation result.
 * Maps to existing AgentExecutionStatus and ExecutionOutcome vocabulary.
 */
export interface InvocationError {
  readonly reason: InvocationFailureReason;
  readonly message: string;
  readonly executionOutcome?: ExecutionOutcome;
  readonly agentExecutionStatus?: AgentExecutionStatus;
  readonly retryable: boolean;
  readonly providerMetadata?: Record<string, unknown>;
}

/**
 * Summary of governed side effects from invocation.
 */
export interface SideEffectSummary {
  readonly filesCreated: readonly string[];
  readonly filesModified: readonly string[];
  readonly filesDeleted: readonly string[];
  readonly commandsExecuted: readonly string[];
  readonly networkCalls?: readonly NetworkCallSummary[];
  readonly artifactsCreated?: readonly string[];
}

/**
 * Network call summary for audit.
 */
export interface NetworkCallSummary {
  readonly destination: string;
  readonly method: string;
  readonly statusCode?: number;
  readonly timestamp: Date;
}

// ---------------------------------------------------------------------------
// Sandbox Configuration (v0.1 — Remote Execution Worker)
// ---------------------------------------------------------------------------

/**
 * Sandbox configuration for governed execution.
 * Technology is constrained to 'bubblewrap' in production; 'none' is
 * permitted only in development/test environments with explicit opt-in.
 */
export interface GovernedSandboxConfig {
  readonly technology: 'bubblewrap' | 'none';
  readonly timeoutMs: number;
  readonly maxMemoryBytes: number;
  readonly maxCpuTimeMs: number;
  readonly maxWorktreeBytes: number;
  readonly extraEnvAllowlist?: ReadonlyMap<string, string>;
  readonly readOnlyMounts?: ReadonlyArray<{
    readonly hostPath: string;
    readonly guestPath: string;
  }>;
}

/**
 * Result envelope from sandbox execution.
 */
export interface SandboxExecutionResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly oomKilled: boolean;
  readonly sandboxLog?: string;
}

// ---------------------------------------------------------------------------
// Invocation Lifecycle State Transitions
// ---------------------------------------------------------------------------

/**
 * Valid state transitions for AgentExecutionStatus during governed invocation.
 * EO-01.5 MUST NOT introduce a second execution state machine.
 * Reuses existing AgentExecutionStatus vocabulary.
 * State transitions MUST remain explicit and fail closed.
 * Illegal transitions MUST reject.
 */
export const VALID_INVOCATION_TRANSITIONS: ReadonlyMap<AgentExecutionStatus, readonly AgentExecutionStatus[]> = new Map([
  [AgentExecutionStatus.QUEUED, [AgentExecutionStatus.STARTING, AgentExecutionStatus.CANCELLED, AgentExecutionStatus.POLICY_BLOCKED]],
  [AgentExecutionStatus.STARTING, [AgentExecutionStatus.RUNNING, AgentExecutionStatus.FAILED, AgentExecutionStatus.CANCELLED, AgentExecutionStatus.POLICY_BLOCKED]],
  [AgentExecutionStatus.RUNNING, [AgentExecutionStatus.SUCCEEDED, AgentExecutionStatus.FAILED, AgentExecutionStatus.TIMED_OUT, AgentExecutionStatus.CANCELLED, AgentExecutionStatus.QUOTA_BLOCKED]],
  [AgentExecutionStatus.SUCCEEDED, []],
  [AgentExecutionStatus.FAILED, []],
  [AgentExecutionStatus.TIMED_OUT, []],
  [AgentExecutionStatus.CANCELLED, []],
  [AgentExecutionStatus.POLICY_BLOCKED, []],
  [AgentExecutionStatus.QUOTA_BLOCKED, []],
]);

/**
 * Check if a state transition is valid.
 */
export function isValidInvocationTransition(
  from: AgentExecutionStatus,
  to: AgentExecutionStatus,
): boolean {
  const allowed = VALID_INVOCATION_TRANSITIONS.get(from);
  return allowed ? allowed.includes(to) : false;
}

/**
 * Map invocation failure reason to AgentExecutionStatus.
 */
export function invocationFailureToStatus(reason: InvocationFailureReason): AgentExecutionStatus {
  switch (reason) {
    case 'PROVIDER_UNAVAILABLE':
    case 'ADAPTER_NOT_REGISTERED':
    case 'CAPABILITY_NOT_SUPPORTED':
    case 'PROVIDER_NOT_ELIGIBLE':
    case 'ORGANIZATION_MISMATCH':
    case 'UNKNOWN_ADAPTER_TYPE':
    case 'UNKNOWN_PROVIDER_TYPE':
    case 'MALFORMED_INVOCATION':
    case 'INVOCATION_INVALID':
    case 'CAPABILITY_PROVIDER_MISMATCH':
    case 'EXECUTABLE_NOT_TRUSTED':
    case 'ENVIRONMENT_NOT_ALLOWED':
    case 'CREDENTIAL_INJECTION_FAILED':
    case 'WORKING_DIRECTORY_NOT_GOVERNED':
      return AgentExecutionStatus.FAILED;
    case 'EXECUTION_FAILED':
      return AgentExecutionStatus.FAILED;
    case 'HUMAN_GATE_NOT_BOUND':
    case 'HUMAN_GATE_EXPIRED':
    case 'HUMAN_GATE_CONTEXT_MISMATCH':
    case 'EXECUTION_PROFILE_NOT_GOVERNED':
    case 'POLICY_BLOCKED':
      return AgentExecutionStatus.POLICY_BLOCKED;
    default:
      return AgentExecutionStatus.FAILED;
  }
}

/**
 * Map invocation failure reason to ExecutionOutcome.
 */
export function invocationFailureToOutcome(reason: InvocationFailureReason): ExecutionOutcome | null {
  switch (reason) {
    case 'HUMAN_GATE_NOT_BOUND':
    case 'HUMAN_GATE_EXPIRED':
    case 'HUMAN_GATE_CONTEXT_MISMATCH':
    case 'EXECUTION_PROFILE_NOT_GOVERNED':
    case 'POLICY_BLOCKED':
      return ExecutionOutcome.POLICY_BLOCKED;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Trusted Execution Policy Resolution (EO-01.4 Handoff)
// ---------------------------------------------------------------------------

/**
 * Trusted context for execution-policy resolution.
 * Contains ONLY trusted identifiers/context — never caller-supplied
 * policy authority (no policy config, no PolicyDecision, no allow flags).
 */
export interface ExecutionPolicyResolutionContext {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly capabilityCode: string;
  readonly providerId: string;
  readonly executionProfile: ExecutionProfile;
  readonly requestedAction: ExecutionAction;
}

/**
 * Trusted source for the ExecutionPolicyConfig consumed by EO-01.4
 * evaluatePolicy().
 *
 * Der Invocation-Caller DARF keine Policy-Authorität liefern. Die Auflösung
 * erfolgt ausschließlich über diese injizierte, vertrauenswürdige Abstraktion.
 *
 * Fail closed:
 * - fehlender Resolver,
 * - null-Rückgabe,
 * - oder eine Exception des Resolvers
 * müssen die Ausführung VOR adapter.execute() verhindern.
 */
export interface ExecutionPolicyResolver {
  resolve(context: ExecutionPolicyResolutionContext): Promise<ExecutionPolicyConfig | null>;
}

// ---------------------------------------------------------------------------
// Trusted Execution Profile Resolution
// ---------------------------------------------------------------------------

/**
 * Trusted context for authoritative ExecutionProfile resolution.
 * Contains ONLY trusted runtime/workflow identifiers — never caller-supplied
 * authority (no profile claim, no allow flags, no decision objects).
 */
export interface ExecutionProfileResolutionContext {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly capabilityCode: string;
  readonly providerId: string;
}

/**
 * Trusted source for the AUTHORITATIVE ExecutionProfile.
 *
 * Der Invocation-Caller DARF das effektive ExecutionProfile NICHT bestimmen.
 * Ein caller-kontrolliertes executionProfile-Feld im Request ist höchstens ein
 * nicht-autoritativer Hinweis; die autoritative Profil-Authorität entsteht
 * ausschließlich über diese injizierte, vertrauenswürdige Abstraktion
 * (z. B. aus Workflow-Step-Run-Bindung / Runtime-Kontext).
 *
 * Fail closed:
 * - fehlender Resolver,
 * - null-Rückgabe,
 * - ungültiger/nicht unterstützter Rückgabewert,
 * - oder eine Exception des Resolvers
 * müssen die produktive Ausführung VOR adapter.execute() verhindern.
 */
export interface ExecutionProfileResolver {
  resolve(context: ExecutionProfileResolutionContext): Promise<ExecutionProfile | null>;
}

// ---------------------------------------------------------------------------
// Credential Injection Abstraction
// ---------------------------------------------------------------------------

/**
 * Credential injection interface.
 * Provider credentials:
 * - MUST NOT enter model/task prompts
 * - MUST NOT be persisted in PolicyDecision
 * - MUST NOT be emitted in adapter result
 * - MUST NOT be copied into audit events
 * - MUST be injected only at the adapter boundary
 * - MUST be minimum-scope
 * - MUST be provider-specific
 *
 * EO-01.5 does not need a full secret broker.
 * Use an interface/abstraction that allows a future secret broker without
 * redesigning the invocation contract.
 * Missing trusted credential resolution must be representable as fail-closed.
 */
export interface CredentialBroker {
  /**
   * Get a credential reference for the adapter to use.
   * The actual credential value is NEVER returned directly.
   * Returns a reference/token that the adapter can use to fetch the credential
   * at execution time within its isolated boundary.
   * Returns null if no trusted credential can be resolved (fail-closed).
   */
  getCredentialReference(providerId: string, organizationId: string): Promise<string | null>;

  /**
   * Validate that a credential reference is still valid.
   */
  validateCredentialReference(reference: string): Promise<boolean>;
}

/**
 * Trusted executable resolver.
 * A command name alone is NOT sufficient for trusted executable identity.
 * Implementations must verify executable integrity and provenance.
 * Fail closed when trust cannot be established.
 */
export interface TrustedExecutableResolver {
  /**
   * Resolve a requested command to a verified TrustedExecutable.
   * Returns null when trust cannot be established (fail-closed).
   */
  resolve(
    requestedCommand: string,
    context: {
      readonly organizationId: string;
      readonly workflowRunId: string;
      readonly capabilityCode: string;
      readonly providerId: string;
    },
  ): Promise<TrustedExecutable | null>;
}

/**
 * Working directory resolver.
 * The execution working directory must come from explicitly governed,
 * validated runtime context. Do not inherit unrestricted process environment.
 */
export interface WorkingDirectoryResolver {
  /**
   * Resolve the governed working directory for an invocation.
   * Returns null when no governed working directory can be established (fail-closed).
   */
  resolve(
    context: {
      readonly organizationId: string;
      readonly workflowRunId: string;
      readonly workflowStepRunId: string;
      readonly capabilityCode: string;
      readonly providerId: string;
    },
  ): Promise<string | null>;
}

/**
 * Human Gate Resolver.
 * Resolves a human approval reference to a trusted HumanGateBinding from an
 * authoritative store. The caller MUST NOT provide the binding directly.
 * A reference is NOT itself approval — it must be resolved against a trusted
 * authority that validates context binding, expiry, and authenticity.
 */
export interface HumanGateResolver {
  /**
   * Resolve a human approval reference to a trusted HumanGateBinding.
   * Returns null when no valid approval can be resolved (fail-closed).
   * The returned binding must be validated against invocation context by the caller.
   */
  resolve(
    reference: string,
    context: {
      readonly organizationId: string;
      readonly workflowRunId: string;
      readonly workflowStepRunId: string;
      readonly capabilityCode: string;
      readonly providerId: string;
      readonly inputReference?: string;
    },
  ): Promise<HumanGateBinding | null>;
}

/**
 * Metadata sanitizer for provider execution metadata.
 * Removes secret-like values to prevent accidental leakage at adapter boundary.
 * Fail-closed: prefer minimal safe metadata over broad pass-through.
 */
export function sanitizeProviderExecutionMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  const secretKeyPatterns = [
    /authorization/i,
    /bearer/i,
    /token/i,
    /apikey/i,
    /api_key/i,
    /password/i,
    /secret/i,
    /private[_-]?key/i,
    /jwt/i,
    /connection[_-]?string/i,
    /credential/i,
    /access[_-]?key/i,
    /secret[_-]?key/i,
  ];

  const secretValuePatterns = [
    /^[A-Za-z0-9+/=_]{40,}$/, // base64-like long strings
    /^Bearer\s+[A-Za-z0-9._\-]{20,}$/i,
    /^Basic\s+[A-Za-z0-9+/=]{20,}$/i,
    /^eyJhbGciOi[A-Za-z0-9._\-]+\.eyJ[A-Za-z0-9._\-]+/, // JWT
    /^sk_live_[A-Za-z0-9]{20,}$/,
    /^pk_live_[A-Za-z0-9]{20,}$/,
    /^ghp_[A-Za-z0-9]{20,}$/,
    /^gho_[A-Za-z0-9]{20,}$/,
    /^xox[bpsa]-[A-Za-z0-9\-]{10,}$/,
    /^AKIA[A-Z0-9]{16}$/,
    /^-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
    /^-----BEGIN\s+CERTIFICATE-----/,
  ];

  function isSecretKey(key: string): boolean {
    return secretKeyPatterns.some((pattern) => pattern.test(key));
  }

  function isSecretValue(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return secretValuePatterns.some((pattern) => pattern.test(value));
  }

  function sanitizeValue(key: string, value: unknown): unknown {
    if (isSecretKey(key)) {
      return '[REDACTED]';
    }
    if (isSecretValue(value)) {
      return '[REDACTED]';
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return sanitizeProviderExecutionMetadata(value as Record<string, unknown>);
    }
    if (Array.isArray(value)) {
      return value.map((v) => sanitizeValue(key, v));
    }
    return value;
  }

  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key] = sanitizeValue(key, value);
  }

  return sanitized;
}

/**
 * Sanitize error provider metadata as well.
 */
export function sanitizeErrorProviderMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  return sanitizeProviderExecutionMetadata(metadata);
}

/**
 * Validates a HumanGateBinding against the invocation context.
 * Returns the effective ReleaseGateStatus derived from the binding.
 * Returns ReleaseGateStatus.NOT_REQUESTED when no valid binding exists.
 */
export function validateHumanGateBinding(
  binding: HumanGateBinding | null | undefined,
  context: {
    readonly organizationId: string;
    readonly workflowRunId: string;
    readonly workflowStepRunId: string;
    readonly capabilityCode: string;
    readonly providerId: string;
    readonly inputReference?: string;
  },
): ReleaseGateStatus {

  if (!binding) {
    return ReleaseGateStatus.NOT_REQUESTED;
  }

  // Validate organization binding
  if (binding.organizationId !== context.organizationId) {
    return ReleaseGateStatus.NOT_REQUESTED;
  }

  // Validate workflow run binding
  if (binding.workflowRunId !== context.workflowRunId) {
    return ReleaseGateStatus.NOT_REQUESTED;
  }

  // Validate workflow step run binding
  if (binding.workflowStepRunId !== context.workflowStepRunId) {
    return ReleaseGateStatus.NOT_REQUESTED;
  }

  // Validate capability binding
  if (binding.capabilityCode !== context.capabilityCode) {
    return ReleaseGateStatus.NOT_REQUESTED;
  }

  // Validate provider binding if present in binding
  if (binding.providerId && binding.providerId !== context.providerId) {
    return ReleaseGateStatus.NOT_REQUESTED;
  }

  // Validate input reference binding if present in binding
  if (binding.inputReference && binding.inputReference !== context.inputReference) {
    return ReleaseGateStatus.NOT_REQUESTED;
  }

  // Validate expiry
  if (binding.expiresAt && binding.expiresAt < new Date()) {
    return ReleaseGateStatus.NOT_REQUESTED;
  }

  // All validations passed - binding is valid for this invocation context
  return ReleaseGateStatus.APPROVED;
}
