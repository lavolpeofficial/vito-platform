export type OperationsAttentionRun = Readonly<{
  id: string;
  status: string;
  currentStepType: string | null;
  blockReasonCode: string | null;
  failureReasonCode: string | null;
  correlationId: string | null;
  updatedAt: string;
}>;

export type OperationsCapabilityGap = Readonly<{
  capabilityCode: string;
  readiness: string;
  enabledProviderCount: number;
}>;

export type OperationsSummary = Readonly<{
  organizationId: string;
  observedAt: string;
  authority: 'READ_ONLY';
  workflows: Readonly<{
    total: number;
    byStatus: Readonly<Record<string, number>>;
    attentionCount: number;
    recentAttention: readonly OperationsAttentionRun[];
    attentionLimit: number;
  }>;
  workforce: Readonly<{ total: number; byStatus: Readonly<Record<string, number>> }>;
  knowledge: Readonly<{
    sources: Readonly<{ total: number; byIngestionStatus: Readonly<Record<string, number>> }>;
    knowledgeUnits: number;
  }>;
  memory: Readonly<{ total: number; byStatus: Readonly<Record<string, number>> }>;
  governance: Readonly<{ pendingSkillPromotionReviews: number }>;
  providers: Readonly<{
    registeredCount: number;
    routingWindowDecisionCount: number;
    capabilityGapCount: number;
    capabilityGaps: readonly OperationsCapabilityGap[];
  }>;
}>;

export function parseOperationsSummary(input: unknown): OperationsSummary | null {
  const root = asRecord(input);
  if (!root || !isString(root.organizationId) || !isIsoDate(root.observedAt) || root.authority !== 'READ_ONLY') return null;

  const workflows = asRecord(root.workflows);
  const workforce = asRecord(root.workforce);
  const knowledge = asRecord(root.knowledge);
  const memory = asRecord(root.memory);
  const governance = asRecord(root.governance);
  const providers = asRecord(root.providers);
  if (!workflows || !workforce || !knowledge || !memory || !governance || !providers) return null;

  const sources = asRecord(knowledge.sources);
  if (!sources) return null;

  const workflowStatuses = parseCountRecord(workflows.byStatus);
  const employeeStatuses = parseCountRecord(workforce.byStatus);
  const sourceStatuses = parseCountRecord(sources.byIngestionStatus);
  const memoryStatuses = parseCountRecord(memory.byStatus);
  const recentAttention = parseAttentionRuns(workflows.recentAttention);
  const capabilityGaps = parseCapabilityGaps(providers.capabilityGaps);
  if (!workflowStatuses || !employeeStatuses || !sourceStatuses || !memoryStatuses || !recentAttention || !capabilityGaps) return null;

  if (
    !isNonNegativeInteger(workflows.total) ||
    !isNonNegativeInteger(workflows.attentionCount) ||
    !isNonNegativeInteger(workflows.attentionLimit) ||
    !isNonNegativeInteger(workforce.total) ||
    !isNonNegativeInteger(sources.total) ||
    !isNonNegativeInteger(knowledge.knowledgeUnits) ||
    !isNonNegativeInteger(memory.total) ||
    !isNonNegativeInteger(governance.pendingSkillPromotionReviews) ||
    !isNonNegativeInteger(providers.registeredCount) ||
    !isNonNegativeInteger(providers.routingWindowDecisionCount) ||
    !isNonNegativeInteger(providers.capabilityGapCount)
  ) return null;

  return {
    organizationId: root.organizationId,
    observedAt: root.observedAt,
    authority: 'READ_ONLY',
    workflows: {
      total: workflows.total,
      byStatus: workflowStatuses,
      attentionCount: workflows.attentionCount,
      recentAttention,
      attentionLimit: workflows.attentionLimit,
    },
    workforce: { total: workforce.total, byStatus: employeeStatuses },
    knowledge: {
      sources: { total: sources.total, byIngestionStatus: sourceStatuses },
      knowledgeUnits: knowledge.knowledgeUnits,
    },
    memory: { total: memory.total, byStatus: memoryStatuses },
    governance: { pendingSkillPromotionReviews: governance.pendingSkillPromotionReviews },
    providers: {
      registeredCount: providers.registeredCount,
      routingWindowDecisionCount: providers.routingWindowDecisionCount,
      capabilityGapCount: providers.capabilityGapCount,
      capabilityGaps,
    },
  };
}

function parseAttentionRuns(value: unknown): readonly OperationsAttentionRun[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const result: OperationsAttentionRun[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row || !isString(row.id) || !isString(row.status) || !isNullableString(row.currentStepType) || !isNullableString(row.blockReasonCode) || !isNullableString(row.failureReasonCode) || !isNullableString(row.correlationId) || !isIsoDate(row.updatedAt)) return null;
    result.push({
      id: row.id,
      status: row.status,
      currentStepType: row.currentStepType,
      blockReasonCode: row.blockReasonCode,
      failureReasonCode: row.failureReasonCode,
      correlationId: row.correlationId,
      updatedAt: row.updatedAt,
    });
  }
  return result;
}

function parseCapabilityGaps(value: unknown): readonly OperationsCapabilityGap[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const result: OperationsCapabilityGap[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row || !isString(row.capabilityCode) || !isString(row.readiness) || !isNonNegativeInteger(row.enabledProviderCount)) return null;
    result.push({ capabilityCode: row.capabilityCode, readiness: row.readiness, enabledProviderCount: row.enabledProviderCount });
  }
  return result;
}

function parseCountRecord(value: unknown): Readonly<Record<string, number>> | null {
  const record = asRecord(value);
  if (!record || Object.keys(record).length > 100) return null;
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(record)) {
    if (!key || key.length > 100 || !isNonNegativeInteger(count)) return null;
    result[key] = count;
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isIsoDate(value: unknown): value is string {
  return isString(value) && !Number.isNaN(Date.parse(value));
}
