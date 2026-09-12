export type SkillPromotionStatus = 'PENDING_REVIEW' | 'APPROVED_FOR_REGISTRATION' | 'REJECTED';

export type SkillPromotionReview = Readonly<{
  id: string;
  organizationId: string;
  skillCandidateId: string;
  targetCapabilityCode: string;
  evidenceSnapshot: Readonly<Record<string, unknown>>;
  status: SkillPromotionStatus;
  requestedByUserId: string;
  reviewedByUserId: string | null;
  reviewRationale: string | null;
  createdAt: string;
  reviewedAt: string | null;
  updatedAt: string;
}>;

export function parseSkillPromotionReviews(input: unknown): readonly SkillPromotionReview[] | null {
  if (!Array.isArray(input) || input.length > 100) return null;
  const result: SkillPromotionReview[] = [];
  for (const value of input) {
    const row = asRecord(value);
    if (!row || !isString(row.id) || !isString(row.organizationId) || !isString(row.skillCandidateId) || !isString(row.targetCapabilityCode) || !isStatus(row.status) || !isString(row.requestedByUserId) || !isNullableString(row.reviewedByUserId) || !isNullableString(row.reviewRationale) || !isDate(row.createdAt) || !isNullableDate(row.reviewedAt) || !isDate(row.updatedAt)) return null;
    const evidence = asRecord(row.evidenceSnapshot);
    if (!evidence) return null;
    result.push({ id: row.id, organizationId: row.organizationId, skillCandidateId: row.skillCandidateId, targetCapabilityCode: row.targetCapabilityCode, evidenceSnapshot: evidence, status: row.status, requestedByUserId: row.requestedByUserId, reviewedByUserId: row.reviewedByUserId, reviewRationale: row.reviewRationale, createdAt: row.createdAt, reviewedAt: row.reviewedAt, updatedAt: row.updatedAt });
  }
  return result;
}

export function parseSkillPromotionReview(input: unknown): SkillPromotionReview | null {
  return parseSkillPromotionReviews([input])?.[0] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function isString(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4096; }
function isNullableString(value: unknown): value is string | null { return value === null || isString(value); }
function isStatus(value: unknown): value is SkillPromotionStatus { return value === 'PENDING_REVIEW' || value === 'APPROVED_FOR_REGISTRATION' || value === 'REJECTED'; }
function isDate(value: unknown): value is string { return isString(value) && !Number.isNaN(Date.parse(value)); }
function isNullableDate(value: unknown): value is string | null { return value === null || isDate(value); }
