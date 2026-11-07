import type { OperationsSummary } from '../operations/contracts';

export type ExecutiveAttentionItem = Readonly<{
  id: string;
  status: 'BLOCKED' | 'FAILED';
  reason: string | null;
  updatedAt: string;
}>;

export type ExecutiveOperationsSnapshot = Readonly<{
  observedAt: string;
  totalWorkflows: number;
  blocked: number;
  failed: number;
  running: number;
  pending: number;
  digitalEmployees: number;
  governanceReviews: number;
  providerGaps: number;
  recentAttention: readonly ExecutiveAttentionItem[];
}>;

const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

/**
 * OWNER/ADMIN server-side, tenant-bound read projection over the existing
 * VITO /operations/summary API. This never infers semantic task completion.
 * Missing, contradictory, cross-tenant or stale data fails CLOSED.
 */
export function projectExecutiveOperations(
  source: OperationsSummary,
  expectedOrganizationId: string,
  nowMs: number,
): ExecutiveOperationsSnapshot | null {
  if (
    source.authority !== 'READ_ONLY' ||
    !expectedOrganizationId ||
    source.organizationId !== expectedOrganizationId ||
    !Number.isFinite(nowMs)
  ) return null;

  const observedMs = Date.parse(source.observedAt);
  if (!Number.isFinite(observedMs) ||
      observedMs < nowMs - MAX_AGE_MS ||
      observedMs > nowMs + MAX_FUTURE_SKEW_MS) return null;

  const byStatus = source.workflows.byStatus;
  const statusValues = Object.values(byStatus);
  if (statusValues.some(x => !Number.isSafeInteger(x) || x < 0)) return null;
  const summed = statusValues.reduce((a,b) => a + b, 0);
  if (!Number.isSafeInteger(summed) || summed !== source.workflows.total) return null;
  if (source.workflows.attentionCount > source.workflows.total ||
      source.workflows.recentAttention.length > source.workflows.attentionLimit) return null;

  const count = (name: string) => byStatus[name] ?? 0;
  const attention = source.workflows.recentAttention
    .filter(x => x.status === 'BLOCKED' || x.status === 'FAILED')
    .slice(0, 5)
    .map(x => ({
      id: x.id,
      status: x.status as 'BLOCKED' | 'FAILED',
      reason: x.blockReasonCode ?? x.failureReasonCode,
      updatedAt: x.updatedAt,
    }));

  return {
    observedAt: source.observedAt,
    totalWorkflows: source.workflows.total,
    blocked: count('BLOCKED'),
    failed: count('FAILED'),
    running: count('RUNNING'),
    pending: count('PENDING'),
    digitalEmployees: source.workforce.total,
    governanceReviews: source.governance.pendingSkillPromotionReviews,
    providerGaps: source.providers.capabilityGapCount,
    recentAttention: attention,
  };
}
