import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReceiptOverview } from '../lib/receipt-ledger/contracts.ts';

const valid = {
  organizationId: 'org-1',
  authority: 'READ_ONLY',
  sourceHealth: 'HEALTHY',
  observedAt: '2026-11-06T14:55:00.000Z',
  items: [
    { dispatchId: '67', recipient: 'emporio', topic: 'handoff', subject: 'Private footer source review',
      dispatchedAt: '2026-11-06T14:39:04.252Z', receiptId: '69',
      receiptState: 'RECEIPT_REPORTED_UNVERIFIED_SENDER',
      authenticatedAgentAck: false, executionVerified: false, ownerReleaseApproved: false },
  ],
};

test('accepts reported EMPORIO receipt without promoting trust', () => {
  const parsed = parseReceiptOverview(valid);
  assert.ok(parsed);
  assert.equal(parsed.items[0]?.dispatchId, '67');
  assert.equal(parsed.items[0]?.receiptId, '69');
  assert.equal(parsed.items[0]?.authenticatedAgentAck, false);
});

test('rejects false execution or owner approval and unsupported statuses', () => {
  assert.equal(parseReceiptOverview({ ...valid, items: [{ ...valid.items[0], executionVerified: true }] }), null);
  assert.equal(parseReceiptOverview({ ...valid, items: [{ ...valid.items[0], ownerReleaseApproved: true }] }), null);
  assert.equal(parseReceiptOverview({ ...valid, items: [{ ...valid.items[0], authenticatedAgentAck: true }] }), null);
  assert.equal(parseReceiptOverview({ ...valid, items: [{ ...valid.items[0], receiptState: 'COMPLETED' }] }), null);
  assert.equal(parseReceiptOverview({ ...valid, authority: 'WRITE' }), null);
});

test('rejects missing receipts, fake IDs, duplicates and unbounded items', () => {
  assert.equal(parseReceiptOverview({ ...valid, items: [{ ...valid.items[0], receiptId: null }] }), null);
  assert.equal(parseReceiptOverview({ ...valid, items: [{ ...valid.items[0], dispatchId: '0' }] }), null);
  assert.equal(parseReceiptOverview({ ...valid, items: [valid.items[0], valid.items[0]] }), null);
  assert.equal(parseReceiptOverview({ ...valid, items: Array.from({ length: 101 }, (_, i) => ({ ...valid.items[0], dispatchId: String(i + 1) })) }), null);
  assert.equal(parseReceiptOverview({ ...valid, items: [{ ...valid.items[0], recipient: 'another-org' }] }), null);
});

test('validates DISPATCHED state as receipt-free; refuses unverifiable empty successes', () => {
  const open = { ...valid.items[0], receiptId: null, receiptState: 'DISPATCHED_NOT_ACKNOWLEDGED' };
  assert.ok(parseReceiptOverview({ ...valid, sourceHealth: 'STALE', items: [open] }));
  assert.equal(parseReceiptOverview({ ...valid, items: [{ ...open, receiptId: '69' }] }), null);
  assert.equal(parseReceiptOverview({ ...valid, observedAt: 'not-a-date' }), null);
});
