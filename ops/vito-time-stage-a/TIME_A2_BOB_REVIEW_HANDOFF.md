# VITO × URTALI TIME · A2 independent review handoff

**Private candidate · 06.11.2026 · NO MERGE / NO DEPLOY / NO DB MIGRATION**

## Single-scheduler decision

The user's approved topology uses **the one existing VITO central ChatGPT automation** (enabled, Europe/Rome XX:00). It currently performs **read-only triage only**, not automatic execution and not Fachchat wake-up. Do not add a TIME scheduled task. TIME XX:50 was a proposed internal phase, NOT an enabled automation. Existing portal routes unchanged.

## Verified external evidence (read-only)

- Neon: project `patient-paper-37122556`, DB `adoren_auth_staging`, table `vito_control_bus_v1.messages`.
- `messages_sender_check` and `messages_recipient_check` **exclude** `time`.
- Relation `relrowsecurity=false`, `relforcerowsecurity=false`, and table has no `organization_id`.
- Available direct table privileges were reported for `adoren_staging_owner` only; no demonstrated least-privilege TIME identity.
- `id` is BIGINT PK, `UNIQUE(sender,idempotency_key)` and `(recipient,id)` index exist.
- IMPORTANT: `ORDER BY id` when `SELECT id::text AS id` may sort lexicographically; Neon returned 9,8,71,70 before 69. `SELECT id::text AS message_id ... ORDER BY id DESC` returned 71,70,69,68. The example SQL now uses `ORDER BY m.id ASC` (original numeric field).
- Messages and their sender values alone **do not authenticate a VITO delegation**.

## Code and test evidence

Existing pure read-only `time-inbox-gate.mjs` and `time-inbox-gate.test.mjs` remain single source for the TIME Inbox. Original file documentation records 16/16 inbox tests and 53/53 TIME offline tests locally; those earlier Node test results were NOT rerun in this turn.

Six additional targeted **JavaScript-isolate checks** were executed directly against the currently fetched module source. 6/6 PASS: numeric order 9 vs 71; UNKNOWN receipt suppression; no `executionAllowed` on a source label; cross-tenant receipt rejection; secret-detail redaction; unverified source rejection. These are NOT NestJS API integration or GitHub CI evidence.

Integration candidate: `time-recipient-constraint.CANDIDATE.sql`, `time-inbox-receipts.CANDIDATE.sql`, and `TIME_CONTROL_BUS_ACTIVATION.md`. No migration or receipt table was actually created.

## Independent BOB review checklist (not yet executed)

1. Review exact preflight and lock behavior of additive CHECK constraint migration, schema drift, legacy sender/recipient compatibility, and rollback.
2. Establish signed/audited VITO principal authorization and tenant-to-message mapping **independently** from raw bus sender/recipient/JSON.
3. Design dedicated least-privilege per-service roles; do NOT reuse the DB owner identity. Prevent cross-tenant read via guarded server-side API and restricted projection, not only UI filters.
4. Review durable atomic message-id claim, concurrent worker replay protection, crash recovery, unknown state escalation and reconciliation after out-of-order commits; never rely on max(id) alone.
5. Require separate idempotent authorized TIME sender for replies; receipt in CONTROL BUS is not execution success.
6. Verify existing VITO automation remains one read-only scheduler until specific Owner activation and tested execution pipeline; no duplicate scheduled tasks.
7. Private staging E2E on isolated data, negative tests (forged sender, unauthorized tenant, retry/crash, PII and secret leakage, wrong receiver), and audited evidence. No real customer BOOKING writes.
8. Record independent BOB decision and outstanding risk; then ask Owner for explicit approval **before** migration, worker activation, or deployment.

## Current acceptance

`A2_DOCUMENTED_AND_PRIVATE_REVIEW_READY` only. Not an authorization to run BOB autonomously. `TIME_ADDRESS_BLOCKED`, `TENANT_GATE_BLOCKED`, `DURABLE_RECEIPTS_PENDING`, `AUTO_EXECUTION_DISABLED`, `OWNER_RELEASE_NO_GO`.
