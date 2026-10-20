import assert from 'node:assert/strict';
import test from 'node:test';
import { toBusinessOrientationSummary } from '../lib/privacy.ts';

test('partner business summary allowlists business-safe fields and drops personal evidence', () => {
  const summary = toBusinessOrientationSummary({
    orientationId: 'orientation-1',
    companyId: 'company-1',
    primaryArea: 'Processi & operazioni',
    secondaryAreas: ['Sistemi & dati'],
    priority: 'HIGH',
    confidence: 'MEDIUM',
    recommendedPath: 'DIGITALIS_DISCOVERY',
    userConfirmed: true,
    consentedForPartnerView: true,
    personalEvidence: 'must never cross the boundary',
    healthData: 'must never cross the boundary',
    privateFreeText: 'must never cross the boundary',
  });

  assert.equal(Object.hasOwn(summary, 'personalEvidence'), false);
  assert.equal(Object.hasOwn(summary, 'healthData'), false);
  assert.equal(Object.hasOwn(summary, 'privateFreeText'), false);
  assert.equal(summary.primaryArea, 'Processi & operazioni');
  assert.equal(summary.consentedForPartnerView, true);
});

test('business summary rejects unknown confidence bands', () => {
  assert.throws(() => toBusinessOrientationSummary({
    orientationId: 'orientation-1',
    companyId: 'company-1',
    primaryArea: 'Process',
    secondaryAreas: [],
    priority: 'HIGH',
    confidence: 'CERTAIN',
    recommendedPath: 'NO_ACTION',
    userConfirmed: false,
    consentedForPartnerView: false,
  }), /INVALID_BUSINESS_SUMMARY_CONFIDENCE/);
});
