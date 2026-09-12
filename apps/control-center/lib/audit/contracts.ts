export type AuditActorType = 'USER' | 'DIGITAL_EMPLOYEE' | 'SYSTEM';

export type AuditEvent = Readonly<{
  id: string;
  organizationId: string;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

export function parseAuditEvents(input: unknown): readonly AuditEvent[] | null {
  if (!Array.isArray(input)) return null;
  const events: AuditEvent[] = [];
  for (const value of input) {
    const event = parseAuditEvent(value);
    if (!event) return null;
    events.push(event);
  }
  return events;
}

function parseAuditEvent(input: unknown): AuditEvent | null {
  if (!isRecord(input)) return null;
  const actorType = input.actorType;
  if (actorType !== 'USER' && actorType !== 'DIGITAL_EMPLOYEE' && actorType !== 'SYSTEM') return null;
  if (!isString(input.id) || !isString(input.organizationId) || !isString(input.action) || !isString(input.entityType) || !isNullableString(input.actorId) || !isNullableString(input.entityId) || !isRecord(input.metadata) || !isIsoDate(input.createdAt)) return null;
  return {
    id: input.id,
    organizationId: input.organizationId,
    actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata,
    createdAt: input.createdAt,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function isIsoDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
