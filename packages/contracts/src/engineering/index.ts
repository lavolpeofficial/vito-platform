/**
 * @vito/contracts/engineering
 *
 * Providerunabhängige Contracts und State Machine für den
 * VITO Governed Multi-Agent Engineering Runtime.
 */

export { EngineeringCapability } from './capabilities.js';
export {
  ExecutionTier,
  isCloudGovernedProviderType,
  resolveExecutionTier,
  toValidatedCloudExecutionProfile,
  CLOUD_EXECUTION_PROFILE_MIN_DURATION_MS,
  CLOUD_EXECUTION_PROFILE_MAX_DURATION_MS,
  CLOUD_EXECUTION_PROFILE_MAX_PARALLELISM,
  type CloudExecutionProfile,
} from './execution-tier.js';
export { AssuranceLevel } from './assurance.js';
export {
  WorkflowRunStatus,
  WorkflowStepStatus,
  EngineeringStepType,
} from './workflow.js';
export {
  ReviewVerdict,
  resolveReviewerDisagreement,
  type ReviewFinding,
  type ReviewFindingSeverity,
  type ReviewFindingCategory,
  type ReviewResult,
  type DisagreementResolution,
} from './review.js';
export {
  AgentExecutionStatus,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
  type ExecutionBudget,
  type IndependenceContext,
  type AssuranceUnsatisfiedReason,
} from './execution.js';
export {
  type ExecutionPermissionPolicy,
  createDefaultEngineeringPermissionPolicy,
} from './permissions.js';
export { ExecutionArtifactType } from './artifacts.js';
export {
  nextEngineeringStep,
  checkAl4Independence,
  type StateMachineInput,
  type TransitionOutcome,
  type BlockReason,
} from './state-machine.js';
export {
  ProviderStatus,
  ProviderHealthStatus,
  ProviderQuotaStatus,
  ProviderType,
  ProviderCredentialRequirement,
  providerSupportsCapability,
  providerSupportsAssuranceLevel,
  isProviderRoutable,
  type ProviderDeclaration,
  type ProviderCapabilityAssignment,
} from './provider-registry.js';
export {
  OperatorTaskStatus,
  type OperatorTaskError,
} from './operator-bridge.js';
export {
  RoutingRejectionReason,
  ROUTING_REJECTION_MESSAGES,
  EligibilityPhase,
  DEFAULT_ROUTING_SCORE_WEIGHTS,
  ROUTING_POLICY_VERSION,
  type ProviderRoutingRequest,
  type ProviderRoutingResponse,
  type ProviderScoreComponents,
  type RoutingCandidate,
  type ProviderRoutingDecisionRecord,
  type RoutingScoreWeights,
} from './provider-router.js';
export {
  ExecutionProfile,
  ExecutionAction,
  PolicyReasonCode,
  POLICY_REASON_MESSAGES,
  ReleaseGateStatus,
  ExecutionOutcome,
  evaluatePolicy,
  createBuilderPolicy,
  createReviewerPolicy,
  policyDecisionToOutcome,
  auditSafe,
  type PolicyDecision,
  type ExecutionPolicyConfig,
  type PolicyEvaluationContext,
} from './execution-policy.js';
export {
  SANDBOX_SYSTEM_MANAGED_ENV,
  SANDBOX_PROCESS_COMPATIBILITY_ENV,
  SANDBOX_GOVERNED_EXECUTION_METADATA_ENV,
  SANDBOX_CALLER_PERMITTED_ENV,
  SANDBOX_ENV_ALLOWLIST,
} from './sandbox-environment.js';
export {
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
  AdapterRegistration,
  CredentialBroker,
  HumanGateBinding,
  SideEffectSummary,
  NetworkCallSummary,
  isValidInvocationTransition,
  invocationFailureToStatus,
  invocationFailureToOutcome,
  type InvocationError,
  type ExecutionPolicyResolutionContext,
  type ExecutionProfileResolutionContext,
  TrustedExecutableResolver,
  WorkingDirectoryResolver,
  HumanGateResolver,
  CONSEQUENTIAL_INVOCATION_ACTIONS,
  isConsequentialExecutionAction,
  FILE_MUTATION_INVOCATION_ACTIONS,
  isFileMutationExecutionAction,
  buildGovernedInvocationFingerprint,
  buildGovernedLogicalOperationKey,
  GovernedInvocationIdempotencyStore,
  ExecutionPolicyResolver,
  ExecutionProfileResolver,
  validateHumanGateBinding,
  sanitizeProviderExecutionMetadata,
  sanitizeErrorProviderMetadata,
  GovernedSandboxConfig,
  SandboxExecutionResult,
  type GovernedContextIdentityFields,
  type GovernedOperationIdentityFields,
  type GovernedInvocationClaimState,
  type GovernedInvocationExecutionClaim,
  type GovernedInvocationClaimResult,
} from './invocation.js';
