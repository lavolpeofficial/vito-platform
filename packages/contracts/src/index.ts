/**
 * @vito/contracts
 *
 * Framework-unabhängige, geteilte Typen/Enums der VITO Digital Workforce
 * Platform. Dient als stabiler Vertrag für zukünftige externe Clients und
 * Adapter (ERPNext, Odoo, Gmail, GitHub, ...). Enthält bewusst KEINE
 * ERP-/CRM-spezifischen Modelle.
 */

export enum OrganizationStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  ARCHIVED = 'ARCHIVED',
}

export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INVITED = 'INVITED',
  SUSPENDED = 'SUSPENDED',
}

export enum DigitalEmployeeStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ARCHIVED = 'ARCHIVED',
}

export enum EmployeeType {
  ORCHESTRATOR = 'ORCHESTRATOR',
  SPECIALIST = 'SPECIALIST',
  ASSISTANT = 'ASSISTANT',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum TaskStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING = 'WAITING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum TaskPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum ActorType {
  USER = 'USER',
  DIGITAL_EMPLOYEE = 'DIGITAL_EMPLOYEE',
  SYSTEM = 'SYSTEM',
}

export const TENANT_HEADER = 'x-organization-id';

// --- Engineering Runtime Contracts ---
export {
  EngineeringCapability,
  AssuranceLevel,
  WorkflowRunStatus,
  WorkflowStepStatus,
  EngineeringStepType,
  ReviewVerdict,
  resolveReviewerDisagreement,
  AgentExecutionStatus,
  DEFAULT_RETRY_POLICY,
  ExecutionArtifactType,
  createDefaultEngineeringPermissionPolicy,
  nextEngineeringStep,
  checkAl4Independence,
  ProviderStatus,
  ProviderHealthStatus,
  ProviderQuotaStatus,
  ProviderType,
  ProviderCredentialRequirement,
  providerSupportsCapability,
  providerSupportsAssuranceLevel,
  isProviderRoutable,
  RoutingRejectionReason,
  ROUTING_REJECTION_MESSAGES,
  EligibilityPhase,
  DEFAULT_ROUTING_SCORE_WEIGHTS,
  ROUTING_POLICY_VERSION,
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
  TrustedExecutableResolver,
  WorkingDirectoryResolver,
  HumanGateResolver,
  CONSEQUENTIAL_INVOCATION_ACTIONS,
  isConsequentialExecutionAction,
  buildGovernedInvocationFingerprint,
  GovernedInvocationIdempotencyStore,
  ExecutionPolicyResolver,
  ExecutionProfileResolver,
  validateHumanGateBinding,
  sanitizeProviderExecutionMetadata,
  sanitizeErrorProviderMetadata,
  type GovernedInvocationClaimState,
  type GovernedInvocationExecutionClaim,
  type GovernedInvocationClaimResult,
  type ReviewFinding,
  type ReviewFindingSeverity,
  type ReviewFindingCategory,
  type ReviewResult,
  type DisagreementResolution,
  type RetryPolicy,
  type ExecutionBudget,
  type IndependenceContext,
  type AssuranceUnsatisfiedReason,
  type ExecutionPermissionPolicy,
  type StateMachineInput,
  type TransitionOutcome,
  type BlockReason,
  type ProviderDeclaration,
  type ProviderCapabilityAssignment,
  type ProviderRoutingRequest,
  type ProviderRoutingResponse,
  type ProviderScoreComponents,
  type RoutingCandidate,
  type ProviderRoutingDecisionRecord,
  type RoutingScoreWeights,
  type PolicyDecision,
  type ExecutionPolicyConfig,
  type PolicyEvaluationContext,
  type InvocationError,
  type ExecutionPolicyResolutionContext,
  type ExecutionProfileResolutionContext,
} from './engineering/index.js';
