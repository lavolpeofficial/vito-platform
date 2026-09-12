import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAuditEvents } from '../lib/audit/contracts.ts';

const valid = [{ id:'evt-1', organizationId:'org-1', actorType:'SYSTEM', actorId:null, action:'WORKFLOW_STARTED', entityType:'WorkflowRun', entityId:'run-1', metadata:{ source:'runtime' }, createdAt:'2026-09-12T17:00:00.000Z' }];

test('accepts the tenant-scoped audit event contract', () => { const parsed = parseAuditEvents(valid); assert.ok(parsed); assert.equal(parsed[0]?.action, 'WORKFLOW_STARTED'); });
test('rejects unknown actor types', () => { assert.equal(parseAuditEvents([{ ...valid[0], actorType:'BROWSER' }]), null); });
test('rejects missing organization ownership', () => { const { organizationId: _removed, ...event } = valid[0]; assert.equal(parseAuditEvents([event]), null); });
test('rejects malformed timestamps and metadata arrays', () => { assert.equal(parseAuditEvents([{ ...valid[0], createdAt:'not-a-date' }]), null); assert.equal(parseAuditEvents([{ ...valid[0], metadata:[] }]), null); });
