import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMemoryEntries } from '../lib/memory/contracts.ts';

const valid = { id:'m1', organizationId:'org1', kind:'SEMANTIC', scope:'ORGANIZATION', scopeId:null, title:'Lesson', content:'Prefer server-owned retrieval.', sourceType:'RUNTIME_REFLECTION', sourceRef:'r1', confidence:0.9, status:'ACTIVE', metadata:{}, createdAt:'2026-09-12T12:00:00.000Z', updatedAt:'2026-09-12T12:00:00.000Z' };

test('accepts active tenant-scoped memory entries', () => { assert.deepEqual(parseMemoryEntries([valid]), [valid]); });
test('rejects retracted entries from active search surface', () => { assert.equal(parseMemoryEntries([{...valid,status:'RETRACTED'}]), null); });
test('rejects unknown memory semantics', () => { assert.equal(parseMemoryEntries([{...valid,kind:'BROWSER'}]), null); });
test('enforces scope ownership shape', () => { assert.equal(parseMemoryEntries([{...valid,scope:'AGENT',scopeId:null}]), null); assert.equal(parseMemoryEntries([{...valid,scope:'GLOBAL',scopeId:'x'}]), null); });
test('rejects invalid confidence and timestamps', () => { assert.equal(parseMemoryEntries([{...valid,confidence:2}]), null); assert.equal(parseMemoryEntries([{...valid,createdAt:'never'}]), null); });
