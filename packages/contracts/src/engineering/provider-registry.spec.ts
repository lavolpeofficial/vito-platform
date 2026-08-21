/**
 * Unit Tests für die Provider-Registry/Routing Contracts (EO-01.3 Correction 02).
 *
 * Korrektur 02 Invarianten:
 *  - Durable ProviderCapability Assignments sind die Routing-Authorität
 *  - Legacy supportedCapabilities JSON ist NICHT mehr autoritativ
 *  - COST_UNKNOWN / QUOTA_STATUS_UNKNOWN Reason Codes existieren (fail-closed)
 *  - estimatedCostMinorUnits ist Teil der ProviderDeclaration
 */

import {
  providerSupportsCapability,
  isProviderRoutable,
  ProviderStatus,
  ProviderHealthStatus,
  type ProviderDeclaration,
} from './provider-registry.js';
import {
  ROUTING_REJECTION_MESSAGES,
  ROUTING_POLICY_VERSION,
  EligibilityPhase,
} from './provider-router.js';

function makeDeclaration(overrides: Partial<ProviderDeclaration> = {}): ProviderDeclaration {
  return {
    id: 'provider-1',
    organizationId: 'org-1',
    providerCode: 'TEST_PROVIDER',
    displayName: 'Test Provider',
    providerType: 'CLOUD_LLM' as any,
    status: ProviderStatus.ACTIVE,
    supportedCapabilities: [],
    capabilityAssignments: [{ capabilityCode: 'CODE_BUILD', isEnabled: true }],
    healthStatus: ProviderHealthStatus.HEALTHY,
    quotaStatus: 'AVAILABLE' as any,
    costMetadata: {},
    assuranceLevels: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('durable capability assignment authority', () => {
  it('enabled assignment => provider supports capability', () => {
    const provider = makeDeclaration();
    expect(providerSupportsCapability(provider, 'CODE_BUILD')).toBe(true);
  });

  it('disabled assignment => provider does NOT support capability', () => {
    const provider = makeDeclaration({
      capabilityAssignments: [{ capabilityCode: 'CODE_BUILD', isEnabled: false }],
    });
    expect(providerSupportsCapability(provider, 'CODE_BUILD')).toBe(false);
  });

  it('missing assignment => provider does NOT support capability', () => {
    const provider = makeDeclaration({ capabilityAssignments: [] });
    expect(providerSupportsCapability(provider, 'CODE_BUILD')).toBe(false);
  });

  it('legacy supportedCapabilities JSON alone is NOT authoritative', () => {
    const provider = makeDeclaration({
      supportedCapabilities: ['CODE_BUILD'],
      capabilityAssignments: [],
    });
    expect(providerSupportsCapability(provider, 'CODE_BUILD')).toBe(false);
  });

  it('legacy JSON cannot override disabled durable assignment', () => {
    const provider = makeDeclaration({
      supportedCapabilities: ['CODE_BUILD'],
      capabilityAssignments: [{ capabilityCode: 'CODE_BUILD', isEnabled: false }],
    });
    expect(providerSupportsCapability(provider, 'CODE_BUILD')).toBe(false);
  });
});

describe('routability policy v0.1', () => {
  it('ACTIVE + HEALTHY is routable', () => {
    expect(isProviderRoutable(makeDeclaration())).toBe(true);
  });

  it('ACTIVE + DEGRADED health is routable (with penalty at scoring)', () => {
    const provider = makeDeclaration({ healthStatus: ProviderHealthStatus.DEGRADED });
    expect(isProviderRoutable(provider)).toBe(true);
  });

  it('DISABLED status is not routable', () => {
    const provider = makeDeclaration({ status: ProviderStatus.DISABLED });
    expect(isProviderRoutable(provider)).toBe(false);
  });

  it('DEGRADED status is not routable', () => {
    const provider = makeDeclaration({ status: ProviderStatus.DEGRADED });
    expect(isProviderRoutable(provider)).toBe(false);
  });

  it('UNKNOWN/UNAVAILABLE/DISABLED/QUOTA_LIMITED health is not routable', () => {
    for (const health of [
      ProviderHealthStatus.UNKNOWN,
      ProviderHealthStatus.UNAVAILABLE,
      ProviderHealthStatus.DISABLED,
      ProviderHealthStatus.QUOTA_LIMITED,
    ]) {
      expect(isProviderRoutable(makeDeclaration({ healthStatus: health }))).toBe(false);
    }
  });
});

describe('fail-closed reason codes', () => {
  it('COST_UNKNOWN reason code exists with human-readable message', () => {
    expect(ROUTING_REJECTION_MESSAGES.COST_UNKNOWN).toBeDefined();
    expect(typeof ROUTING_REJECTION_MESSAGES.COST_UNKNOWN).toBe('string');
  });

  it('QUOTA_STATUS_UNKNOWN reason code exists with human-readable message', () => {
    expect(ROUTING_REJECTION_MESSAGES.QUOTA_STATUS_UNKNOWN).toBeDefined();
    expect(typeof ROUTING_REJECTION_MESSAGES.QUOTA_STATUS_UNKNOWN).toBe('string');
  });

  it('BUDGET and QUOTA phases exist for eligibility ordering', () => {
    expect(EligibilityPhase.BUDGET).toBe('BUDGET');
    expect(EligibilityPhase.QUOTA).toBe('QUOTA');
    expect(EligibilityPhase.STATUS_POLICY).toBe('STATUS_POLICY');
  });

  it('routing policy version remains v0.1', () => {
    expect(ROUTING_POLICY_VERSION).toBe('v0.1');
  });
});
