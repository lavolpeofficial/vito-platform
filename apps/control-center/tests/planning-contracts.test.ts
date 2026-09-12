import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGoalPlan } from '../lib/planning/contracts.ts';

const valid = {
  plannerVersion: '1', planningMode: 'TEMPLATE_GROUNDED', goalClass: 'ENGINEERING_CHANGE', goal: 'Ship a governed technical change safely', assuranceLevel: 'AL3', providerSelection: 'DEFERRED_TO_PROVIDER_ROUTER', requiresHumanReleaseApproval: true,
  steps: [{ order: 1, stepType: 'PLAN', capabilityCode: 'engineering.plan', executionAuthority: 'AGENT_WORKFORCE', humanBoundary: false, conditional: false }, { order: 2, stepType: 'HUMAN_RELEASE_GATE', capabilityCode: null, executionAuthority: 'WORKFLOW_GOVERNANCE', humanBoundary: true, conditional: false }],
  correctionLoop: { stepType: 'CORRECTION', capabilityCode: 'engineering.correct', executionAuthority: 'AGENT_WORKFORCE', trigger: 'TEST_FAILURE_OR_REVIEW_VERDICT_C', returnsTo: 'TEST', maxLoops: 3 },
  knowledgeEvidence: [{ knowledgeUnitId: 'ku-1', sourceId: 'src-1', locatorType: 'PAGE', locatorValue: '2', content: 'Relevant evidence', rank: 1 }], memoryEvidence: [{ memoryEntryId: 'mem-1', kind: 'OUTCOME', scope: 'ORGANIZATION', title: 'Prior result', content: 'Useful memory', sourceType: 'WORKFLOW', sourceRef: 'wf-1', confidence: 0.9 }], executable: false, nextAction: 'CREATE_GOVERNED_WORKFLOW_FROM_APPROVED_PLAN',
} as const;

test('accepts the server-owned non-executable planning contract', () => { const parsed = parseGoalPlan(valid); assert.ok(parsed); assert.equal(parsed.executable, false); assert.equal(parsed.steps[1]?.humanBoundary, true); });
test('rejects a response that claims executable authority', () => { assert.equal(parseGoalPlan({ ...valid, executable: true }), null); });
test('rejects a response that bypasses human release approval', () => { assert.equal(parseGoalPlan({ ...valid, requiresHumanReleaseApproval: false }), null); });
test('rejects browser-selected provider semantics', () => { assert.equal(parseGoalPlan({ ...valid, providerSelection: 'OPENAI' }), null); });
