export type WorkflowNextAction = 'START_RUN' | 'EXECUTE_CURRENT_STEP' | 'RESUME_RUN' | 'HUMAN_REVIEW_REQUIRED' | 'NONE';
export type WorkflowBoundary = 'NOT_STARTED' | 'ACTIVE' | 'BLOCKED' | 'TERMINAL_COMPLETE' | 'TERMINAL_FAILURE' | 'UNKNOWN';

export type WorkflowStepSnapshot = Readonly<{
  id: string;
  stepType: string;
  status: string;
  attemptNumber: number;
  causationId: string | null;
  startedAt: string;
  finishedAt: string | null;
}>;

export type WorkflowTimelineEvent = Readonly<{
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}>;

export type WorkflowSnapshot = Readonly<{
  workflowRunId: string;
  organizationId: string;
  correlationId: string | null;
  status: string;
  currentStepType: string | null;
  boundary: WorkflowBoundary;
  nextAction: WorkflowNextAction;
  blockReasonCode: string | null;
  failureReasonCode: string | null;
  correctionLoopCount: number;
  maxCorrectionLoops: number;
  startedAt: string | null;
  completedAt: string | null;
  steps: readonly WorkflowStepSnapshot[];
  timeline: readonly WorkflowTimelineEvent[];
  timelineTruncated: boolean;
  observedAt: string;
  authority: 'READ_ONLY';
}>;

const BOUNDARIES = new Set<WorkflowBoundary>(['NOT_STARTED', 'ACTIVE', 'BLOCKED', 'TERMINAL_COMPLETE', 'TERMINAL_FAILURE', 'UNKNOWN']);
const NEXT_ACTIONS = new Set<WorkflowNextAction>(['START_RUN', 'EXECUTE_CURRENT_STEP', 'RESUME_RUN', 'HUMAN_REVIEW_REQUIRED', 'NONE']);

export function parseWorkflowSnapshot(input: unknown): WorkflowSnapshot | null {
  const root = record(input);
  if (!root || !text(root.workflowRunId) || !text(root.organizationId) || !nullableText(root.correlationId) || !text(root.status) || !nullableText(root.currentStepType)) return null;
  if (!BOUNDARIES.has(root.boundary as WorkflowBoundary) || !NEXT_ACTIONS.has(root.nextAction as WorkflowNextAction) || root.authority !== 'READ_ONLY') return null;
  if (!nullableText(root.blockReasonCode) || !nullableText(root.failureReasonCode) || !integer(root.correctionLoopCount) || !integer(root.maxCorrectionLoops)) return null;
  if (!nullableDate(root.startedAt) || !nullableDate(root.completedAt) || !date(root.observedAt) || typeof root.timelineTruncated !== 'boolean') return null;

  const steps = parseSteps(root.steps);
  const timeline = parseTimeline(root.timeline);
  if (!steps || !timeline) return null;

  return {
    workflowRunId: root.workflowRunId,
    organizationId: root.organizationId,
    correlationId: root.correlationId,
    status: root.status,
    currentStepType: root.currentStepType,
    boundary: root.boundary as WorkflowBoundary,
    nextAction: root.nextAction as WorkflowNextAction,
    blockReasonCode: root.blockReasonCode,
    failureReasonCode: root.failureReasonCode,
    correctionLoopCount: root.correctionLoopCount,
    maxCorrectionLoops: root.maxCorrectionLoops,
    startedAt: root.startedAt,
    completedAt: root.completedAt,
    steps,
    timeline,
    timelineTruncated: root.timelineTruncated,
    observedAt: root.observedAt,
    authority: 'READ_ONLY',
  };
}

export function parseMutationResult(input: unknown): Record<string, unknown> | null {
  return record(input);
}

function parseSteps(value: unknown): readonly WorkflowStepSnapshot[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const result: WorkflowStepSnapshot[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row || !text(row.id) || !text(row.stepType) || !text(row.status) || !integer(row.attemptNumber) || !nullableText(row.causationId) || !date(row.startedAt) || !nullableDate(row.finishedAt)) return null;
    result.push({ id: row.id, stepType: row.stepType, status: row.status, attemptNumber: row.attemptNumber, causationId: row.causationId, startedAt: row.startedAt, finishedAt: row.finishedAt });
  }
  return result;
}

function parseTimeline(value: unknown): readonly WorkflowTimelineEvent[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const result: WorkflowTimelineEvent[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row || !text(row.id) || !text(row.actorType) || !nullableText(row.actorId) || !text(row.action) || !text(row.entityType) || !text(row.entityId) || !date(row.createdAt)) return null;
    result.push({ id: row.id, actorType: row.actorType, actorId: row.actorId, action: row.action, entityType: row.entityType, entityId: row.entityId, createdAt: row.createdAt });
  }
  return result;
}

function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 1024; }
function nullableText(value: unknown): value is string | null { return value === null || text(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function date(value: unknown): value is string { return text(value) && !Number.isNaN(Date.parse(value)); }
function nullableDate(value: unknown): value is string | null { return value === null || date(value); }
