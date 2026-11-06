/**
 * URTALI TIME / VITO CONTROL BUS inbox acceptance planner (private contract).
 * No I/O, no auth, no DB writes, no agent or customer booking actions.
 * A trusted server must verify the owner, scope and source before calling this.
 * In particular, sender='vito' is NOT a verified machine identity.
 */
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const BIGINT_ID = /^[1-9][0-9]{0,18}$/;
const TOPICS = new Set(['task', 'report', 'blocker', 'handoff', 'document', 'notice']);
const RECEIPT_STATES = new Set(['CLAIMED', 'HANDLED', 'REVIEW_REQUIRED', 'UNKNOWN']);
const SENDERS = new Set(['vito', 'owner', 'adoren', 'emporio', 'selecta', 'urtali', 'lavolpe', 'bridge', 'bob', 'riccardo', 'time']);
function invalid(code) { throw new Error('TIME_INBOX_' + code); }
function validId(value) {
  if (typeof value !== 'string' || !BIGINT_ID.test(value) || BigInt(value) > 9223372036854775807n) invalid('ID_INVALID');
  return value;
}
function iso(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) invalid('TIME_INVALID');
  const number = Date.parse(value);
  if (!Number.isFinite(number)) invalid('TIME_INVALID');
  return new Date(number).toISOString();
}
/**
 * Produces review-only inbox metadata. Caller MUST have independently established
 * recipient and tenant visibility; no request-body flag constitutes authorization.
 * No high-watermark skipping: durable receipts by message ID are authoritative.
 */
export function planTimeInbox({ organizationId, observedAt, messages, receipts = [], source = 'UNVERIFIED' }) {
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) invalid('TENANT_INVALID');
  const timestamp = iso(observedAt);
  if (!Array.isArray(messages) || messages.length > 200 || !Array.isArray(receipts) || receipts.length > 2000) invalid('LIMIT');
  if (source !== 'SERVER_SCOPED_READ_MODEL') {
    if (messages.length > 0) invalid('SOURCE_UNVERIFIED');
  }
  const processed = new Map();
  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.organizationId !== organizationId || receipt.receiver !== 'time' || !RECEIPT_STATES.has(receipt.state)) invalid('RECEIPT_INVALID');
    const id = validId(receipt.messageId);
    if (processed.has(id)) invalid('RECEIPT_DUPLICATE');
    processed.set(id, receipt.state);
  }
  const seen = new Set();
  const pending = [], suppressed = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.recipient !== 'time' || !SENDERS.has(message.sender) || !TOPICS.has(message.topic)) invalid('ENVELOPE_INVALID');
    const id = validId(message.id);
    if (seen.has(id)) invalid('MESSAGE_DUPLICATE');
    seen.add(id);
    const at = iso(message.createdAt);
    if (processed.has(id)) {
      suppressed.push(Object.freeze({messageId:id, receiptState:processed.get(id)}));
      continue;
    }
    pending.push(Object.freeze({ messageId:id, recipient:'time', senderLabel:message.sender, topic:message.topic, receivedAt:at, executionAllowed:false, reviewRequired:true, state:'PENDING_REVIEW', source:'NEON_CONTROL_BUS' }));
  }
  pending.sort((a,b) => BigInt(a.messageId) < BigInt(b.messageId) ? -1 : BigInt(a.messageId) > BigInt(b.messageId) ? 1 : 0);
  return Object.freeze({ organizationId, authority:'READ_ONLY', observedAt:timestamp, receiver:'time', messageExecutionEnabled:false, pending:Object.freeze(pending), suppressed:Object.freeze(suppressed), needsAtomicDurableReceipt:true });
}
