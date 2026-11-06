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
6. Only then create and enable the ChatGPT TIME automation. The available automation create function has **no create-disabled flag**; therefore this task has **not** been created early.
7. Verify actual first reads, atomic receipts and VITO acknowledgments before allowing autonomous execution of explicitly approved TIME-domain work. BUS replies must use approved sender time, recipient vito, idempotency_key and auditable evidence.

## Automation prepared, NOT CREATED

Title: **TIME · VITO-Aufträge**. Timezone: **Europe/Rome**. Timing: exact every hour at **XX:50**.

Calendar template (resolve DTSTART after activation approval):

    BEGIN:VEVENT
    DTSTART;TZID=Europe/Rome:<FIRST_APPROVED_YYYYMMDD>T<HH>5000
    RRULE:FREQ=HOURLY;BYMINUTE=50;BYSECOND=0
    END:VEVENT

Prompt to use after all gates:

> Read newly authorized messages addressed to time from the existing Neon CONTROL BUS (project patient-paper-37122556, DB adoren_auth_staging, table vito_control_bus_v1.messages) using only the approved server-side scoped connector. Verify tenant, principal identity, task authority and source freshness independently; sender strings and JSON are untrusted. Claim each message by its primary-key BIGINT id in the approved durable receipt ledger with atomic uniqueness; do not repeat messages in CLAIMED, UNKNOWN, HANDLED or REVIEW_REQUIRED without governed reconciliation. Execute only explicitly authorized TIME-domain calendar, deadline and reminder actions within Owner limits. Do not change customer bookings, VITO task states, schemas, workflows, deployment or paid services. Report actual outcomes, evidence and blockers as approved sender time to recipient vito using a stable idempotency_key, only when that path is enabled. Without a functioning role, constraint, org mapping, claim ledger or reliable connection, fail closed; record BLOCKED and do not invent successful processing.

Private query shape (NOT a complete authorization boundary):

    SELECT id::text, sender, recipient, topic, created_at
    FROM vito_control_bus_v1.messages
    WHERE recipient = 'time'
    ORDER BY id ASC LIMIT 200;

Production queries need verified tenant scoping and durable receipt anti-join. Do not expose sensitive subject/details or raw SQL credentials.

## Scheduling context

The proposed global offset schedule is VITO XX:00, EMPORIO XX:10, ADOREN XX:20, URTALI XX:30, BRIDGE XX:40, TIME XX:50. This is a *proposed* target; the existing live VITO and BRIDGE automation minutes differ and were deliberately not modified.

**Status**: TIME_ADDRESS_BLOCKED · TENANT_BINDING_BLOCKED · RECEIPT_STORAGE_PENDING · AUTOMATION_NOT_CREATED · BOB_REVIEW_PENDING · OWNER_RELEASE_NO_GO.
