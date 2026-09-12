import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExperienceRecord, parseExperienceRecords, parseOutcomeRecords, parseReflectionRecords } from '../lib/learning/contracts.ts';

const experience = {
  id: 'exp-1', organizationId: 'org-1', agentId: 'agent-1', goal: 'Improve onboarding quality',
  context: {}, observation: {}, decision: {}, action: {}, result: {}, successScore: 0.8, confidence: 0.9,
  feedback: null, lesson: 'Keep the validated sequence.', reusablePattern: null, status: 'REFLECTED',
  createdAt: '2026-09-12T18:00:00.000Z', updatedAt: '2026-09-12T18:05:00.000Z',
};

test('accepts persisted tenant-scoped experience records', () => {
  assert.deepEqual(parseExperienceRecord(experience), experience);
  assert.deepEqual(parseExperienceRecords([experience]), [experience]);
});

test('rejects unknown experience semantics and invalid scores', () => {
  assert.equal(parseExperienceRecord({ ...experience, status: 'EXECUTABLE' }), null);
  assert.equal(parseExperienceRecord({ ...experience, successScore: 2 }), null);
});

test('accepts objective outcomes and evidence-backed reflections', () => {
  const outcomes = [{ id: 'out-1', organizationId: 'org-1', experienceId: 'exp-1', metricCode: 'QUALITY', expectedValue: 1, observedValue: 0.8, evidence: { source: 'verification' }, score: 0.8, confidence: 0.9, evaluatorType: 'SYSTEM', evaluatorId: null, evaluatedAt: '2026-09-12T18:03:00.000Z', createdAt: '2026-09-12T18:03:00.000Z' }];
  const reflections = [{ id: 'ref-1', organizationId: 'org-1', experienceId: 'exp-1', lesson: 'Keep evidence attached.', whatWorked: ['bounded execution'], whatFailed: [], assumptions: [], nextActionHint: null, evidenceOutcomeIds: ['out-1'], confidence: 0.8, reflectorType: 'SYSTEM', reflectorId: null, createdAt: '2026-09-12T18:04:00.000Z' }];
  assert.deepEqual(parseOutcomeRecords(outcomes), outcomes);
  assert.deepEqual(parseReflectionRecords(reflections), reflections);
});

test('fails closed on malformed learning evidence', () => {
  assert.equal(parseOutcomeRecords([{ id: 'out-1' }]), null);
  assert.equal(parseReflectionRecords([{ id: 'ref-1' }]), null);
});
