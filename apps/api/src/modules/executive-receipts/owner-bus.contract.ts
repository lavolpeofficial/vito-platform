/**
 * VITO ONE COCKPIT A3 · strictly bounded control-bus read contract.
 * No agent signature, task completion, tenant identity or approval can be
 * inferred from message.sender / receipt rows.
 */
export type OwnerBusRow = Readonly<{
  dispatch_id: bigint | string;
  recipient: string;
  topic: string;
  subject: string;
  dispatched_at: Date | string;
  receipt_id: bigint | string | null;
}>;

export type OwnerReceipt = Readonly<{
  dispatchId: string;
  recipient: 'emporio' | 'adoren' | 'urtali' | 'bridge' | 'selecta' | 'lavolpe' | 'bob' | 'riccardo';
  topic: 'task' | 'handoff';
  subject: string;
  dispatchedAt: string;
  receiptId: string | null;
  receiptState: 'DISPATCHED_NOT_ACKNOWLEDGED' | 'RECEIPT_REPORTED_UNVERIFIED_SENDER';
  authenticatedAgentAck: false;
  executionVerified: false;
  ownerReleaseApproved: false;
}>;

const RECIPIENTS = new Set<OwnerReceipt['recipient']>([
  'emporio', 'adoren', 'urtali', 'bridge', 'selecta', 'lavolpe', 'bob', 'riccardo',
]);

function positiveId(value: unknown): string | null {
  if (typeof value !== 'bigint' && typeof value !== 'string') return null;
  const candidate = String(value);
  return /^[1-9][0-9]{0,18}$/.test(candidate) ? candidate : null;
}

function timestamp(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

/** Single Owner-tenant gate, NOT general multi-tenant access. */
export function isAuthorizedOwnerBusReader(
  context: Readonly<{ organizationId: string; userId: string | null;
    role: string | null; authenticationMethod: string }>,
  permittedOrganizationId: string,
): boolean {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuid.test(permittedOrganizationId) &&
    context.organizationId === permittedOrganizationId &&
    typeof context.userId === 'string' && context.userId.length > 0 &&
    context.role === 'OWNER' &&
    context.authenticationMethod === 'jwt';
}

/** Reject owner/superuser credentials. A view-only SELECT grant is mandatory. */
export function isRestrictedBusReader(
  privileges: Readonly<{ can_select_view: unknown; can_select_table: unknown;
    can_insert_table: unknown; can_update_table: unknown; can_delete_table: unknown }>,
): boolean {
  return privileges.can_select_view === true &&
    privileges.can_select_table === false &&
    privileges.can_insert_table === false &&
    privileges.can_update_table === false &&
    privileges.can_delete_table === false;
}

export function normalizeOwnerReceipts(input: unknown): readonly OwnerReceipt[] {
  if (!Array.isArray(input) || input.length > 100) throw new Error('BUS_ROWS_OUT_OF_BOUNDS');
  const out: OwnerReceipt[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('BUS_ROW_INVALID');
    }
    const row = item as Partial<OwnerBusRow>;
    const id = positiveId(row.dispatch_id);
    const receipt = row.receipt_id === null ? null : positiveId(row.receipt_id);
    const date = timestamp(row.dispatched_at);
    if (!id || seen.has(id) ||
        !RECIPIENTS.has(row.recipient as OwnerReceipt['recipient']) ||
        (row.topic !== 'task' && row.topic !== 'handoff') ||
        typeof row.subject !== 'string' || row.subject.length < 1 || row.subject.length > 160 ||
        !date || (row.receipt_id !== null && !receipt)) {
      throw new Error('BUS_ROW_INVALID');
    }
    seen.add(id);
    out.push({
      dispatchId: id,
      recipient: row.recipient as OwnerReceipt['recipient'],
      topic: row.topic,
      subject: row.subject,
      dispatchedAt: date,
      receiptId: receipt,
      receiptState: receipt === null ? 'DISPATCHED_NOT_ACKNOWLEDGED' : 'RECEIPT_REPORTED_UNVERIFIED_SENDER',
      authenticatedAgentAck: false,
      executionVerified: false,
      ownerReleaseApproved: false,
    });
  }
  return out;
}
