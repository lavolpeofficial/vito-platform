import { Injectable } from '@nestjs/common';

import {
  CustosAuthorizationRequest,
  CustosAuthorizationResult,
  CustosAutonomyEnvelope,
  CustosAutonomyLevel,
  CustosDecision,
  CustosEmergencyAction,
} from './custos.types';

const EMERGENCY_CONTAINMENT_ACTIONS = new Set<CustosEmergencyAction>([
  'STOP',
  'ISOLATE',
  'FREEZE',
  'BACKUP',
  'FAILOVER',
  'ROLLBACK',
  'REVOKE_TEMPORARY_ACCESS',
  'RATE_LIMIT',
]);

@Injectable()
export class CustosService {
  authorize(
    envelope: CustosAutonomyEnvelope,
    request: CustosAuthorizationRequest,
  ): CustosAuthorizationResult {
    const now = request.now ?? new Date();

    if (request.governanceMutation) {
      return this.deny(
        'DENY_GOVERNANCE_MUTATION',
        'Agents may not mutate Constitution, Root of Trust, CUSTOS policy authority, or audit controls.',
      );
    }

    if (now.getTime() >= envelope.expiresAt.getTime()) {
      return this.deny('DENY_EXPIRED_ENVELOPE', 'The autonomy envelope has expired.');
    }

    if (request.actorId !== envelope.actorId) {
      return this.deny('DENY_ACTOR_MISMATCH', 'The envelope is bound to another actor.');
    }

    if (request.missionId !== envelope.missionId) {
      return this.deny('DENY_MISSION_MISMATCH', 'The capability is purpose-bound to another mission.');
    }

    if (!envelope.allowedCapabilities.includes(request.capability)) {
      return this.deny('DENY_CAPABILITY', 'The requested capability is outside the autonomy envelope.');
    }

    if (!this.resourceAllowed(envelope.allowedResourcePrefixes, request.resource)) {
      return this.deny('DENY_RESOURCE', 'The requested resource is outside the envelope scope.');
    }

    if (!envelope.allowedEnvironments.includes(request.environment)) {
      return this.deny('DENY_ENVIRONMENT', 'The requested environment is outside the envelope scope.');
    }

    if (
      request.parentAutonomyLevel !== undefined &&
      request.autonomyLevel > request.parentAutonomyLevel
    ) {
      return this.deny(
        'DENY_CAPABILITY_CEILING',
        'Child authority may never exceed parent authority.',
      );
    }

    if (request.autonomyLevel > envelope.maxAutonomyLevel) {
      return this.deny(
        'DENY_CAPABILITY_CEILING',
        'The requested autonomy level exceeds the envelope ceiling.',
      );
    }

    if (
      request.requestedWorkers !== undefined &&
      envelope.maxWorkers !== undefined &&
      request.requestedWorkers > envelope.maxWorkers
    ) {
      return this.deny('DENY_WORKER_BUDGET', 'The requested worker count exceeds the mission budget.');
    }

    if (request.autonomyLevel === CustosAutonomyLevel.A4_CRITICAL && !request.humanApproval) {
      return {
        decision: CustosDecision.ESCALATE,
        code: 'ESCALATE_A4_HUMAN_GATE',
        reason: 'A4 critical authority requires explicit human approval.',
      };
    }

    if (request.autonomyLevel === CustosAutonomyLevel.A3E_EMERGENCY) {
      if (
        !request.emergency ||
        !request.emergencyAction ||
        !EMERGENCY_CONTAINMENT_ACTIONS.has(request.emergencyAction)
      ) {
        return this.deny(
          'DENY_INVALID_EMERGENCY',
          'Emergency authority is restricted to approved containment actions.',
        );
      }

      return {
        decision: CustosDecision.ALLOW,
        code: 'ALLOW_EMERGENCY_CONTAINMENT',
        reason: 'Emergency containment is allowed without expanding authority.',
      };
    }

    if (request.autonomyLevel <= CustosAutonomyLevel.A2_EXPERIMENT) {
      return {
        decision: CustosDecision.ALLOW,
        code: 'ALLOW_FAST_ZONE',
        reason: 'A0-A2 action is inside the pre-authorized fast zone.',
      };
    }

    return {
      decision: CustosDecision.ALLOW,
      code: 'ALLOW_ENVELOPE',
      reason: 'The action is inside the active mission-bound autonomy envelope.',
    };
  }

  private resourceAllowed(prefixes: readonly string[], resource: string): boolean {
    return prefixes.some((prefix) => resource === prefix || resource.startsWith(`${prefix}/`));
  }

  private deny(
    code: Exclude<
      CustosAuthorizationResult['code'],
      'ALLOW_FAST_ZONE' | 'ALLOW_ENVELOPE' | 'ALLOW_EMERGENCY_CONTAINMENT' | 'ESCALATE_A4_HUMAN_GATE'
    >,
    reason: string,
  ): CustosAuthorizationResult {
    return { decision: CustosDecision.DENY, code, reason };
  }
}
