import assert from 'node:assert/strict';
import test from 'node:test';
import { inferSourceType, parseHarvestResult, parseKnowledgeHits, parseSourceList } from '../lib/source-vault/contracts.ts';

test('infers governed source type from persisted-compatible MIME and filename evidence', () => {
  assert.equal(inferSourceType('report.pdf', 'application/pdf'), 'DOCUMENT');
  assert.equal(inferSourceType('book.xlsx', 'application/octet-stream'), 'SPREADSHEET');
  assert.equal(inferSourceType('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), 'PRESENTATION');
  assert.equal(inferSourceType('note.txt', 'text/plain; charset=utf-8'), 'DOCUMENT');
  assert.equal(inferSourceType('unknown.bin', 'application/octet-stream'), 'OTHER');
});

test('parses bounded source registry rows and preserves server-owned statuses', () => {
  const parsed = parseSourceList([{ id: 'db-1', sourceId: 'SRC-2026-ABC', sourceType: 'DOCUMENT', originalFilename: 'a.pdf', mimeType: 'application/pdf', byteSize: '1234', version: 1, ingestionStatus: 'STORED', extractionStatus: 'NOT_STARTED', validationStatus: 'UNREVIEWED', ingestedAt: '2026-09-12T12:00:00.000Z', title: null, projectKey: null, domain: 'care', knowledgeLinks: [] }]);
  assert.ok(parsed);
  assert.equal(parsed[0]?.sourceId, 'SRC-2026-ABC');
  assert.equal(parsed[0]?.knowledgeLinkCount, 0);
});

test('fails closed on malformed source and knowledge contracts', () => {
  assert.equal(parseSourceList([{ id: 'x' }]), null);
  assert.equal(parseKnowledgeHits([{ id: 'x', content: 42 }]), null);
  assert.equal(parseHarvestResult({ sourceId: 'SRC', knowledgeUnits: -1, unitType: 'TEXT_FRAGMENT', semanticEnrichment: false }), null);
});

test('parses retrieval provenance without inventing confidence', () => {
  const parsed = parseKnowledgeHits([{ id: 'ku-1', sourceId: 'db-1', sourcePublicId: 'SRC-1', unitType: 'TEXT_FRAGMENT', content: 'Evidence', locatorType: 'PAGE', locatorValue: 'page:2', derivationType: 'EXTRACTION', confidence: null, rank: 0.42 }]);
  assert.ok(parsed);
  assert.equal(parsed[0]?.locatorValue, 'page:2');
  assert.equal(parsed[0]?.confidence, null);
});
