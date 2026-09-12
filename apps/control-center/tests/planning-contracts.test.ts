import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGoalPlan, parseGoalWorkflowMaterialization } from '../lib/planning/contracts.ts';

const valid = {
  plannerVersion: '1', planningMode: 'TEMPLATE_GROUNDED', goalClass: 'ENGINEERING_CHANGE', goal: 'Ship a governed technical change safely', assuranceLevel: 'AL3', providerSelection: 'DEFERRED_TO_PROVIDER_ROUTER', requiresHumanReleaseApproval: true,
  steps: [{ order: 1, stepType: 'PLAN', capabilityCode: 'engineering.plan', executionAuthority: 'AGENT_WORKFORCE', humanBoundary: false, conditional: false }, { order: 2, stepType: 'HUMAN_RELEASE_GATE', capabilityCode: null, executionAuthority: 'WORKFLOW_GOVERNANCE', humanBoundary: true, conditional: false }],
  correctionLoop: { stepType: 'CORRECTION', capabilityCode: 'engineering.correct', executionAuthority: 'AGENT_WORKFORCE', trigger: 'TEST_FAILURE_OR_REVIEW_VERDICT_C', returnsTo: 'TEST', maxLoops: 3 },
  knowledgeEvidence: [{ knowledgeUnitId: 'ku-1', sourceId: 'src-1', locatorType: 'PAGE', locatorValue: '2', content: 'Relevant evidence', rank: 1 }], memoryEvidence: [{ memoryEntryId: 'mem-1', kind: 'OUTCOME', scope: 'ORGANIZATION', title: 'Prior result', content: 'Useful memory', sourceType: 'WORKFLOW', sourceRef: 'wf-1', confidence: 0.9 }], executable: false, nextAction: 'CREATE_GOVERNED_WORKFLOW_FROM_APPROVED_PLAN',
} as const;

const materialized = {
  plan: valid,
  task: { id: 'task-1', title: valid.goal, status: 'PENDING' },
  workflowRun: { id: 'run-1', taskId: 'task-1', status: 'CREATED', currentStepType: null, workflowDefinitionCode: 'ENGINEERING_CHANGE', workflowDefinitionVersion: '1', assuranceLevel: 'AL3', correlationId: 'corr-1' },
  started: false,
  executionAuthorityGranted: false,
  providerSelection: 'DEFERRED_TO_PROVIDER_ROUTER',
  requiresHumanReleaseApproval: true,
  nextAction: 'START_GOVERNED_WORKFLOW',
} as const;

test('accepts the server-owned non-executable planning contract', () => { const parsed = parseGoalPlan(valid); assert.ok(parsed); assert.equal(parsed.executable, false); assert.equal(parsed.steps[1]?.humanBoundary, true); });
test('rejects a response that claims executable authority', () => { assert.equal(parseGoalPlan({ ...valid, executable: true }), null); });
test('rejects a response that bypasses human release approval', () => { assert.equal(parseGoalPlan({ ...valid, requiresHumanReleaseApproval: false }), null); });
test('rejects browser-selected provider semantics', () => { assert.equal(parseGoalPlan({ ...valid, providerSelection: 'OPENAI' }), null); });
test('accepts CREATED-only governed workflow materialization', () => { const parsed = parseGoalWorkflowMaterialization(materialized); assert.ok(parsed); assert.equal(parsed.started, false); assert.equal(parsed.executionAuthorityGranted, false); assert.equal(parsed.workflowRun.status, 'CREATED'); });
test('rejects workflow materialization that starts execution', () => { assert.equal(parseGoalWorkflowMaterialization({ ...materialized, started: true }), null); });
test('rejects workflow materialization that grants execution authority', () => { assert.equal(parseGoalWorkflowMaterialization({ ...materialized, executionAuthorityGranted: true }), null); });
test('rejects workflow materialization that bypasses the human release boundary', () => { assert.equal(parseGoalWorkflowMaterialization({ ...materialized, requiresHumanReleaseApproval: false }), null); });
test('rejects task and workflow identity mismatch', () => { assert.equal(parseGoalWorkflowMaterialization({ ...materialized, workflowRun: { ...materialized.workflowRun, taskId: 'task-2' } }), null); });
test('rejects non-CREATED materialization responses', () => { assert.equal(parseGoalWorkflowMaterialization({ ...materialized, workflowRun: { ...materialized.workflowRun, status: 'RUNNING' } }), null); });
