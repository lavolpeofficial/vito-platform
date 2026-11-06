# TIME · VITO CONTROL BUS · Private activation contract

**2026-11-06 · PREPARED / INACTIVE / OWNER RELEASE NO_GO**

Owner: VITO central execution and approval authority. TIME is a separate domain agent only for calendars, deadlines, follow-ups and reminders. Lead issue: #176; implementation branch: feat/vito-time-a1-readonly-20261106. No new VITO task management.

## Verified database boundaries

Neon project patient-paper-37122556, branch br-delicate-unit-babt3aup (staging-synthetic), database adoren_auth_staging, table vito_control_bus_v1.messages.

- Message ID is a primary-key bigint; created_at is timestamptz. There is UNIQUE(sender,idempotency_key) but keys can be NULL; that protects duplicate sends, not duplicate processing.
- CHECK messages_sender_check currently allows vito/owner/adoren/emporio/selecta/urtali/lavolpe/bridge/bob/riccardo.
- CHECK messages_recipient_check allows those plus all; neither CHECK currently allows time.
- Existing index on recipient,id. Current messages table has **no RLS**, **no organization_id**, **no attested sender identity** and no ACK/RUNNING/COMPLETE state machine. Direct raw reads cannot prove tenant ownership.
- Exact checked SQL and two private migration drafts are in this directory. Do not execute them without a **separate Owner GO** and independent security review.

## Private files and checks

- time-inbox-gate.mjs: pure bounded inbox projection; never trusts a sender label as proof, rejects foreign recipients and invalid IDs, never returns message body, and only produces PENDING_REVIEW with executionAllowed=false.
- time-inbox-gate.test.mjs: 16 private negative/contract tests, local 16/16 PASS.
- time-recipient-constraint.CANDIDATE.sql: transactional change adding time as sender + recipient, preserving all old labels; guarded against current constraint drift. **Not executed**.
- time-inbox-receipts.CANDIDATE.sql: proposed durable per-message receipts keyed by message_id; **not executed**. This is an idempotency ledger, not another task/workflow database.

Existing TIME tests: 16 original + 21 prior follow-up/outbox + 16 new inbox tests = **53/53 local PASS** with Node.js 22; GitHub CI, scoped runtime and delivery E2E not yet demonstrated.

## Mandatory gates before enabling autonomous TIME

1. Human Owner approves exact schema/role/RLS scope after BOB independent review; add time without modifying existing routing or automations.
2. Create a dedicated server-side read identity and verified per-organization mapping for each TIME message. Never use unscoped owner credentials as a runtime agent. The current BUS schema cannot prove tenant by itself.
3. Verify VITO's task permission and origin through authenticated/audited server evidence, **not sender='vito'**, arbitrary JSON, topic or GitHub issue comments.
4. Implement atomic durable receipt claim by message_id (UNIQUE key, INSERT ON CONFLICT DO NOTHING RETURNING), and audit evidence. CLAIMED/UNKNOWN/REVIEW_REQUIRED outcomes must never be blindly retried. A max(id) watermark alone is unsafe because commit order can differ from ID allocation.
5. Private scoped E2E proves unauthorized access denied, replay/concurrency protection, message integrity, bounded reads, safe error handling, and successful authorized response path. No customer bookings touched.
6. Reuse the existing enabled central ChatGPT automation VITO · Zentraler CONTROL BUS (Europe/Rome, XX:00). Do NOT create a separate TIME scheduled task. The existing VITO prompt is read-only triage; it does not wake Fachchats or autonomously execute.
7. After separate Owner activation approval and BOB review, VITO can add an authorized, tenant-scoped TIME handoff to its central dispatcher. Verify first reads, atomic receipts and replies before autonomous TIME-domain execution; monitoring is not execution.

## One existing scheduler · no separate TIME automation

Existing enabled ChatGPT automation: VITO · Zentraler CONTROL BUS, hourly at XX:00 Europe/Rome. Its verified saved prompt explicitly restricts the job to READ_ONLY triage: no automatic Fachchat wake-up or agent execution, and no BUS acknowledgments.

The user chose central bundling due to the scheduled-task limit. A notional TIME XX:50 is only a proposed internal processing phase, not a real schedule. No extra TIME automation may be created. An execution-capable VITO worker needs a separate approved release, independently verified tenant binding, signed/audited delegation and durable atomic receipt claims.

If any gate is missing, fail closed and report BLOCKED. Existing customer BOOKING remains untouched.

### Scope of a future approved VITO → TIME handoff

VITO checks the independently attested task authority and reads only tenant-scoped message metadata. It never authorizes execution based on a sender label, topic, JSON content, issue comment or a prompt alone. A specialist TIME handler may act only after durable atomic claim and owner-approved scheduling scope. Results need auditable evidence and idempotent authorized sender time → recipient vito, never a fabricated ACK.

### Private bounded read query (NOT sufficient for authorization)

    SELECT m.id::text AS message_id,
           m.sender, m.recipient, m.topic, m.created_at
    FROM vito_control_bus_v1.messages AS m
    WHERE m.recipient = 'time'
    ORDER BY m.id ASC
    LIMIT 200;

The numeric BIGINT ordering on m.id is required: converting to a text alias and ordering by the alias can yield lexicographic 9, 8, 71, 70, rather than numeric 71, 70, 69. This was confirmed with read-only Neon queries. A high-watermark cursor alone can miss late commits; use durable message-ID receipts and reconciliation. No subject/details are returned; real reads require independent authentication, tenant binding, least-privilege role and owner release.

## Scheduling context

The previous six offset slots are superseded for ChatGPT task scheduling: only the existing VITO XX:00 monitor remains enabled. A TIME :50 phase would be internal to an independently approved dispatcher; it is NOT implemented or scheduled.

**Status**: VITO_SINGLE_SCHEDULER_CONFIRMED · VITO_TRIAGE_READ_ONLY · TIME_ADDRESS_BLOCKED · TENANT_BINDING_BLOCKED · RECEIPT_STORAGE_PENDING · TIME_AUTOMATION_NOT_CREATED · BOB_REVIEW_PENDING · OWNER_RELEASE_NO_GO.
