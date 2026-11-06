# TIME × VITO CONTROL BUS · A2 private integration gate (2026-11-06)

## Verified read-only findings
Database patient-paper-37122556 / adoren_auth_staging, relation vito_control_bus_v1.messages. sender/recipient CHECK lists exclude time, confirmed via pg_get_constraintdef. Existing recipients: vito, owner, adoren, emporio, selecta, urtali, lavolpe, bridge, bob, riccardo, all. Existing senders are the same except all. Primary key on bigint id, UNIQUE(sender,idempotency_key), recipient/id index. **No organization_id, no authenticated actor proof or durable message-processing state.** Only owner role has observed direct table grants; do not use owner DB credentials for an automatic worker.

## Files
- time-bus-inbox.mjs: pure fail-closed inbox planner for VITO→TIME, authorized message IDs only, requires durable claims and does not execute or send.
- time-bus-inbox.test.mjs: negative and replay tests.
- time-bus-constraint-candidate.sql: *unexecuted* additive constraint draft with ROLLBACK safeguard.

## Required security contract
1. VITO records a signed/auditable delegation with scope: VITO sender authenticated server-side, target `time`, message ID, tenant ID, owner authorization, allowed TIME action, expiry, idempotency key and correlation. sender column is NOT identity proof.
2. Trusted server reads `WHERE recipient='time' AND id > :cursor ORDER BY id LIMIT :n` using a dedicated read-only role and reads only approved columns. **A high-watermark cursor alone is not safe** for all insert orders; preserve unprocessed IDs in a durable inbox and handle late commits/reconciliation.
3. Durable per-message claim with unique (consumer='time', message_id), atomic reservation, lease and terminal result. `CLAIMED`, `IN_PROGRESS`, `COMPLETED`, `BLOCKED`, `FAILED`, `REVIEW_REQUIRED`. A failed/unknown run is NOT automatically executed again without verifying side effects and owner permission.
4. Separate restricted writer may emit `sender='time', recipient='vito', topic='report'` with independent deterministic idempotency key. Only after VITO-approved sender rights. No broad shared owner credential; no schema-level privilege broadening.
5. TIME owns scheduling, deadlines, follow-ups and reminders. VITO remains authority for tasks/statuses and approvals. Existing BOOKING / customer-calendar code untouched.

## Automation candidate (NOT CREATED / NOT ENABLED)
Title: TIME · VITO-Aufträge
Schedule: Europe/Rome, every hour at :50, exact schedule.
On each run: verify approved receiver constraint, tenant and credentials, query up to bounded batch, compare durable receipt ledger, process only independently authorized TIME tasks, persist evidence, report back with idempotent authorized channel. If any gate fails: NO EXECUTION / NO WRITE, log BLOCKED. Never infer authorization solely from database sender='vito' or issue title. Avoid sending sensitive payloads to ChatGPT.

## Activation gates
- Owner explicitly approves SQL constraint change, backup and rollback procedure.
- Reader/writer scopes, tenant binding, authorization signatures, and durable unique claim ledger implemented and privately verified.
- Transactional concurrency + crash/replay + forged sender + receipt tests pass.
- BOB independent security review; Owner explicitly authorizes scheduling and execution.
- Until then, no active TIME automation, no DB mutation, no outward notification, NO MERGE / NO DEPLOY.
