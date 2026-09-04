import { Injectable } from '@nestjs/common';

import {
  ProviderCapabilityAssignment,
  ProviderCredentialRequirement,
  ProviderDeclaration,
  ProviderHealthStatus,
  ProviderQuotaStatus,
  ProviderStatus,
  ProviderType,
} from '@vito/contracts';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ProviderResolver } from '../../governed-invocation/governed-invocation.service';
import { mapCredentialRequirementFromPersistence } from '../persistence/governed-persistence.mappers';

/**
 * Produktions-ProviderResolver (B2c): organisationsscoped, strikt an der
 * persisted Source of Truth. Ein fremder Tenant kann einen Provider nie
 * auflösen, weil die Query IMMER organizationId bindet. Unbekannte/
 * inkonsistente Persistenzwerte führen zu null (fail closed), niemals zu
 * erratenen Defaults. Das legacy supportedCapabilities-JSON wird nur als
 * deklariertes Feld durchgereicht und ist KEINE Routing-Authorität —
 * maßgeblich sind ausschließlich die ENABLED capabilityAssignments.
 */
function mapEnumStrict<T extends string>(
  value: string,
  allowed: readonly T[],
): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

@Injectable()
export class PrismaProviderDeclarationResolver implements ProviderResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    providerId: string,
    organizationId: string,
  ): Promise<ProviderDeclaration | null> {
    if (!providerId || !organizationId) {
      return null;
    }

    const row = await this.prisma.agentProvider.findFirst({
      where: { id: providerId, organizationId },
      include: { capabilities: true },
    });

    if (!row) {
      return null;
    }

    const status = mapEnumStrict(row.status, Object.values(ProviderStatus));
    const healthStatus = mapEnumStrict(
      row.healthStatus,
      Object.values(ProviderHealthStatus),
    );
    const quotaStatus = mapEnumStrict(
      row.quotaStatus,
      Object.values(ProviderQuotaStatus),
    );
    const providerType = mapEnumStrict(row.providerType, Object.values(ProviderType));

    if (!status || !healthStatus || !quotaStatus || !providerType) {
      return null;
    }

    const credentialRequirement = mapCredentialRequirementFromPersistence(
      row.credentialRequirement,
    );

    const capabilityAssignments: ProviderCapabilityAssignment[] = row.capabilities.map(
      (assignment) => ({
        capabilityCode: assignment.capabilityCode,
        isEnabled: assignment.isEnabled,
      }),
    );

    return {
      id: row.id,
      organizationId: row.organizationId,
      providerCode: row.providerCode,
      displayName: row.displayName,
      providerType,
      status,
      modelFamily: row.modelFamily ?? undefined,
      modelName: row.modelName ?? undefined,
      modelCode: row.modelCode ?? undefined,
      supportedCapabilities: Array.isArray(row.supportedCapabilities)
        ? row.supportedCapabilities.map(String)
        : [],
      capabilityAssignments,
      estimatedCostMinorUnits: row.estimatedCostMinorUnits ?? null,
      healthStatus,
      healthCheckedAt: row.healthCheckedAt ?? undefined,
      quotaStatus,
      quotaCheckedAt: row.quotaCheckedAt ?? undefined,
      qualityScore: row.qualityScore ?? undefined,
      latencyScore: row.latencyScore ?? undefined,
      costScore: row.costScore ?? undefined,
      costMetadata: (row.costMetadata ?? {}) as Record<string, unknown>,
      assuranceLevels: Array.isArray(row.assuranceLevels)
        ? row.assuranceLevels.map(String)
        : [],
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      credentialRequirement:
        credentialRequirement ?? ProviderCredentialRequirement.UNKNOWN,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
