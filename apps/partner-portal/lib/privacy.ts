import type { BusinessOrientationSummary } from './contracts';

const priority = new Set(['LOW', 'MEDIUM', 'HIGH']);
const confidence = new Set(['LOW', 'MEDIUM', 'HIGH']);

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_BUSINESS_SUMMARY_' + field.toUpperCase());
  return value.trim();
}

export function toBusinessOrientationSummary(raw: Record<string, unknown>): BusinessOrientationSummary {
  const rawPriority = text(raw.priority, 'priority');
  const rawConfidence = text(raw.confidence, 'confidence');
  if (!priority.has(rawPriority)) throw new Error('INVALID_BUSINESS_SUMMARY_PRIORITY');
  if (!confidence.has(rawConfidence)) throw new Error('INVALID_BUSINESS_SUMMARY_CONFIDENCE');

  return Object.freeze({
    orientationId: text(raw.orientationId, 'orientationId'),
    companyId: text(raw.companyId, 'companyId'),
    primaryArea: text(raw.primaryArea, 'primaryArea'),
    secondaryAreas: Object.freeze(Array.isArray(raw.secondaryAreas) ? raw.secondaryAreas.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean) : []),
    priority: rawPriority as BusinessOrientationSummary['priority'],
    confidence: rawConfidence as BusinessOrientationSummary['confidence'],
    recommendedPath: text(raw.recommendedPath, 'recommendedPath'),
    userConfirmed: raw.userConfirmed === true,
    consentedForPartnerView: raw.consentedForPartnerView === true,
  });
}
