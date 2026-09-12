export type ExperienceStatus = 'OBSERVED' | 'EVALUATED' | 'REFLECTED' | 'LEARNING_CANDIDATE' | 'ARCHIVED';

export type ExperienceRecord = Readonly<{
  id: string;
  organizationId: string;
  agentId: string;
  goal: string;
  context: Readonly<Record<string, unknown>>;
  observation: Readonly<Record<string, unknown>>;
  decision: Readonly<Record<string, unknown>>;
  action: Readonly<Record<string, unknown>>;
  result: Readonly<Record<string, unknown>>;
  successScore: number | null;
  confidence: number | null;
  feedback: Readonly<Record<string, unknown>> | null;
  lesson: string | null;
  reusablePattern: Readonly<Record<string, unknown>> | null;
  status: ExperienceStatus;
  createdAt: string;
  updatedAt: string;
}>;

export type OutcomeRecord = Readonly<{
  id: string;
  organizationId: string;
  experienceId: string;
  metricCode: string;
  expectedValue: unknown | null;
  observedValue: unknown;
  evidence: Readonly<Record<string, unknown>>;
  score: number;
  confidence: number | null;
  evaluatorType: 'SYSTEM' | 'USER' | 'EXTERNAL';
  evaluatorId: string | null;
  evaluatedAt: string;
  createdAt: string;
}>;

export type ReflectionRecord = Readonly<{
  id: string;
  organizationId: string;
  experienceId: string;
  lesson: string;
  whatWorked: readonly string[];
  whatFailed: readonly string[];
  assumptions: readonly string[];
  nextActionHint: string | null;
  evidenceOutcomeIds: readonly string[];
  confidence: number | null;
  reflectorType: 'SYSTEM' | 'USER' | 'EXTERNAL';
  reflectorId: string | null;
  createdAt: string;
}>;

const experienceStatuses = new Set<ExperienceStatus>(['OBSERVED', 'EVALUATED', 'REFLECTED', 'LEARNING_CANDIDATE', 'ARCHIVED']);
const actorTypes = new Set(['SYSTEM', 'USER', 'EXTERNAL']);

export function parseExperienceRecords(input: unknown): readonly ExperienceRecord[] | null {
  if (!Array.isArray(input)) return null;
  const records: ExperienceRecord[] = [];
  for (const value of input) {
    const parsed = parseExperienceRecord(value);
    if (!parsed) return null;
    records.push(parsed);
  }
  return records;
}

export function parseExperienceRecord(input: unknown): ExperienceRecord | null {
  if (!isRecord(input) || !isString(input.id) || !isString(input.organizationId) || !isString(input.agentId) || !isString(input.goal) || !isRecord(input.context) || !isRecord(input.observation) || !isRecord(input.decision) || !isRecord(input.action) || !isRecord(input.result) || !isNullableScore(input.successScore) || !isNullableConfidence(input.confidence) || !isNullableRecord(input.feedback) || !isNullableString(input.lesson) || !isNullableRecord(input.reusablePattern) || !isExperienceStatus(input.status) || !isDateString(input.createdAt) || !isDateString(input.updatedAt)) return null;
  return input as ExperienceRecord;
}

export function parseOutcomeRecords(input: unknown): readonly OutcomeRecord[] | null {
  if (!Array.isArray(input)) return null;
  const records: OutcomeRecord[] = [];
  for (const value of input) {
    if (!isRecord(value) || !isString(value.id) || !isString(value.organizationId) || !isString(value.experienceId) || !isString(value.metricCode) || value.observedValue === undefined || !isRecord(value.evidence) || !isScore(value.score) || !isNullableConfidence(value.confidence) || !isActorType(value.evaluatorType) || !isNullableString(value.evaluatorId) || !isDateString(value.evaluatedAt) || !isDateString(value.createdAt)) return null;
    records.push(value as OutcomeRecord);
  }
  return records;
}

export function parseReflectionRecords(input: unknown): readonly ReflectionRecord[] | null {
  if (!Array.isArray(input)) return null;
  const records: ReflectionRecord[] = [];
  for (const value of input) {
    if (!isRecord(value) || !isString(value.id) || !isString(value.organizationId) || !isString(value.experienceId) || !isString(value.lesson) || !isStringArray(value.whatWorked) || !isStringArray(value.whatFailed) || !isStringArray(value.assumptions) || !isNullableString(value.nextActionHint) || !isStringArray(value.evidenceOutcomeIds) || !isNullableConfidence(value.confidence) || !isActorType(value.reflectorType) || !isNullableString(value.reflectorId) || !isDateString(value.createdAt)) return null;
    records.push(value as ReflectionRecord);
  }
  return records;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isNullableRecord(value: unknown): value is Record<string, unknown> | null { return value === null || isRecord(value); }
function isString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function isExperienceStatus(value: unknown): value is ExperienceStatus { return typeof value === 'string' && experienceStatuses.has(value as ExperienceStatus); }
function isActorType(value: unknown): value is 'SYSTEM' | 'USER' | 'EXTERNAL' { return typeof value === 'string' && actorTypes.has(value); }
function isScore(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1; }
function isNullableScore(value: unknown): value is number | null { return value === null || isScore(value); }
function isNullableConfidence(value: unknown): value is number | null { return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1); }
function isDateString(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
