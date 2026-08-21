import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

export interface CreateProviderInput {
  organizationId: string;
  providerCode: string;
  displayName: string;
  providerType?: string;
  status?: string;
  modelFamily?: string;
  modelName?: string;
  modelCode?: string;
  supportedCapabilities: readonly string[];
  /** Explizite geschätzte Geldkosten in Minor Units (null/undefined = unbekannt). */
  estimatedCostMinorUnits?: number | null;
  healthStatus?: string;
  quotaStatus?: string;
  qualityScore?: number;
  latencyScore?: number;
  costScore?: number;
  costMetadata?: Record<string, unknown>;
  assuranceLevels?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateProviderInput {
  organizationId: string;
  providerId: string;
  displayName?: string;
  providerType?: string;
  status?: string;
  modelFamily?: string;
  modelName?: string;
  modelCode?: string;
  supportedCapabilities?: readonly string[];
  /** Explizite geschätzte Geldkosten in Minor Units. */
  estimatedCostMinorUnits?: number | null;
  healthStatus?: string;
  healthCheckedAt?: Date;
  quotaStatus?: string;
  quotaCheckedAt?: Date;
  qualityScore?: number;
  latencyScore?: number;
  costScore?: number;
  costMetadata?: Record<string, unknown>;
  assuranceLevels?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface AssignProviderCapabilityInput {
  organizationId: string;
  agentProviderId: string;
  capabilityCode: string;
  isEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Provider Registry Service (EO-01.3).
 *
 * Tenant-scoped CRUD-Verwaltung von AgentProvider-Instanzen.
 * Provider Registry ist die einzige Quelle für Provider-Metadaten.
 * Keine Secrets, keine API Keys in Provider-Records.
 */
@Injectable()
export class ProviderRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  async createProvider(input: CreateProviderInput) {
    return this.prisma.$transaction(async (tx) => {
      const provider = await tx.agentProvider.create({
        data: {
          organizationId: input.organizationId,
          providerCode: input.providerCode,
          displayName: input.displayName,
          providerType: (input.providerType ?? 'CLOUD_LLM') as any,
          status: (input.status ?? 'ACTIVE') as any,
          modelFamily: input.modelFamily ?? null,
          modelName: input.modelName ?? null,
          modelCode: input.modelCode ?? null,
          supportedCapabilities: [...input.supportedCapabilities] as Prisma.InputJsonValue,
          estimatedCostMinorUnits: input.estimatedCostMinorUnits ?? null,
          healthStatus: (input.healthStatus ?? 'UNKNOWN') as any,
          quotaStatus: (input.quotaStatus ?? 'UNKNOWN') as any,
          qualityScore: input.qualityScore ?? null,
          latencyScore: input.latencyScore ?? null,
          costScore: input.costScore ?? null,
          costMetadata: (input.costMetadata ?? {}) as Prisma.InputJsonValue,
          assuranceLevels: [...(input.assuranceLevels ?? [])] as Prisma.InputJsonValue,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });

      await this.auditService.record(
        {
          organizationId: input.organizationId,
          actorType: 'SYSTEM',
          action: 'PROVIDER_REGISTERED',
          entityType: 'AgentProvider',
          entityId: provider.id,
          metadata: {
            providerCode: provider.providerCode,
            displayName: provider.displayName,
            providerType: provider.providerType,
            supportedCapabilities: input.supportedCapabilities,
          },
        },
        tx,
      );

      return provider;
    });
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  async updateProvider(input: UpdateProviderInput) {
    const existing = await this.prisma.agentProvider.findFirst({
      where: { id: input.providerId, organizationId: input.organizationId },
    });
    if (!existing) throw new NotFoundException('Provider nicht gefunden.');

    return this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.AgentProviderUpdateInput = {};

      if (input.displayName !== undefined) updateData.displayName = input.displayName;
      if (input.providerType !== undefined) updateData.providerType = input.providerType as any;
      if (input.status !== undefined) updateData.status = input.status as any;
      if (input.modelFamily !== undefined) updateData.modelFamily = input.modelFamily;
      if (input.modelName !== undefined) updateData.modelName = input.modelName;
      if (input.modelCode !== undefined) updateData.modelCode = input.modelCode;
      if (input.supportedCapabilities !== undefined) {
        updateData.supportedCapabilities = [...input.supportedCapabilities] as Prisma.InputJsonValue;
      }
      if (input.estimatedCostMinorUnits !== undefined) {
        updateData.estimatedCostMinorUnits = input.estimatedCostMinorUnits;
      }
      if (input.healthStatus !== undefined) {
        updateData.healthStatus = input.healthStatus as any;
        updateData.healthCheckedAt = new Date();
      }
      if (input.healthCheckedAt !== undefined) updateData.healthCheckedAt = input.healthCheckedAt;
      if (input.quotaStatus !== undefined) {
        updateData.quotaStatus = input.quotaStatus as any;
        updateData.quotaCheckedAt = new Date();
      }
      if (input.quotaCheckedAt !== undefined) updateData.quotaCheckedAt = input.quotaCheckedAt;
      if (input.qualityScore !== undefined) updateData.qualityScore = input.qualityScore;
      if (input.latencyScore !== undefined) updateData.latencyScore = input.latencyScore;
      if (input.costScore !== undefined) updateData.costScore = input.costScore;
      if (input.costMetadata !== undefined) {
        updateData.costMetadata = input.costMetadata as Prisma.InputJsonValue;
      }
      if (input.assuranceLevels !== undefined) {
        updateData.assuranceLevels = [...input.assuranceLevels] as Prisma.InputJsonValue;
      }
      if (input.metadata !== undefined) {
        updateData.metadata = input.metadata as Prisma.InputJsonValue;
      }

      const provider = await tx.agentProvider.update({
        where: { id: input.providerId },
        data: updateData,
      });

      await this.auditService.record(
        {
          organizationId: input.organizationId,
          actorType: 'SYSTEM',
          action: 'PROVIDER_UPDATED',
          entityType: 'AgentProvider',
          entityId: provider.id,
          metadata: {
            providerCode: provider.providerCode,
            updatedFields: Object.keys(updateData),
          },
        },
        tx,
      );

      return provider;
    });
  }

  // -------------------------------------------------------------------------
  // Queries (tenant-scoped)
  // -------------------------------------------------------------------------

  async findProviderById(organizationId: string, providerId: string) {
    const provider = await this.prisma.agentProvider.findFirst({
      where: { id: providerId, organizationId },
    });
    if (!provider) throw new NotFoundException('Provider nicht gefunden.');
    return provider;
  }

  async findProviderByCode(organizationId: string, providerCode: string) {
    return this.prisma.agentProvider.findFirst({
      where: { organizationId, providerCode },
    });
  }

  async findAllProviders(organizationId: string) {
    return this.prisma.agentProvider.findMany({
      where: { organizationId },
      orderBy: { providerCode: 'asc' },
    });
  }

  async findActiveProviders(organizationId: string) {
    return this.prisma.agentProvider.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
      },
      orderBy: { providerCode: 'asc' },
    });
  }

  // -------------------------------------------------------------------------
  // Health / Quota Updates
  // -------------------------------------------------------------------------

  async updateHealthStatus(
    organizationId: string,
    providerId: string,
    healthStatus: string,
  ) {
    return this.updateProvider({
      organizationId,
      providerId,
      healthStatus,
    });
  }

  async updateQuotaStatus(
    organizationId: string,
    providerId: string,
    quotaStatus: string,
  ) {
    return this.updateProvider({
      organizationId,
      providerId,
      quotaStatus,
    });
  }

  // -------------------------------------------------------------------------
  // Durable ProviderCapability Assignments
  // -------------------------------------------------------------------------

  /**
   * Persistente Capability-Zuweisung (ProviderCapability).
   * Duplikate werden durch das Schema-Unique-Constraint verhindert
   * ([organizationId, agentProviderId, capabilityCode]) und als
   * ConflictException gemeldet.
   */
  async assignCapability(input: AssignProviderCapabilityInput) {
    const provider = await this.prisma.agentProvider.findFirst({
      where: { id: input.agentProviderId, organizationId: input.organizationId },
    });
    if (!provider) throw new NotFoundException('Provider nicht gefunden.');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const capability = await tx.providerCapability.create({
          data: {
            organizationId: input.organizationId,
            agentProviderId: provider.id,
            capabilityCode: input.capabilityCode,
            isEnabled: input.isEnabled ?? true,
          },
        });

        await this.auditService.record(
          {
            organizationId: input.organizationId,
            actorType: 'SYSTEM',
            action: 'PROVIDER_CAPABILITY_ASSIGNED',
            entityType: 'ProviderCapability',
            entityId: capability.id,
            metadata: {
              agentProviderId: provider.id,
              providerCode: provider.providerCode,
              capabilityCode: capability.capabilityCode,
              isEnabled: capability.isEnabled,
            },
          },
          tx,
        );

        return capability;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Capability ist diesem Provider bereits zugewiesen.',
        );
      }
      throw error;
    }
  }

  async setCapabilityEnabled(
    organizationId: string,
    capabilityId: string,
    isEnabled: boolean,
  ) {
    const existing = await this.prisma.providerCapability.findFirst({
      where: { id: capabilityId, organizationId },
    });
    if (!existing) throw new NotFoundException('Provider-Capability nicht gefunden.');

    return this.prisma.$transaction(async (tx) => {
      const capability = await tx.providerCapability.update({
        where: { id: capabilityId },
        data: { isEnabled },
      });

      await this.auditService.record(
        {
          organizationId,
          actorType: 'SYSTEM',
          action: 'PROVIDER_CAPABILITY_UPDATED',
          entityType: 'ProviderCapability',
          entityId: capability.id,
          metadata: {
            agentProviderId: capability.agentProviderId,
            capabilityCode: capability.capabilityCode,
            isEnabled: capability.isEnabled,
          },
        },
        tx,
      );

      return capability;
    });
  }

  async listCapabilities(organizationId: string, agentProviderId?: string) {
    return this.prisma.providerCapability.findMany({
      where: {
        organizationId,
        ...(agentProviderId ? { agentProviderId } : {}),
      },
      orderBy: [{ capabilityCode: 'asc' }, { agentProviderId: 'asc' }],
    });
  }

  // -------------------------------------------------------------------------
  // Delete (soft-disable)
  // -------------------------------------------------------------------------

  async disableProvider(organizationId: string, providerId: string) {
    return this.updateProvider({
      organizationId,
      providerId,
      status: 'DISABLED',
    });
  }
}
