import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AgentExecutionStatus,
  ProviderHealthStatus,
  ProviderQuotaStatus,
  type GovernedCapabilityInvocationResult,
  type ProviderDeclaration,
} from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DEFAULT_HEALTHY_TTL_MS = 5 * 60_000;
const DEFAULT_FAILURE_BACKOFF_MS = 15 * 60_000;
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 6 * 60 * 60_000;

export interface ProviderRuntimeObservation {
  readonly healthStatus: ProviderHealthStatus;
  readonly quotaStatus: ProviderQuotaStatus;
  readonly reasonCode: string;
  readonly durationMs?: number;
  readonly observedProviderId?: string | null;
  readonly observedModelId?: string | null;
}

@Injectable()
export class ProviderRuntimeStateService {
  private readonly healthyTtlMs = boundedMs(
    process.env.VITO_PROVIDER_STATE_TTL_MS,
    DEFAULT_HEALTHY_TTL_MS,
  );
  private readonly failureBackoffMs = boundedMs(
    process.env.VITO_PROVIDER_FAILURE_BACKOFF_MS,
    DEFAULT_FAILURE_BACKOFF_MS,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  isHealthFresh(provider: Pick<ProviderDeclaration, 'healthStatus' | 'healthCheckedAt'>, now = Date.now()): boolean {
    const checkedAt = provider.healthCheckedAt;
    if (!(checkedAt instanceof Date)) return false;
    return now - checkedAt.getTime() <= this.healthTtl(provider.healthStatus);
  }

  isQuotaFresh(provider: Pick<ProviderDeclaration, 'quotaStatus' | 'quotaCheckedAt'>, now = Date.now()): boolean {
    const checkedAt = provider.quotaCheckedAt;
    if (!(checkedAt instanceof Date)) return false;
    return now - checkedAt.getTime() <= this.quotaTtl(provider.quotaStatus);
  }

  needsRefresh(
    provider: Pick<ProviderDeclaration, 'healthStatus' | 'healthCheckedAt' | 'quotaStatus' | 'quotaCheckedAt'>,
    now = Date.now(),
  ): boolean {
    return !this.isHealthFresh(provider, now) || !this.isQuotaFresh(provider, now);
  }

  async recordProbe(
    organizationId: string,
    providerId: string,
    observation: ProviderRuntimeObservation,
  ): Promise<void> {
    const checkedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.agentProvider.updateMany({
        where: { id: providerId, organizationId },
        data: {
          healthStatus: observation.healthStatus as any,
          healthCheckedAt: checkedAt,
          quotaStatus: observation.quotaStatus as any,
          quotaCheckedAt: checkedAt,
        },
      });
      if (updated.count !== 1) throw new NotFoundException('Provider not found.');
      await this.audit.record({
        organizationId,
        actorType: 'SYSTEM',
        action: 'PROVIDER_RUNTIME_PROBED',
        entityType: 'AgentProvider',
        entityId: providerId,
        metadata: {
          healthStatus: observation.healthStatus,
          quotaStatus: observation.quotaStatus,
          reasonCode: observation.reasonCode,
          durationMs: observation.durationMs ?? null,
          observedProviderId: observation.observedProviderId ?? null,
          observedModelId: observation.observedModelId ?? null,
          checkedAt: checkedAt.toISOString(),
        },
      }, tx);
    });
  }

  async observeExecution(
    organizationId: string,
    providerId: string,
    execution: GovernedCapabilityInvocationResult,
  ): Promise<void> {
    if (execution.status === AgentExecutionStatus.SUCCEEDED) {
      await this.recordProbe(organizationId, providerId, {
        healthStatus: ProviderHealthStatus.HEALTHY,
        quotaStatus: ProviderQuotaStatus.AVAILABLE,
        reasonCode: 'EXECUTION_SUCCEEDED',
        durationMs: execution.durationMs,
        ...observedIdentity(execution.providerExecutionMetadata),
      });
      return;
    }

    if (execution.status === AgentExecutionStatus.QUOTA_BLOCKED || hasQuotaSignal(execution)) {
      const limited = hasRateLimitSignal(execution);
      await this.recordProbe(organizationId, providerId, {
        healthStatus: limited ? ProviderHealthStatus.QUOTA_LIMITED : ProviderHealthStatus.HEALTHY,
        quotaStatus: limited ? ProviderQuotaStatus.LIMITED : ProviderQuotaStatus.EXHAUSTED,
        reasonCode: limited ? 'EXECUTION_RATE_LIMITED' : 'EXECUTION_QUOTA_EXHAUSTED',
        durationMs: execution.durationMs,
        ...observedIdentity(execution.providerExecutionMetadata),
      });
      return;
    }

    if (
      execution.status === AgentExecutionStatus.TIMED_OUT ||
      (execution.status === AgentExecutionStatus.FAILED && execution.normalizedError?.retryable === true)
    ) {
      await this.recordProbe(organizationId, providerId, {
        healthStatus: ProviderHealthStatus.UNAVAILABLE,
        quotaStatus: ProviderQuotaStatus.UNKNOWN,
        reasonCode: execution.status === AgentExecutionStatus.TIMED_OUT
          ? 'EXECUTION_TIMED_OUT'
          : 'EXECUTION_RETRYABLE_FAILURE',
        durationMs: execution.durationMs,
        ...observedIdentity(execution.providerExecutionMetadata),
      });
    }
  }

  private healthTtl(status: ProviderHealthStatus): number {
    return status === ProviderHealthStatus.HEALTHY || status === ProviderHealthStatus.DEGRADED
      ? this.healthyTtlMs
      : this.failureBackoffMs;
  }

  private quotaTtl(status: ProviderQuotaStatus): number {
    return status === ProviderQuotaStatus.AVAILABLE || status === ProviderQuotaStatus.LIMITED
      ? this.healthyTtlMs
      : this.failureBackoffMs;
  }
}

function boundedMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_TTL_MS || parsed > MAX_TTL_MS) {
    return fallback;
  }
  return parsed;
}

function executionText(execution: GovernedCapabilityInvocationResult): string {
  const error = execution.normalizedError;
  return JSON.stringify({
    reason: error?.reason ?? null,
    message: error?.message ?? null,
    providerMetadata: error?.providerMetadata ?? null,
    providerExecutionMetadata: execution.providerExecutionMetadata ?? null,
  }).toLowerCase();
}

function hasQuotaSignal(execution: GovernedCapabilityInvocationResult): boolean {
  const text = executionText(execution);
  return /usage limit has been reached|insufficient[_ -]?quota|quota[_ -]?(exceeded|exhausted)/u.test(text);
}

function hasRateLimitSignal(execution: GovernedCapabilityInvocationResult): boolean {
  const text = executionText(execution);
  return /rate[_ -]?limit|too many requests|\b429\b/u.test(text) && !/usage limit has been reached/u.test(text);
}

function observedIdentity(metadata: Record<string, unknown>) {
  const raw = metadata.providerIdentityPostcondition;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { observedProviderId: null, observedModelId: null } as const;
  }
  const value = raw as Record<string, unknown>;
  return {
    observedProviderId: typeof value.observedProviderId === 'string' ? value.observedProviderId : null,
    observedModelId: typeof value.observedModelId === 'string' ? value.observedModelId : null,
  } as const;
}
