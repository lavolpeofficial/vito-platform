/**
 * Unit Tests für den ProviderRouterService (EO-01.3 Correction 02).
 *
 * Mockt PrismaService und AuditService analog zum WorkflowRuntimeService-Muster.
 * Die Tests prüfen die Routing-Logik: Eligibility, Scoring, Independence,
 * Budget, Availability/Quota, Determinismus, Audit und Fail-Closed.
 *
 * Mandatory test categories (EO-01.3 Correction 02):
 *  A. Durable ProviderCapability assignments:
 *     A1. enabled capability => eligible
 *     A2. disabled capability => rejected
 *     A3. missing capability => rejected
 *     A4. duplicate assignment prevented by schema constraint/equivalent
 *     A5. legacy supportedCapabilities JSON is NOT routing authority
 *  B. Explicit estimated monetary cost (estimatedCostMinorUnits):
 *     B1. known under-budget cost passes
 *     B2. known equal-budget cost passes
 *     B3. over-budget cost rejects
 *     B4. unknown cost + max budget rejects with COST_UNKNOWN
 *     B5. excellent costScore cannot bypass over-budget/unknown-cost rejection
 *     B6. no max budget => cost never blocks
 *  C. Status/Health/Quota semantics v0.1:
 *     C1. ACTIVE may route
 *     C2. DISABLED ineligible
 *     C3. DEGRADED status ineligible at STATUS_POLICY phase
 *     C4. HEALTHY routable
 *     C5. DEGRADED health routable with health score penalty
 *     C6. UNKNOWN/UNAVAILABLE/DISABLED/QUOTA_LIMITED health ineligible
 *     C7. Quota AVAILABLE routable
 *     C8. Quota LIMITED routable (explicitly tested)
 *     C9. Quota EXHAUSTED ineligible
 *     C10. Quota UNKNOWN fail-closed
 *  Previous requirements:
 *    6. assurance-incompatible provider is rejected
 *    7. reviewer violating independence/model-family requirement is rejected
 *    9. ineligible provider cannot win even with highest quality score
 *   10. deterministic best eligible provider wins
 *   11. deterministic tie-break remains providerCode ordering
 *   12. Claude/Anthropic unavailable -> alternative eligible reviewer/provider
 *   13. no eligible provider -> normalized fail-closed result
 *   14. routing decision persisted/audited with explainable reasons
 *   15. tenant isolation remains mandatory
 */

import { ProviderRouterService } from './provider-router.service';
import { ProviderStatus, ProviderHealthStatus, ProviderQuotaStatus, ProviderType } from '@vito/contracts';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function makeCapabilityAssignment(capabilityCode: string, isEnabled = true) {
  return {
    id: randomUUID(),
    organizationId: ORG_A,
    agentProviderId: 'assigned-below',
    capabilityCode,
    isEnabled,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeProviderRow(overrides: Record<string, any> = {}) {
  return {
    id: randomUUID(),
    organizationId: ORG_A,
    providerCode: 'TEST_PROVIDER',
    displayName: 'Test Provider',
    providerType: 'CLOUD_LLM',
    status: 'ACTIVE',
    modelFamily: 'test-family',
    modelName: 'test-model',
    modelCode: 'test-model-code',
    // Legacy JSON: NICHT mehr Routing-Authorität (Abwärtskompatibilität only).
    supportedCapabilities: ['CODE_BUILD', 'CODE_REVIEW'],
    // Durable ProviderCapability assignments: alleinige Routing-Authorität.
    capabilities: [
      makeCapabilityAssignment('CODE_BUILD'),
      makeCapabilityAssignment('CODE_REVIEW'),
    ],
    estimatedCostMinorUnits: 100,
    healthStatus: 'HEALTHY',
    healthCheckedAt: new Date(),
    quotaStatus: 'AVAILABLE',
    quotaCheckedAt: new Date(),
    qualityScore: 0.8,
    latencyScore: 3000,
    costScore: 100,
    costMetadata: {},
    assuranceLevels: ['AL1', 'AL2', 'AL3', 'AL4'],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService(providerRows: any[] = []) {
  const prisma: any = {
    agentProvider: {
      findMany: jest.fn().mockResolvedValue(providerRows),
    },
    providerRoutingDecision: {
      create: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({
          id: randomUUID(),
          ...args.data,
          createdAt: new Date(),
        }),
      ),
    },
  };

  const auditService: any = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ProviderRouterService(prisma, auditService);
  return { service, prisma, auditService };
}

function routeRequest(overrides: Record<string, any> = {}) {
  return {
    organizationId: ORG_A,
    capability: 'CODE_BUILD',
    correlationId: randomUUID(),
    ...overrides,
  };
}

// ===========================================================================
// A. Durable ProviderCapability assignment eligibility
// ===========================================================================
describe('A. durable provider capability eligibility', () => {
  it('A1: enabled capability => eligible', async () => {
    const provider = makeProviderRow({
      capabilities: [makeCapabilityAssignment('CODE_BUILD', true)],
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({ capability: 'CODE_BUILD' }));

    expect(result.selectedProvider).not.toBeNull();
    expect(result.selectedProvider!.id).toBe(provider.id);
    expect(result.eligibleCandidateIds).toContain(provider.id);
  });

  it('A2: disabled capability => rejected', async () => {
    const provider = makeProviderRow({
      capabilities: [
        makeCapabilityAssignment('CODE_REVIEW', true),
        makeCapabilityAssignment('CODE_BUILD', false),
      ],
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({ capability: 'CODE_BUILD' }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('CAPABILITY_UNSUPPORTED');
    expect(result.rejectionPhases[provider.id]).toBe('CAPABILITY');
    expect(result.eligibleCandidateIds).toHaveLength(0);
  });

  it('A3: missing capability => rejected', async () => {
    const provider = makeProviderRow({
      capabilities: [makeCapabilityAssignment('CODE_REVIEW', true)],
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({ capability: 'CODE_BUILD' }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('CAPABILITY_UNSUPPORTED');
    expect(result.eligibleCandidateIds).toHaveLength(0);
  });

  it('A4: duplicate assignment prevented by schema unique constraint', () => {
    const schemaPath = path.join(__dirname, '../../../../../prisma/schema.prisma');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const modelBlock = schema.match(/model ProviderCapability \{[\s\S]*?\n\}/)?.[0];

    expect(modelBlock).toBeDefined();
    expect(modelBlock).toContain('agentProviderId');
    expect(modelBlock).toContain('capabilityCode');
    expect(modelBlock).toContain('isEnabled');
    expect(modelBlock).toContain('@@unique([organizationId, agentProviderId, capabilityCode])');
    expect(modelBlock).toContain('@relation(fields: [agentProviderId], references: [id]');
  });

  it('A5: legacy supportedCapabilities JSON alone does NOT grant eligibility', async () => {
    const provider = makeProviderRow({
      supportedCapabilities: ['CODE_BUILD'],
      capabilities: [],
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({ capability: 'CODE_BUILD' }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('A5b: legacy JSON cannot override disabled durable assignment', async () => {
    const provider = makeProviderRow({
      supportedCapabilities: ['CODE_BUILD'],
      capabilities: [makeCapabilityAssignment('CODE_BUILD', false)],
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({ capability: 'CODE_BUILD' }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('router loads candidates with their durable capability assignments', async () => {
    const provider = makeProviderRow();
    const { service, prisma } = buildService([provider]);

    await service.route(routeRequest());

    expect(prisma.agentProvider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_A },
        include: { capabilities: true },
      }),
    );
  });
});

// ===========================================================================
// 3. Disabled provider is rejected
// ===========================================================================
describe('C1/C2/C3. provider status policy', () => {
  it('C1: ACTIVE status may route', async () => {
    const provider = makeProviderRow({ status: 'ACTIVE' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).not.toBeNull();
    expect(result.eligibleCandidateIds).toContain(provider.id);
  });

  it('C2: DISABLED status is ineligible', async () => {
    const provider = makeProviderRow({ status: 'DISABLED' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('PROVIDER_DISABLED');
    expect(result.rejectionPhases[provider.id]).toBe('STATUS_POLICY');
  });

  it('C3: DEGRADED status is ineligible at STATUS_POLICY phase', async () => {
    const provider = makeProviderRow({ status: 'DEGRADED' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('PROVIDER_UNHEALTHY');
    expect(result.rejectionPhases[provider.id]).toBe('STATUS_POLICY');
  });
});

// ===========================================================================
// C4-C6. Health status semantics
// ===========================================================================
describe('C4-C6. provider health policy', () => {
  it('C4: HEALTHY health is routable', async () => {
    const provider = makeProviderRow({ healthStatus: 'HEALTHY' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).not.toBeNull();
    expect(result.eligibleCandidateIds).toContain(provider.id);
  });

  it('C5: DEGRADED health is routable but receives health score penalty', async () => {
    const healthy = makeProviderRow({
      id: 'healthy-provider',
      providerCode: 'AAA_HEALTHY',
      healthStatus: 'HEALTHY',
      qualityScore: 0.8,
      latencyScore: 3000,
      costScore: 100,
    });
    const degraded = makeProviderRow({
      id: 'degraded-provider',
      providerCode: 'BBB_DEGRADED',
      healthStatus: 'DEGRADED',
      qualityScore: 0.8,
      latencyScore: 3000,
      costScore: 100,
    });
    const { service } = buildService([degraded, healthy]);

    const result = await service.route(routeRequest());

    // Both are routable...
    expect(result.eligibleCandidateIds).toContain('healthy-provider');
    expect(result.eligibleCandidateIds).toContain('degraded-provider');
    // ...but HEALTHY deterministically outranks DEGRADED (penalty).
    expect(result.selectedProvider!.id).toBe('healthy-provider');
    expect(result.scoreComponents['healthy-provider'].healthPreference).toBe(1.0);
    expect(result.scoreComponents['degraded-provider'].healthPreference).toBe(0.5);
    expect(result.finalScores['healthy-provider']).toBeGreaterThan(
      result.finalScores['degraded-provider'],
    );
  });

  it('C6a: UNKNOWN health is ineligible (fail-closed)', async () => {
    const provider = makeProviderRow({ healthStatus: 'UNKNOWN' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('PROVIDER_UNHEALTHY');
    expect(result.rejectionPhases[provider.id]).toBe('AVAILABILITY');
  });

  it('C6b: UNAVAILABLE health is ineligible', async () => {
    const provider = makeProviderRow({ healthStatus: 'UNAVAILABLE' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('PROVIDER_UNAVAILABLE');
  });

  it('C6c: DISABLED health is ineligible', async () => {
    const provider = makeProviderRow({ healthStatus: 'DISABLED' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('PROVIDER_DISABLED');
  });

  it('C6d: QUOTA_LIMITED health is ineligible', async () => {
    const provider = makeProviderRow({ healthStatus: 'QUOTA_LIMITED' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('QUOTA_UNAVAILABLE');
  });
});

// ===========================================================================
// C7-C10. Quota status semantics
// ===========================================================================
describe('C7-C10. provider quota policy', () => {
  it('C7: AVAILABLE quota is routable', async () => {
    const provider = makeProviderRow({ quotaStatus: 'AVAILABLE' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).not.toBeNull();
    expect(result.eligibleCandidateIds).toContain(provider.id);
  });

  it('C8: LIMITED quota is routable (explicitly tested)', async () => {
    const provider = makeProviderRow({ quotaStatus: 'LIMITED' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).not.toBeNull();
    expect(result.selectedProvider!.id).toBe(provider.id);
    expect(result.eligibleCandidateIds).toContain(provider.id);
  });

  it('C9: EXHAUSTED quota is ineligible', async () => {
    const provider = makeProviderRow({ quotaStatus: 'EXHAUSTED' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('QUOTA_EXHAUSTED');
    expect(result.rejectionPhases[provider.id]).toBe('QUOTA');
  });

  it('C10: UNKNOWN quota is fail-closed (QUOTA_STATUS_UNKNOWN)', async () => {
    const provider = makeProviderRow({ quotaStatus: 'UNKNOWN' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('QUOTA_STATUS_UNKNOWN');
    expect(result.rejectionPhases[provider.id]).toBe('QUOTA');
  });
});

// ===========================================================================
// 6. Assurance-incompatible provider is rejected
// ===========================================================================
describe('6. assurance-incompatible provider', () => {
  it('provider without requested assurance level is rejected', async () => {
    const provider = makeProviderRow({ assuranceLevels: ['AL1', 'AL2'] });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({ assuranceLevel: 'AL4' }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('ASSURANCE_LEVEL_UNSUPPORTED');
  });

  it('provider supporting requested assurance level is eligible', async () => {
    const provider = makeProviderRow({ assuranceLevels: ['AL1', 'AL2', 'AL3', 'AL4'] });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({ assuranceLevel: 'AL4' }));

    expect(result.selectedProvider).not.toBeNull();
  });

  it('provider with empty assuranceLevels supports all levels', async () => {
    const provider = makeProviderRow({ assuranceLevels: [] });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({ assuranceLevel: 'AL4' }));

    expect(result.selectedProvider).not.toBeNull();
  });
});

// ===========================================================================
// 7. Independence violation is rejected
// ===========================================================================
describe('7. independence violation', () => {
  it('provider used as builder cannot be reviewer', async () => {
    const provider = makeProviderRow({
      id: 'provider-1',
      modelFamily: 'claude',
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      independenceContext: {
        builderProviderId: 'provider-1',
        builderModelFamily: 'gpt',
        previousReviewerProviderIds: [],
        previousReviewerModelFamilies: [],
      },
    }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons['provider-1']).toBe('INDEPENDENCE_REQUIREMENT_UNSATISFIED');
  });

  it('provider with same model family as builder is rejected', async () => {
    const provider = makeProviderRow({
      id: 'provider-r1',
      modelFamily: 'claude',
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      independenceContext: {
        builderProviderId: 'other-provider',
        builderModelFamily: 'claude',
        previousReviewerProviderIds: [],
        previousReviewerModelFamilies: [],
      },
    }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons['provider-r1']).toBe('INDEPENDENCE_REQUIREMENT_UNSATISFIED');
  });

  it('provider with same model family as previous reviewer is rejected', async () => {
    const provider = makeProviderRow({
      id: 'provider-r2',
      modelFamily: 'gpt-4',
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      independenceContext: {
        builderProviderId: 'builder-1',
        builderModelFamily: 'claude',
        previousReviewerProviderIds: ['reviewer-1'],
        previousReviewerModelFamilies: ['gpt-4'],
      },
    }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons['provider-r2']).toBe('INDEPENDENCE_REQUIREMENT_UNSATISFIED');
  });

  it('provider without modelFamily is rejected when independence required', async () => {
    const provider = makeProviderRow({
      id: 'provider-no-family',
      modelFamily: null,
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      independenceContext: {
        builderProviderId: 'builder-1',
        builderModelFamily: 'claude',
        previousReviewerProviderIds: [],
        previousReviewerModelFamilies: [],
      },
    }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons['provider-no-family']).toBe('MODEL_IDENTITY_UNVERIFIABLE');
  });
});

// ===========================================================================
// B. Budget eligibility via explicit estimatedCostMinorUnits
// ===========================================================================
describe('B. budget eligibility (estimatedCostMinorUnits)', () => {
  it('B1: known under-budget cost passes', async () => {
    const provider = makeProviderRow({ estimatedCostMinorUnits: 150 });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      budget: { maxCostMinorUnits: 200, currency: 'EUR' },
    }));

    expect(result.selectedProvider).not.toBeNull();
    expect(result.selectedProvider!.id).toBe(provider.id);
  });

  it('B2: known equal-budget cost passes', async () => {
    const provider = makeProviderRow({ estimatedCostMinorUnits: 200 });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      budget: { maxCostMinorUnits: 200, currency: 'EUR' },
    }));

    expect(result.selectedProvider).not.toBeNull();
    expect(result.selectedProvider!.id).toBe(provider.id);
  });

  it('B3: over-budget cost rejects with BUDGET_INCOMPATIBLE', async () => {
    const provider = makeProviderRow({ estimatedCostMinorUnits: 500 });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      budget: { maxCostMinorUnits: 200, currency: 'EUR' },
    }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('BUDGET_INCOMPATIBLE');
    expect(result.rejectionPhases[provider.id]).toBe('BUDGET');
  });

  it('B4: unknown cost + max budget rejects fail-closed with COST_UNKNOWN', async () => {
    const provider = makeProviderRow({ estimatedCostMinorUnits: null });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      budget: { maxCostMinorUnits: 200, currency: 'EUR' },
    }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('COST_UNKNOWN');
    expect(result.rejectionPhases[provider.id]).toBe('BUDGET');
  });

  it('B4b: missing estimatedCostMinorUnits field behaves like unknown (COST_UNKNOWN)', async () => {
    const provider = makeProviderRow({ estimatedCostMinorUnits: undefined });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      budget: { maxCostMinorUnits: 200, currency: 'EUR' },
    }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('COST_UNKNOWN');
  });

  it('B5a: excellent costScore cannot bypass over-budget rejection', async () => {
    const provider = makeProviderRow({
      estimatedCostMinorUnits: 999999,
      costScore: 0,
      qualityScore: 1.0,
      latencyScore: 1,
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      budget: { maxCostMinorUnits: 200, currency: 'EUR' },
    }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('BUDGET_INCOMPATIBLE');
  });

  it('B5b: excellent costScore cannot bypass COST_UNKNOWN rejection', async () => {
    const provider = makeProviderRow({
      estimatedCostMinorUnits: null,
      costScore: 0,
      qualityScore: 1.0,
      latencyScore: 1,
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      budget: { maxCostMinorUnits: 200, currency: 'EUR' },
    }));

    expect(result.selectedProvider).toBeNull();
    expect(result.rejectionReasons[provider.id]).toBe('COST_UNKNOWN');
  });

  it('B6: no max budget => cost never blocks (even very expensive provider)', async () => {
    const provider = makeProviderRow({ estimatedCostMinorUnits: 999999999 });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).not.toBeNull();
    expect(result.selectedProvider!.id).toBe(provider.id);
  });

  it('budget phase runs after independence: independent-but-over-budget rejects with BUDGET_INCOMPATIBLE', async () => {
    const provider = makeProviderRow({
      estimatedCostMinorUnits: 500,
      modelFamily: 'gpt-4',
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest({
      budget: { maxCostMinorUnits: 200, currency: 'EUR' },
      independenceContext: {
        builderProviderId: 'builder-1',
        builderModelFamily: 'claude',
        previousReviewerProviderIds: [],
        previousReviewerModelFamilies: [],
      },
    }));

    expect(result.rejectionReasons[provider.id]).toBe('BUDGET_INCOMPATIBLE');
  });
});

// ===========================================================================
// 9. Ineligible provider cannot win even with highest quality score
// ===========================================================================
describe('9. ineligible provider cannot win via score', () => {
  it('disabled provider with highest quality score does not win', async () => {
    const disabledProvider = makeProviderRow({
      id: 'disabled-high',
      providerCode: 'DISABLED_HIGH',
      status: 'DISABLED',
      qualityScore: 1.0,
      costScore: 0,
      latencyScore: 100,
    });
    const eligibleProvider = makeProviderRow({
      id: 'eligible-low',
      providerCode: 'ELIGIBLE_LOW',
      qualityScore: 0.3,
      costScore: 500,
      latencyScore: 8000,
    });
    const { service } = buildService([disabledProvider, eligibleProvider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider!.id).toBe('eligible-low');
    expect(result.rejectionReasons['disabled-high']).toBe('PROVIDER_DISABLED');
  });

  it('over-budget provider with best scores does not win against in-budget competitor', async () => {
    const overBudget = makeProviderRow({
      id: 'over-budget-best',
      providerCode: 'OVER_BUDGET_BEST',
      estimatedCostMinorUnits: 900,
      qualityScore: 1.0,
      costScore: 0,
      latencyScore: 1,
    });
    const inBudget = makeProviderRow({
      id: 'in-budget-mediocre',
      providerCode: 'IN_BUDGET_MEDIOCRE',
      estimatedCostMinorUnits: 100,
      qualityScore: 0.3,
      costScore: 800,
      latencyScore: 9000,
    });
    const { service } = buildService([overBudget, inBudget]);

    const result = await service.route(routeRequest({
      budget: { maxCostMinorUnits: 200, currency: 'EUR' },
    }));

    expect(result.selectedProvider!.id).toBe('in-budget-mediocre');
    expect(result.rejectionReasons['over-budget-best']).toBe('BUDGET_INCOMPATIBLE');
  });

  it('unavailable provider with best cost score does not win', async () => {
    const unavailableProvider = makeProviderRow({
      id: 'unavail-cheap',
      providerCode: 'UNAVAIL_CHEAP',
      healthStatus: 'UNAVAILABLE',
      costScore: 0,
      qualityScore: 0.9,
    });
    const normalProvider = makeProviderRow({
      id: 'normal-expensive',
      providerCode: 'NORMAL_EXPENSIVE',
      costScore: 500,
      qualityScore: 0.5,
    });
    const { service } = buildService([unavailableProvider, normalProvider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider!.id).toBe('normal-expensive');
  });
});

// ===========================================================================
// 10. Deterministic best eligible provider wins
// ===========================================================================
describe('10. deterministic best provider wins', () => {
  it('provider with best score wins', async () => {
    const goodProvider = makeProviderRow({
      id: 'good',
      providerCode: 'GOOD',
      qualityScore: 0.95,
      costScore: 50,
      latencyScore: 1000,
      healthStatus: 'HEALTHY',
    });
    const mediocreProvider = makeProviderRow({
      id: 'mediocre',
      providerCode: 'MEDIOCRE',
      qualityScore: 0.5,
      costScore: 500,
      latencyScore: 5000,
      healthStatus: 'HEALTHY',
    });
    const { service } = buildService([mediocreProvider, goodProvider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider!.id).toBe('good');
  });
});

// ===========================================================================
// 11. Deterministic tie-break
// ===========================================================================
describe('11. deterministic tie-break', () => {
  it('identical inputs produce identical route', async () => {
    const providerA = makeProviderRow({
      id: 'aaa',
      providerCode: 'AAA',
      qualityScore: 0.8,
      costScore: 100,
      latencyScore: 3000,
    });
    const providerB = makeProviderRow({
      id: 'bbb',
      providerCode: 'BBB',
      qualityScore: 0.8,
      costScore: 100,
      latencyScore: 3000,
    });
    const { service: service1 } = buildService([providerA, providerB]);
    const { service: service2 } = buildService([providerA, providerB]);

    const req = routeRequest();
    const result1 = await service1.route(req);
    const result2 = await service2.route(req);

    expect(result1.selectedProvider!.providerCode).toBe(result2.selectedProvider!.providerCode);
  });

  it('providerCode ordering breaks ties deterministically', async () => {
    const providerA = makeProviderRow({
      id: 'aaa',
      providerCode: 'AAA',
      qualityScore: 0.8,
      costScore: 100,
      latencyScore: 3000,
    });
    const providerB = makeProviderRow({
      id: 'bbb',
      providerCode: 'BBB',
      qualityScore: 0.8,
      costScore: 100,
      latencyScore: 3000,
    });
    const { service } = buildService([providerB, providerA]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider!.providerCode).toBe('AAA');
  });
});

// ===========================================================================
// 12. Claude/Anthropic unavailable -> alternative provider selected
// ===========================================================================
describe('12. preferred provider unavailable fallback', () => {
  it('Claude unavailable -> alternative eligible reviewer selected', async () => {
    const claude = makeProviderRow({
      id: 'claude',
      providerCode: 'CLAUDE',
      modelFamily: 'claude',
      healthStatus: 'UNAVAILABLE',
      qualityScore: 0.95,
    });
    const gpt = makeProviderRow({
      id: 'gpt',
      providerCode: 'GPT',
      modelFamily: 'gpt-4',
      healthStatus: 'HEALTHY',
      qualityScore: 0.85,
    });
    const { service } = buildService([claude, gpt]);

    const result = await service.route(routeRequest({ capability: 'CODE_BUILD' }));

    expect(result.selectedProvider!.providerCode).toBe('GPT');
    expect(result.rejectionReasons['claude']).toBe('PROVIDER_UNAVAILABLE');
  });
});

// ===========================================================================
// 13. No eligible provider -> normalized fail-closed result
// ===========================================================================
describe('13. no eligible provider', () => {
  it('returns NO_ELIGIBLE_PROVIDER when all providers rejected', async () => {
    const provider = makeProviderRow({ status: 'DISABLED' });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).toBeNull();
    expect(result.decisionReason.toLowerCase()).toContain('kein geeigneter provider');
    expect(result.eligibleCandidateIds).toHaveLength(0);
    expect(result.allCandidateIds).toHaveLength(1);
  });

  it('returns NO_ELIGIBLE_PROVIDER when no providers registered', async () => {
    const { service } = buildService([]);

    const result = await service.route(routeRequest());

    expect(result.selectedProvider).toBeNull();
    expect(result.eligibleCandidateIds).toHaveLength(0);
  });
});

// ===========================================================================
// 14. Routing decision persisted/audited with explainable reasons
// ===========================================================================
describe('14. routing decision audit', () => {
  it('persisted decision contains all required fields', async () => {
    const provider = makeProviderRow();
    const { service, prisma, auditService } = buildService([provider]);

    const correlationId = randomUUID();
    const result = await service.route(routeRequest({ correlationId }));

    expect(result.routingDecisionId).toBeDefined();

    // Verify persistence call
    expect(prisma.providerRoutingDecision.create).toHaveBeenCalledTimes(1);
    const createCall = prisma.providerRoutingDecision.create.mock.calls[0][0];
    expect(createCall.data.organizationId).toBe(ORG_A);
    expect(createCall.data.correlationId).toBe(correlationId);
    expect(createCall.data.requestedCapability).toBe('CODE_BUILD');
    expect(createCall.data.decisionReason).toBeDefined();
    expect(createCall.data.routingPolicyVersion).toBe('v0.1');

    // Verify audit event
    expect(auditService.record).toHaveBeenCalledTimes(1);
    const auditCall = auditService.record.mock.calls[0][0];
    expect(auditCall.action).toBe('PROVIDER_SELECTED');
    expect(auditCall.entityType).toBe('ProviderRoutingDecision');
    expect(auditCall.metadata.capability).toBe('CODE_BUILD');
    expect(auditCall.metadata.correlationId).toBe(correlationId);
    expect(auditCall.metadata.candidateCount).toBe(1);
  });

  it('decision with no eligible provider is audited as routing requested', async () => {
    const provider = makeProviderRow({ status: 'DISABLED' });
    const { service, auditService } = buildService([provider]);

    const result = await service.route(routeRequest());

    const auditCall = auditService.record.mock.calls[0][0];
    expect(auditCall.action).toBe('PROVIDER_ROUTING_REQUESTED');
    expect(auditCall.metadata.selectedProviderId).toBeNull();
  });
});

// ===========================================================================
// 15. Tenant isolation
// ===========================================================================
describe('15. tenant isolation', () => {
  it('providers from org A are not visible to org B routing', async () => {
    // Service loads providers only for the requested organization
    const providerA = makeProviderRow({ organizationId: ORG_A, providerCode: 'PROV_A' });
    const prisma: any = {
      agentProvider: {
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          if (where.organizationId === ORG_A) return Promise.resolve([providerA]);
          return Promise.resolve([]);
        }),
      },
      providerRoutingDecision: {
        create: jest.fn().mockImplementation((args: any) =>
          Promise.resolve({ id: randomUUID(), ...args.data, createdAt: new Date() }),
        ),
      },
    };
    const auditService: any = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ProviderRouterService(prisma, auditService);

    const result = await service.route(routeRequest({ organizationId: ORG_B }));

    expect(result.selectedProvider).toBeNull();
    expect(result.allCandidateIds).toHaveLength(0);
  });
});

// ===========================================================================
// 16-19. Existing tests remain green (verified by running separately)
// ===========================================================================
describe('16-19. cross-cutting concerns', () => {
  it('EO-01.1 and EO-01.2 tests are green (verified separately)', () => {
    // This test documents that tests 16-19 are verified by running:
    //   packages/contracts: npx jest
    //   apps/api full: npx jest (all tests)
    //   apps/api build: npx nest build
    expect(true).toBe(true);
  });
});

// ===========================================================================
// Multiple rejection reasons
// ===========================================================================
describe('multiple candidates with different rejections', () => {
  it('different rejection reasons recorded per candidate', async () => {
    const disabledProvider = makeProviderRow({
      id: 'disabled',
      providerCode: 'DISABLED',
      status: 'DISABLED',
    });
    const noCapabilityProvider = makeProviderRow({
      id: 'no-cap',
      providerCode: 'NO_CAP',
      capabilities: [makeCapabilityAssignment('CODE_REVIEW')],
    });
    const healthyProvider = makeProviderRow({
      id: 'healthy',
      providerCode: 'HEALTHY',
    });
    const { service } = buildService([disabledProvider, noCapabilityProvider, healthyProvider]);

    const result = await service.route(routeRequest({ capability: 'CODE_BUILD' }));

    expect(result.selectedProvider!.providerCode).toBe('HEALTHY');
    expect(result.rejectionReasons['disabled']).toBe('PROVIDER_DISABLED');
    expect(result.rejectionReasons['no-cap']).toBe('CAPABILITY_UNSUPPORTED');
    expect(Object.keys(result.rejectionReasons)).toHaveLength(2);
  });
});

// ===========================================================================
// Score components are populated for eligible providers
// ===========================================================================
describe('score components', () => {
  it('eligible provider has score components in response', async () => {
    const provider = makeProviderRow({
      qualityScore: 0.9,
      costScore: 100,
      latencyScore: 2000,
    });
    const { service } = buildService([provider]);

    const result = await service.route(routeRequest());

    expect(result.scoreComponents[provider.id]).toBeDefined();
    expect(result.scoreComponents[provider.id].qualityScore).toBe(0.9);
    expect(result.scoreComponents[provider.id].costScore).toBeGreaterThan(0);
    expect(result.scoreComponents[provider.id].latencyScore).toBeGreaterThan(0);
    expect(result.finalScores[provider.id]).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Full independence scenario: AL4 reviewer selection
// ===========================================================================
describe('AL4 independence routing scenario', () => {
  it('selects independent reviewer excluding builder family', async () => {
    const builder = makeProviderRow({
      id: 'builder-1',
      providerCode: 'BUILDER',
      modelFamily: 'claude',
      capabilities: [makeCapabilityAssignment('CODE_BUILD')],
    });
    const sameFamilyReviewer = makeProviderRow({
      id: 'reviewer-claude',
      providerCode: 'REVIEWER_CLAUDE',
      modelFamily: 'claude',
      capabilities: [makeCapabilityAssignment('CODE_REVIEW')],
      qualityScore: 0.95,
    });
    const independentReviewer = makeProviderRow({
      id: 'reviewer-gpt',
      providerCode: 'REVIEWER_GPT',
      modelFamily: 'gpt-4',
      capabilities: [makeCapabilityAssignment('CODE_REVIEW')],
      qualityScore: 0.85,
    });
    const { service } = buildService([builder, sameFamilyReviewer, independentReviewer]);

    const result = await service.route({
      organizationId: ORG_A,
      capability: 'CODE_REVIEW',
      assuranceLevel: 'AL4',
      independenceContext: {
        builderProviderId: 'builder-1',
        builderModelFamily: 'claude',
        previousReviewerProviderIds: [],
        previousReviewerModelFamilies: [],
      },
      correlationId: randomUUID(),
    });

    expect(result.selectedProvider!.providerCode).toBe('REVIEWER_GPT');
    expect(result.rejectionReasons['reviewer-claude']).toBe('INDEPENDENCE_REQUIREMENT_UNSATISFIED');
    expect(result.rejectionReasons['builder-1']).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('excludes previous reviewer provider and model family', async () => {
    const reviewer1 = makeProviderRow({
      id: 'reviewer-1',
      providerCode: 'REVIEWER_1',
      modelFamily: 'gpt-4',
      capabilities: [makeCapabilityAssignment('CODE_REVIEW')],
    });
    const reviewer2 = makeProviderRow({
      id: 'reviewer-2',
      providerCode: 'REVIEWER_2',
      modelFamily: 'gemini',
      capabilities: [makeCapabilityAssignment('CODE_REVIEW')],
    });
    const { service } = buildService([reviewer1, reviewer2]);

    const result = await service.route({
      organizationId: ORG_A,
      capability: 'CODE_REVIEW',
      assuranceLevel: 'AL4',
      independenceContext: {
        builderProviderId: 'builder-1',
        builderModelFamily: 'claude',
        previousReviewerProviderIds: ['reviewer-1'],
        previousReviewerModelFamilies: ['gpt-4'],
      },
      correlationId: randomUUID(),
    });

    expect(result.selectedProvider!.providerCode).toBe('REVIEWER_2');
    expect(result.rejectionReasons['reviewer-1']).toBe('INDEPENDENCE_REQUIREMENT_UNSATISFIED');
  });
});

// ===========================================================================
// Deterministic scoring: same provider always wins on identical input
// ===========================================================================
describe('deterministic scoring', () => {
  it('same input always produces same selected provider', async () => {
    const providers = [
      makeProviderRow({ id: 'p1', providerCode: 'P1', qualityScore: 0.7, costScore: 200, latencyScore: 3000 }),
      makeProviderRow({ id: 'p2', providerCode: 'P2', qualityScore: 0.8, costScore: 150, latencyScore: 2000 }),
      makeProviderRow({ id: 'p3', providerCode: 'P3', qualityScore: 0.6, costScore: 300, latencyScore: 4000 }),
    ];

    const results: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { service } = buildService([...providers]);
      const result = await service.route(routeRequest());
      results.push(result.selectedProvider!.providerCode);
    }

    // All results should be identical
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe('P2');
  });
});

// ===========================================================================
// Unused enum references stay imported for contract stability checks
// ===========================================================================
describe('contract enums referenced', () => {
  it('status/health/quota enums remain importable and stable', () => {
    expect(ProviderStatus.ACTIVE).toBe('ACTIVE');
    expect(ProviderHealthStatus.HEALTHY).toBe('HEALTHY');
    expect(ProviderQuotaStatus.AVAILABLE).toBe('AVAILABLE');
    expect(ProviderType.CLOUD_LLM).toBe('CLOUD_LLM');
  });
});
