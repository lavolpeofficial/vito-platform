export type MissionContextSnapshot = Readonly<{
  missionId: string;
  objective: string;
  workflow: Readonly<{
    definitionCode: string;
    definitionVersion: string;
    status: string;
    currentStepType: string | null;
    assuranceLevel: string;
  }>;
  progress: Readonly<{
    completedSteps: readonly string[];
    currentStepType: string | null;
    correctionLoopCount: number;
    maxCorrectionLoops: number;
  }>;
  governance: Readonly<{
    waitingForHuman: boolean;
    recentEvents: readonly Readonly<{ action: string; createdAt: string }>[];
  }>;
  memoryRefs: readonly Readonly<{
    id: string;
    kind: string;
    title: string;
    sourceType: string;
    sourceRef: string | null;
    confidence: number | null;
  }>[];
  outcome: Readonly<{
    terminal: boolean;
    status: string;
    blockReasonCode: string | null;
    failureReasonCode: string | null;
  }>;
  authority: 'ADVISORY_CONTEXT';
}>;

export function parseMissionContextSnapshot(input: unknown): MissionContextSnapshot | null {
  const root = record(input);
  const workflow = record(root?.workflow);
  const progress = record(root?.progress);
  const governance = record(root?.governance);
  const outcome = record(root?.outcome);
  if (!root || !workflow || !progress || !governance || !outcome) return null;
  if (!text(root.missionId) || !text(root.objective) || root.authority !== 'ADVISORY_CONTEXT') return null;
  if (!text(workflow.definitionCode) || !text(workflow.definitionVersion) || !text(workflow.status) || !nullableText(workflow.currentStepType) || !text(workflow.assuranceLevel)) return null;
  if (!Array.isArray(progress.completedSteps) || progress.completedSteps.length > 100 || !progress.completedSteps.every(text)) return null;
  if (!nullableText(progress.currentStepType) || !integer(progress.correctionLoopCount) || !integer(progress.maxCorrectionLoops)) return null;
  if (typeof governance.waitingForHuman !== 'boolean' || !Array.isArray(governance.recentEvents) || governance.recentEvents.length > 12) return null;
  const recentEvents: Array<{ action: string; createdAt: string }> = [];
  for (const event of governance.recentEvents) {
    const item = record(event);
    if (!item || !text(item.action) || !date(item.createdAt)) return null;
    recentEvents.push({ action: item.action, createdAt: item.createdAt });
  }
  if (!Array.isArray(root.memoryRefs) || root.memoryRefs.length > 8) return null;
  const memoryRefs: Array<{ id: string; kind: string; title: string; sourceType: string; sourceRef: string | null; confidence: number | null }> = [];
  for (const item of root.memoryRefs) {
    const row = record(item);
    if (!row || !text(row.id) || !text(row.kind) || !text(row.title) || !text(row.sourceType) || !nullableText(row.sourceRef)) return null;
    if (row.confidence !== null && (typeof row.confidence !== 'number' || row.confidence < 0 || row.confidence > 1)) return null;
    memoryRefs.push({ id: row.id, kind: row.kind, title: row.title, sourceType: row.sourceType, sourceRef: row.sourceRef, confidence: row.confidence });
  }
  if (typeof outcome.terminal !== 'boolean' || !text(outcome.status) || !nullableText(outcome.blockReasonCode) || !nullableText(outcome.failureReasonCode)) return null;

  return {
    missionId: root.missionId,
    objective: root.objective,
    workflow: {
      definitionCode: workflow.definitionCode,
      definitionVersion: workflow.definitionVersion,
      status: workflow.status,
      currentStepType: workflow.currentStepType,
      assuranceLevel: workflow.assuranceLevel,
    },
    progress: {
      completedSteps: progress.completedSteps as string[],
      currentStepType: progress.currentStepType,
      correctionLoopCount: progress.correctionLoopCount,
      maxCorrectionLoops: progress.maxCorrectionLoops,
    },
    governance: { waitingForHuman: governance.waitingForHuman, recentEvents },
    memoryRefs,
    outcome: {
      terminal: outcome.terminal,
      status: outcome.status,
      blockReasonCode: outcome.blockReasonCode,
      failureReasonCode: outcome.failureReasonCode,
    },
    authority: 'ADVISORY_CONTEXT',
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4000; }
function nullableText(value: unknown): value is string | null { return value === null || text(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function date(value: unknown): value is string { return text(value) && !Number.isNaN(Date.parse(value)); }
