export enum CustosAutonomyLevel {
  A0_OBSERVE = 0,
  A1_THINK = 1,
  A2_EXPERIMENT = 2,
  A3_ACT = 3,
  A3E_EMERGENCY = 4,
  A4_CRITICAL = 5,
}

export enum CustosDecision {
  ALLOW = 'ALLOW',
  DENY = 'DENY',
  ESCALATE = 'ESCALATE',
}

export type CustosEnvironment = 'LOCAL' | 'SANDBOX' | 'STAGING' | 'PRODUCTION';

export type CustosEmergencyAction =
  | 'STOP'
  | 'ISOLATE'
  | 'FREEZE'
  | 'BACKUP'
  | 'FAILOVER'
  | 'ROLLBACK'
  | 'REVOKE_TEMPORARY_ACCESS'
  | 'RATE_LIMIT';

export interface CustosAutonomyEnvelope {
  readonly envelopeId: string;
  readonly actorId: string;
  readonly missionId: string;
  readonly maxAutonomyLevel: CustosAutonomyLevel;
  readonly allowedCapabilities: readonly string[];
  readonly allowedResourcePrefixes: readonly string[];
  readonly allowedEnvironments: readonly CustosEnvironment[];
  readonly maxWorkers?: number;
  readonly expiresAt: Date;
}

export interface CustosAuthorizationRequest {
  readonly actorId: string;
  readonly missionId: string;
  readonly capability: string;
  readonly resource: string;
  readonly environment: CustosEnvironment;
  readonly autonomyLevel: CustosAutonomyLevel;
  readonly parentAutonomyLevel?: CustosAutonomyLevel;
  readonly requestedWorkers?: number;
  readonly governanceMutation?: boolean;
  readonly emergency?: boolean;
  readonly emergencyAction?: CustosEmergencyAction;
  readonly humanApproval?: boolean;
  readonly now?: Date;
}

export interface CustosAuthorizationResult {
  readonly decision: CustosDecision;
  readonly code:
    | 'ALLOW_FAST_ZONE'
    | 'ALLOW_ENVELOPE'
    | 'ALLOW_EMERGENCY_CONTAINMENT'
    | 'DENY_GOVERNANCE_MUTATION'
    | 'DENY_EXPIRED_ENVELOPE'
    | 'DENY_ACTOR_MISMATCH'
    | 'DENY_MISSION_MISMATCH'
    | 'DENY_CAPABILITY'
    | 'DENY_RESOURCE'
    | 'DENY_ENVIRONMENT'
    | 'DENY_CAPABILITY_CEILING'
    | 'DENY_WORKER_BUDGET'
    | 'DENY_INVALID_EMERGENCY'
    | 'ESCALATE_A4_HUMAN_GATE';
  readonly reason: string;
}
