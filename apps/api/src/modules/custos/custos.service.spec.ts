import { CustosService } from './custos.service';
import {
  CustosAutonomyEnvelope,
  CustosAutonomyLevel,
  CustosDecision,
} from './custos.types';

describe('CustosService', () => {
  const service = new CustosService();
  const now = new Date('2026-09-11T08:00:00.000Z');

  const envelope: CustosAutonomyEnvelope = {
    envelopeId: 'env-1',
    actorId: 'riccardo',
    missionId: 'research-1',
    maxAutonomyLevel: CustosAutonomyLevel.A3E_EMERGENCY,
    allowedCapabilities: ['research.read', 'worker.spawn', 'runtime.contain'],
    allowedResourcePrefixes: ['web/public', 'workers/research', 'runtime/service-a'],
    allowedEnvironments: ['SANDBOX', 'STAGING', 'PRODUCTION'],
    maxWorkers: 50,
    expiresAt: new Date('2026-09-11T10:00:00.000Z'),
  };

  it('allows A0-A2 work in the fast zone after envelope boundary checks', () => {
    const result = service.authorize(envelope, {
      actorId: 'riccardo',
      missionId: 'research-1',
      capability: 'research.read',
      resource: 'web/public/source-1',
      environment: 'SANDBOX',
      autonomyLevel: CustosAutonomyLevel.A2_EXPERIMENT,
      now,
    });

    expect(result.decision).toBe(CustosDecision.ALLOW);
    expect(result.code).toBe('ALLOW_FAST_ZONE');
  });

  it('fails closed when purpose binding does not match', () => {
    const result = service.authorize(envelope, {
      actorId: 'riccardo',
      missionId: 'other-mission',
      capability: 'research.read',
      resource: 'web/public/source-1',
      environment: 'SANDBOX',
      autonomyLevel: CustosAutonomyLevel.A1_THINK,
      now,
    });

    expect(result.decision).toBe(CustosDecision.DENY);
    expect(result.code).toBe('DENY_MISSION_MISMATCH');
  });

  it('enforces child capability ceiling', () => {
    const result = service.authorize(envelope, {
      actorId: 'riccardo',
      missionId: 'research-1',
      capability: 'worker.spawn',
      resource: 'workers/research/worker-1',
      environment: 'SANDBOX',
      autonomyLevel: CustosAutonomyLevel.A3_ACT,
      parentAutonomyLevel: CustosAutonomyLevel.A2_EXPERIMENT,
      now,
    });

    expect(result.decision).toBe(CustosDecision.DENY);
    expect(result.code).toBe('DENY_CAPABILITY_CEILING');
  });

  it('enforces bounded worker scaling', () => {
    const result = service.authorize(envelope, {
      actorId: 'riccardo',
      missionId: 'research-1',
      capability: 'worker.spawn',
      resource: 'workers/research',
      environment: 'SANDBOX',
      autonomyLevel: CustosAutonomyLevel.A2_EXPERIMENT,
      requestedWorkers: 51,
      now,
    });

    expect(result.decision).toBe(CustosDecision.DENY);
    expect(result.code).toBe('DENY_WORKER_BUDGET');
  });

  it('allows only containment actions under emergency authority', () => {
    const result = service.authorize(envelope, {
      actorId: 'riccardo',
      missionId: 'research-1',
      capability: 'runtime.contain',
      resource: 'runtime/service-a',
      environment: 'PRODUCTION',
      autonomyLevel: CustosAutonomyLevel.A3E_EMERGENCY,
      emergency: true,
      emergencyAction: 'FREEZE',
      now,
    });

    expect(result.decision).toBe(CustosDecision.ALLOW);
    expect(result.code).toBe('ALLOW_EMERGENCY_CONTAINMENT');
  });

  it('never allows an agent to mutate governance', () => {
    const result = service.authorize(envelope, {
      actorId: 'riccardo',
      missionId: 'research-1',
      capability: 'research.read',
      resource: 'web/public/source-1',
      environment: 'SANDBOX',
      autonomyLevel: CustosAutonomyLevel.A0_OBSERVE,
      governanceMutation: true,
      now,
    });

    expect(result.decision).toBe(CustosDecision.DENY);
    expect(result.code).toBe('DENY_GOVERNANCE_MUTATION');
  });

  it('escalates A4 critical actions without human approval', () => {
    const criticalEnvelope: CustosAutonomyEnvelope = {
      ...envelope,
      maxAutonomyLevel: CustosAutonomyLevel.A4_CRITICAL,
    };

    const result = service.authorize(criticalEnvelope, {
      actorId: 'riccardo',
      missionId: 'research-1',
      capability: 'runtime.contain',
      resource: 'runtime/service-a',
      environment: 'PRODUCTION',
      autonomyLevel: CustosAutonomyLevel.A4_CRITICAL,
      now,
    });

    expect(result.decision).toBe(CustosDecision.ESCALATE);
    expect(result.code).toBe('ESCALATE_A4_HUMAN_GATE');
  });

  it('fails closed on expired envelopes', () => {
    const result = service.authorize(envelope, {
      actorId: 'riccardo',
      missionId: 'research-1',
      capability: 'research.read',
      resource: 'web/public/source-1',
      environment: 'SANDBOX',
      autonomyLevel: CustosAutonomyLevel.A0_OBSERVE,
      now: new Date('2026-09-11T10:00:00.000Z'),
    });

    expect(result.decision).toBe(CustosDecision.DENY);
    expect(result.code).toBe('DENY_EXPIRED_ENVELOPE');
  });
});
