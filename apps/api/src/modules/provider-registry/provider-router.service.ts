import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ProviderStatus,
  ProviderHealthStatus,
  ProviderQuotaStatus,
  ProviderCredentialRequirement,
  providerSupportsCapability,
  type ProviderDeclaration,
  type ProviderRoutingRequest,
  type ProviderRoutingResponse,
  type ProviderScoreComponents,
  type RoutingCandidate,
  type RoutingRejectionReason,
  EligibilityPhase,
  DEFAULT_ROUTING_SCORE_WEIGHTS,
  ROUTING_POLICY_VERSION,
  ROUTING_REJECTION_MESSAGES,
} from '@vito/contracts';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Provider Router Service (EO-01.3)
// ---------------------------------------------------------------------------

/**
 * Deterministischer Provider Router für den Engineering Runtime.
 *
 * Reihenfolge der Eligibility-Prüfung:
 *   1. capability eligibility (enabled ProviderCapability-Assignments)
 *   2. provider enabled/status policy
 *   3. availability / quota (inkl. interner QUOTA-Phase)
 *   4. assurance compatibility
 *   5. independence requirement
 *   6. budget eligibility (estimatedCostMinorUnits, fail-closed COST_UNKNOWN)
 *   7. deterministic score/rank among remaining candidates
 *
 * v0.1 Status/Health/Quota-Policy:
 *   - ProviderStatus.ACTIVE: routbar; DISABLED: ineligible;
 *     DEGRADED: ineligible (Status-Policy-Phase)
 *   - Health HEALTHY: routbar; DEGRADED: routbar mit Score-Penalty;
 *     UNKNOWN/UNAVAILABLE/DISABLED/QUOTA_LIMITED: ineligible
 *   - Quota AVAILABLE/LIMITED: routbar (LIMITED explizit getestet);
 *     EXHAUSTED: ineligible; UNKNOWN: fail-closed (QUOTA_STATUS_UNKNOWN)
 *
 * Budget-Policy:
 *   - Kein maxCostMinorUnits => Budget-Check blockiert nicht.
 *   - estimatedCostMinorUnits <= maxCostMinorUnits => eligible.
 *   - estimatedCostMinorUnits > maxCostMinorUnits => BUDGET_INCOMPATIBLE.
 *   - estimatedCostMinorUnits unbekannt + maxCostMinorUnits gesetzt =>
 *     fail-closed COST_UNKNOWN.
 *   - costScore ist NUR ein Ranking-Score und kann Budget-Ablehnungen
 *     niemals umgehen.
 *
 * Ein ineligibler Provider darf NIEMALS wegen eines hohen Scores gewinnen.
 * Kein ML. Keine dynamischen Pricing-Engines. Deterministisch und erklärbar.
 */
@Injectable()
export class ProviderRouterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Public: Route
  // -------------------------------------------------------------------------

  async route(request: ProviderRoutingRequest): Promise<ProviderRoutingResponse> {
    const candidates = await this.loadCandidates(request.organizationId);
    const evaluated = candidates.map((c) => this.evaluateCandidate(c, request));

    const eligible = evaluated.filter((c) => c.eligible);
    const rejected = evaluated.filter((c) => !c.eligible);

    // Build rejection reasons map (providerId -> reason)
    const rejectionReasons: Record<string, RoutingRejectionReason> = {};
    const rejectionPhases: Record<string, EligibilityPhase> = {};
    for (const r of rejected) {
      if (r.rejectionReason) {
        rejectionReasons[r.provider.id] = r.rejectionReason;
      }
      if (r.rejectionPhase) {
        rejectionPhases[r.provider.id] = r.rejectionPhase;
      }
    }

    // Score eligible candidates
    const scored = eligible.map((c) => ({
      ...c,
      scoreComponents: this.computeScore(c.provider, request),
      finalScore: 0, // computed below
    }));

    // Compute final scores
    for (const s of scored) {
      if (s.scoreComponents) {
        s.finalScore = this.aggregateScore(s.scoreComponents);
      }
    }

    // Sort: highest score first, then deterministic tie-break by providerCode
    scored.sort((a, b) => {
      const scoreDiff = (b.finalScore ?? 0) - (a.finalScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return a.provider.providerCode.localeCompare(b.provider.providerCode);
    });

    // Merge scored data back into evaluated for consistent response maps
    const scoredMap = new Map(scored.map((s) => [s.provider.id, s]));
    const allCandidates = evaluated.map((c) => scoredMap.get(c.provider.id) ?? c);

    const selected = scored.length > 0 ? scored[0] : null;

    // Build response maps
    const scoreComponentsMap: Record<string, ProviderScoreComponents> = {};
    const finalScoresMap: Record<string, number> = {};
    const eligibleCandidateIds: string[] = [];
    const allCandidateIds: string[] = [];

    for (const c of allCandidates) {
      allCandidateIds.push(c.provider.id);
      if (c.eligible) {
        eligibleCandidateIds.push(c.provider.id);
      }
      if (c.scoreComponents) {
        scoreComponentsMap[c.provider.id] = c.scoreComponents;
      }
      if (c.finalScore !== undefined) {
        finalScoresMap[c.provider.id] = c.finalScore;
      }
    }

    const decisionReason = selected
      ? `Provider ${selected.provider.providerCode} ausgewählt (Score: ${selected.finalScore?.toFixed(4) ?? 'N/A'})`
      : ROUTING_REJECTION_MESSAGES.NO_ELIGIBLE_PROVIDER;

    // Persist routing decision
    const decision = await this.persistDecision({
      organizationId: request.organizationId,
      correlationId: request.correlationId,
      workflowRunId: request.workflowRunId,
      workflowStepRunId: request.workflowStepRunId,
      requestedCapability: request.capability,
      assuranceLevel: request.assuranceLevel,
      selectedProviderId: selected?.provider.id,
      candidateProviderIds: allCandidateIds,
      rejectionReasons,
      scoreComponents: scoreComponentsMap,
      finalScore: selected?.finalScore,
      decisionReason,
    });

    // Audit routing decision
    await this.auditService.record({
      organizationId: request.organizationId,
      actorType: 'SYSTEM',
      action: selected ? 'PROVIDER_SELECTED' : 'PROVIDER_ROUTING_REQUESTED',
      entityType: 'ProviderRoutingDecision',
      entityId: decision.id,
      metadata: {
        correlationId: request.correlationId,
        capability: request.capability,
        assuranceLevel: request.assuranceLevel,
        selectedProviderId: selected?.provider.id ?? null,
        selectedProviderCode: selected?.provider.providerCode ?? null,
        candidateCount: allCandidateIds.length,
        eligibleCount: eligibleCandidateIds.length,
        rejectionReasons,
        decisionReason,
      },
    });

    return {
      selectedProvider: selected?.provider ?? null,
      routingDecisionId: decision.id,
      eligibleCandidateIds,
      allCandidateIds,
      rejectionReasons,
      rejectionPhases,
      scoreComponents: scoreComponentsMap,
      finalScores: finalScoresMap,
      decisionReason,
    };
  }

  // -------------------------------------------------------------------------
  // Candidate Loading
  // -------------------------------------------------------------------------

  private async loadCandidates(organizationId: string): Promise<ProviderDeclaration[]> {
    const rows = await this.prisma.agentProvider.findMany({
      where: { organizationId },
      orderBy: { providerCode: 'asc' },
      include: { capabilities: true },
    });

    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      providerCode: r.providerCode,
      displayName: r.displayName,
      providerType: r.providerType as any,
      status: r.status as any,
      modelFamily: r.modelFamily ?? undefined,
      modelName: r.modelName ?? undefined,
      modelCode: r.modelCode ?? undefined,
      // Legacy JSON, NICHT mehr Routing-Authorität (nur Abwärtskompatibilität).
      supportedCapabilities: (r.supportedCapabilities as string[]) ?? [],
      // Durable Assignments sind die alleinige Capability-Authorität.
      capabilityAssignments: (r.capabilities ?? []).map((c) => ({
        capabilityCode: c.capabilityCode,
        isEnabled: c.isEnabled,
      })),
      estimatedCostMinorUnits: r.estimatedCostMinorUnits ?? undefined,
      healthStatus: r.healthStatus as any,
      healthCheckedAt: r.healthCheckedAt ?? undefined,
      quotaStatus: r.quotaStatus as any,
      quotaCheckedAt: r.quotaCheckedAt ?? undefined,
      qualityScore: r.qualityScore ?? undefined,
      latencyScore: r.latencyScore ?? undefined,
      costScore: r.costScore ?? undefined,
      costMetadata: (r.costMetadata as Record<string, unknown>) ?? {},
      assuranceLevels: (r.assuranceLevels as string[]) ?? [],
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      credentialRequirement: ProviderCredentialRequirement.UNKNOWN,
    }));
  }

  // -------------------------------------------------------------------------
  // Eligibility Evaluation (phase-ordered, deterministic)
  // -------------------------------------------------------------------------

  private evaluateCandidate(
    provider: ProviderDeclaration,
    request: ProviderRoutingRequest,
  ): RoutingCandidate {
    // Phase 1: Capability eligibility (nur ENABLED ProviderCapability-Assignments;
    // legacy supportedCapabilities JSON ist bewusst NICHT autoritativ)
    if (!providerSupportsCapability(provider, request.capability)) {
      return this.rejected(provider, 'CAPABILITY_UNSUPPORTED', EligibilityPhase.CAPABILITY);
    }

    // Phase 2: Provider enabled/status policy
    if (provider.status === ProviderStatus.DISABLED) {
      return this.rejected(provider, 'PROVIDER_DISABLED', EligibilityPhase.STATUS_POLICY);
    }
    if (provider.status === ProviderStatus.DEGRADED) {
      // DEGRADED status means admin has marked as impaired; exclude from routing
      return this.rejected(provider, 'PROVIDER_UNHEALTHY', EligibilityPhase.STATUS_POLICY);
    }

    // Phase 3: Availability / quota
    if (provider.healthStatus === ProviderHealthStatus.DISABLED) {
      return this.rejected(provider, 'PROVIDER_DISABLED', EligibilityPhase.AVAILABILITY);
    }
    if (provider.healthStatus === ProviderHealthStatus.UNAVAILABLE) {
      return this.rejected(provider, 'PROVIDER_UNAVAILABLE', EligibilityPhase.AVAILABILITY);
    }
    if (provider.healthStatus === ProviderHealthStatus.QUOTA_LIMITED) {
      return this.rejected(provider, 'QUOTA_UNAVAILABLE', EligibilityPhase.AVAILABILITY);
    }
    // UNKNOWN health: fail-closed for mandatory routing
    if (provider.healthStatus === ProviderHealthStatus.UNKNOWN) {
      return this.rejected(provider, 'PROVIDER_UNHEALTHY', EligibilityPhase.AVAILABILITY);
    }

    // Interne QUOTA-Phase
    if (provider.quotaStatus === ProviderQuotaStatus.EXHAUSTED) {
      return this.rejected(provider, 'QUOTA_EXHAUSTED', EligibilityPhase.QUOTA);
    }
    // UNKNOWN quota: fail-closed für Production-Governance
    if (provider.quotaStatus === ProviderQuotaStatus.UNKNOWN) {
      return this.rejected(provider, 'QUOTA_STATUS_UNKNOWN', EligibilityPhase.QUOTA);
    }
    // AVAILABLE und LIMITED sind routbar (LIMITED explizit getestet).

    // Phase 4: Assurance compatibility
    if (request.assuranceLevel) {
      if (
        provider.assuranceLevels.length > 0 &&
        !provider.assuranceLevels.includes(request.assuranceLevel)
      ) {
        return this.rejected(provider, 'ASSURANCE_LEVEL_UNSUPPORTED', EligibilityPhase.ASSURANCE);
      }
    }

    // Phase 5: Independence requirement
    if (request.independenceContext) {
      const independenceViolation = this.checkIndependence(provider, request.independenceContext);
      if (independenceViolation) {
        return this.rejected(provider, independenceViolation, EligibilityPhase.INDEPENDENCE);
      }
    }

    // Phase 6: Budget eligibility (explizite Geldkosten, fail-closed)
    const maxCostMinorUnits = request.budget?.maxCostMinorUnits;
    if (maxCostMinorUnits !== undefined) {
      const estimatedCost = provider.estimatedCostMinorUnits;
      if (estimatedCost === undefined || estimatedCost === null) {
        // Unbekannte Kosten + gesetztes Budget => fail-closed.
        // costScore kann diese Ablehnung NIEMALS umgehen.
        return this.rejected(provider, 'COST_UNKNOWN', EligibilityPhase.BUDGET);
      }
      if (estimatedCost > maxCostMinorUnits) {
        return this.rejected(provider, 'BUDGET_INCOMPATIBLE', EligibilityPhase.BUDGET);
      }
    }
    // Kein maxCostMinorUnits => Budget-Check blockiert nicht.

    // Provider is eligible
    return { provider, eligible: true };
  }

  // -------------------------------------------------------------------------
  // Independence Check
  // -------------------------------------------------------------------------

  private checkIndependence(
    provider: ProviderDeclaration,
    ctx: { builderProviderId?: string; builderModelFamily?: string; previousReviewerProviderIds: readonly string[]; previousReviewerModelFamilies: readonly string[] },
  ): RoutingRejectionReason | null {
    // Provider used as builder cannot be reviewer
    if (ctx.builderProviderId && provider.id === ctx.builderProviderId) {
      return 'INDEPENDENCE_REQUIREMENT_UNSATISFIED';
    }

    // Model family independence: reviewer family must differ from builder family
    if (ctx.builderModelFamily && provider.modelFamily) {
      if (provider.modelFamily === ctx.builderModelFamily) {
        return 'INDEPENDENCE_REQUIREMENT_UNSATISFIED';
      }
    }

    // Previous reviewer: same provider ID not allowed if distinct provider required
    if (ctx.previousReviewerProviderIds.includes(provider.id)) {
      return 'INDEPENDENCE_REQUIREMENT_UNSATISFIED';
    }

    // Previous reviewer model families: same family not allowed if distinct evidence required
    if (provider.modelFamily && ctx.previousReviewerModelFamilies.includes(provider.modelFamily)) {
      return 'INDEPENDENCE_REQUIREMENT_UNSATISFIED';
    }

    // Model identity must be verifiable when assurance requires independence
    if (!provider.modelFamily || provider.modelFamily.trim() === '') {
      return 'MODEL_IDENTITY_UNVERIFIABLE';
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Scoring (deterministic, explicit weights)
  // -------------------------------------------------------------------------

  private computeScore(
    provider: ProviderDeclaration,
    _request: ProviderRoutingRequest,
  ): ProviderScoreComponents {
    const weights = DEFAULT_ROUTING_SCORE_WEIGHTS;

    // Quality: normalize 0-1 range (default 0.5 if not set)
    const quality = provider.qualityScore ?? 0.5;

    // Cost: lower is better; normalize inversely (0 = most expensive, 1 = free)
    // costScore ist NUR Ranking (Budget-Eligibility passiert in Phase 6 über
    // estimatedCostMinorUnits). If costScore is not set, default to 0.5.
    const cost = provider.costScore !== undefined
      ? Math.max(0, 1 - provider.costScore / 1000)
      : 0.5;

    // Latency: lower is better; normalize inversely (0 = slowest, 1 = fastest)
    const latency = provider.latencyScore !== undefined
      ? Math.max(0, 1 - provider.latencyScore / 10000)
      : 0.5;

    // Health preference: HEALTHY=1.0, DEGRADED=0.5, UNKNOWN=0.3
    const healthPreference =
      provider.healthStatus === ProviderHealthStatus.HEALTHY ? 1.0 :
      provider.healthStatus === ProviderHealthStatus.DEGRADED ? 0.5 :
      0.3;

    return {
      qualityScore: quality,
      costScore: cost,
      latencyScore: latency,
      healthPreference,
      raw: {
        qualityRaw: provider.qualityScore ?? 0.5,
        costRaw: provider.costScore ?? 500,
        latencyRaw: provider.latencyScore ?? 5000,
        healthRaw: healthPreference,
      },
    };
  }

  private aggregateScore(components: ProviderScoreComponents): number {
    const weights = DEFAULT_ROUTING_SCORE_WEIGHTS;
    return (
      components.qualityScore * weights.quality +
      components.costScore * weights.cost +
      components.latencyScore * weights.latency +
      components.healthPreference * weights.healthPreference
    );
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private rejected(
    provider: ProviderDeclaration,
    reason: RoutingRejectionReason,
    phase: EligibilityPhase,
  ): RoutingCandidate {
    return {
      provider,
      eligible: false,
      rejectionReason: reason,
      rejectionPhase: phase,
    };
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private async persistDecision(data: {
    organizationId: string;
    correlationId: string;
    workflowRunId?: string;
    workflowStepRunId?: string;
    requestedCapability: string;
    assuranceLevel?: string;
    selectedProviderId?: string;
    candidateProviderIds: string[];
    rejectionReasons: Record<string, RoutingRejectionReason>;
    scoreComponents: Record<string, ProviderScoreComponents>;
    finalScore?: number;
    decisionReason: string;
  }) {
    return this.prisma.providerRoutingDecision.create({
      data: {
        organizationId: data.organizationId,
        correlationId: data.correlationId,
        workflowRunId: data.workflowRunId ?? null,
        workflowStepRunId: data.workflowStepRunId ?? null,
        requestedCapability: data.requestedCapability,
        assuranceLevel: data.assuranceLevel ?? null,
        selectedProviderId: data.selectedProviderId ?? null,
        candidateProviderIds: data.candidateProviderIds as Prisma.InputJsonValue,
        rejectionReasons: data.rejectionReasons as Prisma.InputJsonValue,
        scoreComponents: data.scoreComponents as unknown as Prisma.InputJsonValue,
        finalScore: data.finalScore ?? null,
        decisionReason: data.decisionReason,
        routingPolicyVersion: ROUTING_POLICY_VERSION,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Query Routing Decisions
  // -------------------------------------------------------------------------

  async findDecisionById(organizationId: string, decisionId: string) {
    return this.prisma.providerRoutingDecision.findFirst({
      where: { id: decisionId, organizationId },
      include: { selectedProvider: true },
    });
  }

  async findDecisionsByCorrelationId(organizationId: string, correlationId: string) {
    return this.prisma.providerRoutingDecision.findMany({
      where: { organizationId, correlationId },
      orderBy: { createdAt: 'asc' },
      include: { selectedProvider: true },
    });
  }

  async findDecisionsByWorkflowRunId(organizationId: string, workflowRunId: string) {
    return this.prisma.providerRoutingDecision.findMany({
      where: { organizationId, workflowRunId },
      orderBy: { createdAt: 'asc' },
      include: { selectedProvider: true },
    });
  }
}
