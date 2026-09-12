import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVerificationRecords } from '../lib/verification/contracts.ts';

const valid = { id:'v-1', organizationId:'org-1', workflowRunId:'run-1', workflowStepRunId:'step-1', stepType:'TEST', ruleCode:'TEST_EXECUTION_SUCCEEDED', status:'VERIFIED', evidence:{ source:'WORKFLOW_VERIFICATION_V1' }, createdAt:'2026-09-12T20:00:00.000Z' };

test('accepts persisted tenant-scoped verification records', () => { assert.deepEqual(parseVerificationRecords([valid]), [valid]); });
test('rejects unknown verification semantics', () => { assert.equal(parseVerificationRecords([{...valid,status:'SUCCEEDED'}]), null); });
test('rejects malformed evidence and timestamps', () => { assert.equal(parseVerificationRecords([{...valid,evidence:[]}]), null); assert.equal(parseVerificationRecords([{...valid,createdAt:'never'}]), null); });
test('rejects records without tenant or workflow ownership', () => { const { organizationId:_org, ...withoutOrg } = valid; assert.equal(parseVerificationRecords([withoutOrg]), null); const { workflowRunId:_run, ...withoutRun } = valid; assert.equal(parseVerificationRecords([withoutRun]), null); });
