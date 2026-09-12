export type AssuranceLevel = 'AL1' | 'AL2' | 'AL3' | 'AL4';
export type ExecutionAuthority = 'AGENT_WORKFORCE' | 'WORKFLOW_GOVERNANCE';

export type GoalPlanStep = Readonly<{
  order: number;
  stepType: string;
  capabilityCode: string | null;
  executionAuthority: ExecutionAuthority;
  humanBoundary: boolean;
  conditional: boolean;
}>;

export type KnowledgeEvidence = Readonly<{
  knowledgeUnitId: string;
  sourceId: string;
  locatorType: string | null;
  locatorValue: string | null;
  content: string;
  rank: number;
}>;

export type MemoryEvidence = Readonly<{
  memoryEntryId: string;
  kind: string;
  scope: string;
  title: string;
  content: string;
  sourceType: string;
  sourceRef: string | null;
  confidence: number;
}>;

export type GoalPlan = Readonly<{
  plannerVersion: string;
  planningMode: 'TEMPLATE_GROUNDED';
  goalClass: 'ENGINEERING_CHANGE';
  goal: string;
  assuranceLevel: AssuranceLevel;
  providerSelection: 'DEFERRED_TO_PROVIDER_ROUTER';
  requiresHumanReleaseApproval: true;
  steps: readonly GoalPlanStep[];
  correctionLoop: Readonly<{
    stepType: string;
    capabilityCode: string | null;
    executionAuthority: 'AGENT_WORKFORCE';
    trigger: string;
    returnsTo: string;
    maxLoops: number;
  }>;
  knowledgeEvidence: readonly KnowledgeEvidence[];
  memoryEvidence: readonly MemoryEvidence[];
  executable: false;
  nextAction: 'CREATE_GOVERNED_WORKFLOW_FROM_APPROVED_PLAN';
}>;

export type GoalWorkflowMaterialization = Readonly<{
  plan: GoalPlan;
  task: Readonly<{ id: string; title: string; status: string }>;
  workflowRun: Readonly<{
    id: string;
    taskId: string;
    status: 'CREATED';
    currentStepType: null;
    workflowDefinitionCode: 'ENGINEERING_CHANGE';
    workflowDefinitionVersion: string;
    assuranceLevel: AssuranceLevel;
    correlationId: string;
  }>;
  started: false;
  executionAuthorityGranted: false;
  providerSelection: 'DEFERRED_TO_PROVIDER_ROUTER';
  requiresHumanReleaseApproval: true;
  nextAction: 'START_GOVERNED_WORKFLOW';
}>;

export function parseGoalPlan(input: unknown): GoalPlan | null {
  const root = record(input);
  if (!root || !text(root.plannerVersion, 64) || root.planningMode !== 'TEMPLATE_GROUNDED' || root.goalClass !== 'ENGINEERING_CHANGE' || !text(root.goal, 2000) || !assurance(root.assuranceLevel) || root.providerSelection !== 'DEFERRED_TO_PROVIDER_ROUTER' || root.requiresHumanReleaseApproval !== true || root.executable !== false || root.nextAction !== 'CREATE_GOVERNED_WORKFLOW_FROM_APPROVED_PLAN') return null;
  if (!Array.isArray(root.steps) || root.steps.length === 0 || root.steps.length > 100 || !Array.isArray(root.knowledgeEvidence) || root.knowledgeEvidence.length > 20 || !Array.isArray(root.memoryEvidence) || root.memoryEvidence.length > 20) return null;
  const steps = root.steps.map(parseStep); if (steps.some((value) => !value)) return null;
  const knowledgeEvidence = root.knowledgeEvidence.map(parseKnowledge); if (knowledgeEvidence.some((value) => !value)) return null;
  const memoryEvidence = root.memoryEvidence.map(parseMemory); if (memoryEvidence.some((value) => !value)) return null;
  const loop = record(root.correctionLoop);
  if (!loop || !text(loop.stepType, 128) || !(loop.capabilityCode === null || text(loop.capabilityCode, 256)) || loop.executionAuthority !== 'AGENT_WORKFORCE' || !text(loop.trigger, 256) || !text(loop.returnsTo, 128) || !integer(loop.maxLoops)) return null;
  return { plannerVersion: root.plannerVersion, planningMode: 'TEMPLATE_GROUNDED', goalClass: 'ENGINEERING_CHANGE', goal: root.goal, assuranceLevel: root.assuranceLevel, providerSelection: 'DEFERRED_TO_PROVIDER_ROUTER', requiresHumanReleaseApproval: true, steps: steps as GoalPlanStep[], correctionLoop: { stepType: loop.stepType, capabilityCode: loop.capabilityCode as string | null, executionAuthority: 'AGENT_WORKFORCE', trigger: loop.trigger, returnsTo: loop.returnsTo, maxLoops: loop.maxLoops }, knowledgeEvidence: knowledgeEvidence as KnowledgeEvidence[], memoryEvidence: memoryEvidence as MemoryEvidence[], executable: false, nextAction: 'CREATE_GOVERNED_WORKFLOW_FROM_APPROVED_PLAN' };
}

export function parseGoalWorkflowMaterialization(input: unknown): GoalWorkflowMaterialization | null {
  const root = record(input);
  if (!root || root.started !== false || root.executionAuthorityGranted !== false || root.providerSelection !== 'DEFERRED_TO_PROVIDER_ROUTER' || root.requiresHumanReleaseApproval !== true || root.nextAction !== 'START_GOVERNED_WORKFLOW') return null;
  const plan = parseGoalPlan(root.plan);
  const task = record(root.task);
  const workflowRun = record(root.workflowRun);
  if (!plan || !task || !text(task.id, 256) || !text(task.title, 200) || !text(task.status, 64)) return null;
  if (!workflowRun || !text(workflowRun.id, 256) || workflowRun.taskId !== task.id || workflowRun.status !== 'CREATED' || workflowRun.currentStepType !== null || workflowRun.workflowDefinitionCode !== 'ENGINEERING_CHANGE' || workflowRun.workflowDefinitionVersion !== plan.plannerVersion || !assurance(workflowRun.assuranceLevel) || workflowRun.assuranceLevel !== plan.assuranceLevel || !text(workflowRun.correlationId, 256)) return null;
  return {
    plan,
    task: { id: task.id, title: task.title, status: task.status },
    workflowRun: {
      id: workflowRun.id,
      taskId: workflowRun.taskId,
      status: 'CREATED',
      currentStepType: null,
      workflowDefinitionCode: 'ENGINEERING_CHANGE',
      workflowDefinitionVersion: workflowRun.workflowDefinitionVersion,
      assuranceLevel: workflowRun.assuranceLevel,
      correlationId: workflowRun.correlationId,
    },
    started: false,
    executionAuthorityGranted: false,
    providerSelection: 'DEFERRED_TO_PROVIDER_ROUTER',
    requiresHumanReleaseApproval: true,
    nextAction: 'START_GOVERNED_WORKFLOW',
  };
}

function parseStep(value: unknown): GoalPlanStep | null { const row = record(value); if (!row || !integer(row.order) || !text(row.stepType, 128) || !(row.capabilityCode === null || text(row.capabilityCode, 256)) || !authority(row.executionAuthority) || typeof row.humanBoundary !== 'boolean' || typeof row.conditional !== 'boolean') return null; return { order: row.order, stepType: row.stepType, capabilityCode: row.capabilityCode as string | null, executionAuthority: row.executionAuthority, humanBoundary: row.humanBoundary, conditional: row.conditional }; }
function parseKnowledge(value: unknown): KnowledgeEvidence | null { const row = record(value); if (!row || !text(row.knowledgeUnitId, 256) || !text(row.sourceId, 256) || !(row.locatorType === null || text(row.locatorType, 128)) || !(row.locatorValue === null || text(row.locatorValue, 512)) || !text(row.content, 10000) || !number(row.rank)) return null; return { knowledgeUnitId: row.knowledgeUnitId, sourceId: row.sourceId, locatorType: row.locatorType as string | null, locatorValue: row.locatorValue as string | null, content: row.content, rank: row.rank }; }
function parseMemory(value: unknown): MemoryEvidence | null { const row = record(value); if (!row || !text(row.memoryEntryId, 256) || !text(row.kind, 128) || !text(row.scope, 128) || !text(row.title, 256) || !text(row.content, 2000) || !text(row.sourceType, 256) || !(row.sourceRef === null || text(row.sourceRef, 256)) || !number(row.confidence)) return null; return { memoryEntryId: row.memoryEntryId, kind: row.kind, scope: row.scope, title: row.title, content: row.content, sourceType: row.sourceType, sourceRef: row.sourceRef as string | null, confidence: row.confidence }; }
function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function assurance(value: unknown): value is AssuranceLevel { return value === 'AL1' || value === 'AL2' || value === 'AL3' || value === 'AL4'; }
function authority(value: unknown): value is ExecutionAuthority { return value === 'AGENT_WORKFORCE' || value === 'WORKFLOW_GOVERNANCE'; }
