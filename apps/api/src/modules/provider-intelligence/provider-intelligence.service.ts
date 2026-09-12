import { Injectable } from '@nestjs/common';
import { EngineeringCapability } from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';

const ROUTING_WINDOW = 100;

@Injectable()
export class ProviderIntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(organizationId: string) {
    const [providers, decisions] = await Promise.all([
      this.prisma.agentProvider.findMany({
        where: { organizationId },
        orderBy: { providerCode: 'asc' },
        include: {
          capabilities: {
            where: { organizationId },
            orderBy: { capabilityCode: 'asc' },
          },
        },
      }),
      this.prisma.providerRoutingDecision.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: ROUTING_WINDOW,
        select: {
          id: true,
          requestedCapability: true,
          selectedProviderId: true,
          decisionReason: true,
          routingPolicyVersion: true,
          createdAt: true,
        },
      }),
    ]);

    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const selectedDecisions = decisions.filter((decision) => decision.selectedProviderId !== null);
    const unselectedDecisions = decisions.length - selectedDecisions.length;

    let currentEstimateTotalMinorUnits = 0;
    let currentEstimateCoveredSelections = 0;
    for (const decision of selectedDecisions) {
      const provider = decision.selectedProviderId
        ? providerById.get(decision.selectedProviderId)
        : undefined;
      if (provider?.estimatedCostMinorUnits !== null && provider?.estimatedCostMinorUnits !== undefined) {
        currentEstimateTotalMinorUnits += provider.estimatedCostMinorUnits;
        currentEstimateCoveredSelections += 1;
      }
    }

    const officialCapabilities = Object.values(EngineeringCapability);
    const capabilityCoverage = officialCapabilities.map((capabilityCode) => {
      const enabledProviders = providers.filter((provider) =>
        provider.capabilities.some(
          (assignment) => assignment.isEnabled && assignment.capabilityCode === capabilityCode,
        ),
      );
      const staticallyRoutableProviders = enabledProviders.filter((provider) =>
        this.isStaticallyRoutable(provider.status, provider.healthStatus, provider.quotaStatus),
      );

      return {
        capabilityCode,
        enabledProviderCount: enabledProviders.length,
        staticallyRoutableProviderCount: staticallyRoutableProviders.length,
        providerCodes: staticallyRoutableProviders.map((provider) => provider.providerCode),
        readiness:
          staticallyRoutableProviders.length > 0
            ? 'ROUTABLE_BASELINE'
            : enabledProviders.length > 0
              ? 'ASSIGNED_BUT_UNAVAILABLE'
              : 'NO_PROVIDER_ASSIGNMENT',
      } as const;
    });

    return {
      organizationId,
      observedAt: new Date(),
      authority: 'READ_ONLY' as const,
      routingWindowSize: ROUTING_WINDOW,
      providers: providers.map((provider) => ({
        id: provider.id,
        providerCode: provider.providerCode,
        displayName: provider.displayName,
        status: provider.status,
        healthStatus: provider.healthStatus,
        healthCheckedAt: provider.healthCheckedAt,
        quotaStatus: provider.quotaStatus,
        quotaCheckedAt: provider.quotaCheckedAt,
        estimatedCostMinorUnits: provider.estimatedCostMinorUnits,
        qualityScore: provider.qualityScore,
        latencyScore: provider.latencyScore,
        costScore: provider.costScore,
        enabledCapabilities: provider.capabilities
          .filter((assignment) => assignment.isEnabled)
          .map((assignment) => assignment.capabilityCode),
        staticallyRoutable: this.isStaticallyRoutable(
          provider.status,
          provider.healthStatus,
          provider.quotaStatus,
        ),
      })),
      capabilityCoverage,
      routing: {
        observedDecisionCount: decisions.length,
        selectedDecisionCount: selectedDecisions.length,
        unselectedDecisionCount: unselectedDecisions,
        selectionRate:
          decisions.length > 0 ? selectedDecisions.length / decisions.length : null,
        latestPolicyVersions: Array.from(
          new Set(
            decisions
              .map((decision) => decision.routingPolicyVersion)
              .filter((value): value is string => Boolean(value)),
          ),
        ),
      },
      costVisibility: {
        basis: 'CURRENT_PROVIDER_ESTIMATE_NOT_BILLED_COST' as const,
        selectedDecisionCount: selectedDecisions.length,
        coveredSelectionCount: currentEstimateCoveredSelections,
        coverageRate:
          selectedDecisions.length > 0
            ? currentEstimateCoveredSelections / selectedDecisions.length
            : null,
        currentEstimateTotalMinorUnits,
        warning:
          'Derived from current provider estimates for recent selections; this is not historical billing or actual spend.',
      },
    };
  }

  private isStaticallyRoutable(status: string, healthStatus: string, quotaStatus: string) {
    return (
      status === 'ACTIVE' &&
      (healthStatus === 'HEALTHY' || healthStatus === 'DEGRADED') &&
      (quotaStatus === 'AVAILABLE' || quotaStatus === 'LIMITED')
    );
  }
}
