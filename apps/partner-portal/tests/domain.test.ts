import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseOffer, commissionAmount, eligibleCnr, leadProtectionDays, nextAuthorization } from '../lib/domain.ts';

test('authorization and portfolio permission both gate an offer', () => {
  assert.equal(canUseOffer('SALES_ALLOWED', 'SALES_ALLOWED', 'SALES_ALLOWED'), true);
  assert.equal(canUseOffer('SALES_ALLOWED', 'REFERRAL_ONLY', 'SALES_ALLOWED'), false);
  assert.equal(canUseOffer('REFERRAL_ONLY', 'SALES_ALLOWED', 'SALES_ALLOWED'), false);
});

test('eligible CNR deducts pass-through and refunds but never becomes negative', () => {
  assert.equal(eligibleCnr({ collected: 4000, passThrough: 500 }), 3500);
  assert.equal(eligibleCnr({ collected: 100, refunds: 150 }), 0);
});

test('commission is calculated only from supplied eligible CNR', () => {
  assert.equal(commissionAmount(3500, 8), 280);
  assert.equal(commissionAmount(10000, 12), 1200);
});

test('lead protection is bounded to 90 days plus one approved extension', () => {
  assert.equal(leadProtectionDays(false), 90);
  assert.equal(leadProtectionDays(true), 180);
});

test('academy progress maps to the next review authorization band', () => {
  assert.equal(nextAuthorization(0), 'NONE');
  assert.equal(nextAuthorization(30), 'REFERRAL_ONLY');
  assert.equal(nextAuthorization(78), 'SALES_ALLOWED');
  assert.equal(nextAuthorization(100), 'ADVISORY_ALLOWED');
});
