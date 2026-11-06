export type ReceiptState =
  | 'DISPATCHED_NOT_ACKNOWLEDGED'
  | 'RECEIPT_REPORTED_UNVERIFIED_SENDER';

export type ReceiptEntry = Readonly<{
  dispatchId: string;
  recipient: 'emporio' | 'adoren' | 'urtali' | 'bridge' | 'selecta' | 'lavolpe' | 'bob' | 'riccardo';
  topic: 'task' | 'handoff';
  subject: string;
  dispatchedAt: string;
  receiptId: string | null;
  receiptState: ReceiptState;
  authenticatedAgentAck: false;
  executionVerified: false;
  ownerReleaseApproved: false;
}>;

export type ReceiptOverview = Readonly<{
  organizationId: string;
  authority: 'READ_ONLY';
  sourceHealth: 'HEALTHY' | 'STALE';
  observedAt: string;
  items: readonly ReceiptEntry[];
}>;

const RECIPIENTS = new Set(['emporio', 'adoren', 'urtali', 'bridge', 'selecta', 'lavolpe', 'bob', 'riccardo']);
const STATES = new Set<ReceiptState>(['DISPATCHED_NOT_ACKNOWLEDGED', 'RECEIPT_REPORTED_UNVERIFIED_SENDER']);
const MAX_ROWS = 100;
const MAX_SUBJECT = 160;

function record(input: unknown): Record<string, unknown> | null {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

function isoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 40 &&
    !Number.isNaN(Date.parse(value));
}

function positiveDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);
}

export function parseReceiptOverview(input: unknown): ReceiptOverview | null {
  const root = record(input);
  if (!root || typeof root.organizationId !== 'string' || root.organizationId.length < 1 ||
      root.organizationId.length > 128 || root.authority !== 'READ_ONLY' ||
      (root.sourceHealth !== 'HEALTHY' && root.sourceHealth !== 'STALE') ||
      !isoDate(root.observedAt) || !Array.isArray(root.items) || root.items.length > MAX_ROWS) return null;

  const items: ReceiptEntry[] = [];
  const seen = new Set<string>();
  for (const item of root.items) {
    const row = record(item);
    if (!row || !positiveDecimal(row.dispatchId) || seen.has(row.dispatchId) ||
        typeof row.recipient !== 'string' || !RECIPIENTS.has(row.recipient) ||
        (row.topic !== 'task' && row.topic !== 'handoff') ||
        typeof row.subject !== 'string' || !row.subject.length || row.subject.length > MAX_SUBJECT ||
        !isoDate(row.dispatchedAt) ||
        (row.receiptId !== null && !positiveDecimal(row.receiptId)) ||
        !STATES.has(row.receiptState as ReceiptState) ||
        row.authenticatedAgentAck !== false ||
        row.executionVerified !== false ||
        row.ownerReleaseApproved !== false) return null;

    if ((row.receiptState === 'DISPATCHED_NOT_ACKNOWLEDGED') !== (row.receiptId === null)) return null;
    seen.add(row.dispatchId);
    items.push({
      dispatchId: row.dispatchId,
      recipient: row.recipient as ReceiptEntry['recipient'],
      topic: row.topic,
      subject: row.subject,
      dispatchedAt: row.dispatchedAt,
      receiptId: row.receiptId,
      receiptState: row.receiptState as ReceiptState,
      authenticatedAgentAck: false,
      executionVerified: false,
      ownerReleaseApproved: false,
    });
  }
  return {
    organizationId: root.organizationId,
    authority: 'READ_ONLY',
    sourceHealth: root.sourceHealth,
    observedAt: root.observedAt,
    items,
  };
}
