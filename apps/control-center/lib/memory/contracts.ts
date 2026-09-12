export type MemoryKind = 'EPISODIC' | 'SEMANTIC' | 'PROCEDURAL' | 'ORGANIZATIONAL';
export type MemoryScope = 'GLOBAL' | 'ORGANIZATION' | 'PROJECT' | 'CUSTOMER' | 'AGENT' | 'WORKFLOW';

export type MemoryEntry = Readonly<{
  id: string;
  organizationId: string;
  kind: MemoryKind;
  scope: MemoryScope;
  scopeId: string | null;
  title: string;
  content: string;
  sourceType: string;
  sourceRef: string | null;
  confidence: number | null;
  status: 'ACTIVE';
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}>;

const kinds = new Set<MemoryKind>(['EPISODIC', 'SEMANTIC', 'PROCEDURAL', 'ORGANIZATIONAL']);
const scopes = new Set<MemoryScope>(['GLOBAL', 'ORGANIZATION', 'PROJECT', 'CUSTOMER', 'AGENT', 'WORKFLOW']);

export function parseMemoryEntries(input: unknown): readonly MemoryEntry[] | null {
  if (!Array.isArray(input)) return null;
  const entries: MemoryEntry[] = [];
  for (const value of input) {
    if (!isRecord(value) || !isString(value.id) || !isString(value.organizationId) || !isKind(value.kind) || !isScope(value.scope) || !isNullableString(value.scopeId) || !isString(value.title) || !isString(value.content) || !isString(value.sourceType) || !isNullableString(value.sourceRef) || !isNullableConfidence(value.confidence) || value.status !== 'ACTIVE' || !isRecord(value.metadata) || !isDateString(value.createdAt) || !isDateString(value.updatedAt)) return null;
    const unscoped = value.scope === 'GLOBAL' || value.scope === 'ORGANIZATION';
    if ((unscoped && value.scopeId !== null) || (!unscoped && !value.scopeId)) return null;
    entries.push(value as MemoryEntry);
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function isNullableString(value: unknown): value is string | null { return value === null || isString(value); }
function isKind(value: unknown): value is MemoryKind { return typeof value === 'string' && kinds.has(value as MemoryKind); }
function isScope(value: unknown): value is MemoryScope { return typeof value === 'string' && scopes.has(value as MemoryScope); }
function isNullableConfidence(value: unknown): value is number | null { return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1); }
function isDateString(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
