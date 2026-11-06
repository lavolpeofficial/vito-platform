# VITO × URTALI TIME · A1 (isolated, read-only)

Status: **PRIVATE CANDIDATE / NO MERGE / NO DEPLOY / NO BOOKING CHANGE**.

This is a projection adapter, **not a second booking/calendar engine**. It maps already-authorized, tenant-scoped VITO task snapshots and permitted non-sensitive Neon CONTROL BUS receipt metadata into observable TIME activity events. It cannot schedule appointments, send notifications, approve a task, or dispatch an agent.

## Test

Run with Node.js 22+:

node --test ops/vito-time-stage-a/time-projection.test.mjs

The original 16 tests plus 21 new private tests passed locally on 2026-11-06 (**37/37 PASS**). CI or authenticated runtime tests on this branch are not verified. Command: node --test ops/vito-time-stage-a/*.test.mjs

## Boundaries

- Reuse existing VITO Owner/Admin JWT/HttpOnly, tenant-scoped API and event evidence; the adapter does **not** implement authentication.
- For tasks, reject cross-tenant data. BUS receipt metadata must additionally be tenant-scoped by the server-side reader.
- No user/customer descriptions, email addresses, bus details or secrets passed to TIME.
- A source sender label is not verified agent identity. A task with COMPLETED status is not proof of successful execution.
- Existing VITO Prisma Task and Task API have a **nullable dueAt**. Only the explicitly present dueAt projects to deadlineAt. Never infer dates from createdAt/updatedAt.
- No write to Neon, booking database, TIME, calendar providers, mail systems, GitHub workflows or production.
- Calendly remains the existing live external booking route; URTALI TIME remains part of URTALI SYSTEMS.
- Bob review is an optional controlled review gate and needs separate activation; do not claim Bob has executed this task.

## Remaining Stage A

1. Validate against the REAL scoped VITO /tasks and CONTROL BUS read model, from server only.
2. Present activity in VITO ONE COCKPIT. Add a separate trusted deadline contract and reminders only after a durable, owner-approved record is designed.
3. TIME read-only integration with existing BOOKING upstream and clear data boundaries; no duplicate engine.
4. Private E2E, cross-tenant, redaction, replay and delivery QA; owner release decision.

## Dependencies

- VITO ONE COCKPIT: https://github.com/lavolpeofficial/vito-platform/issues/174
- VITO × BOOKING adapter: https://github.com/lavolpeofficial/vito-platform/issues/167 (**WAITING / NO MERGE / NO DEPLOY**)
- URTALI BOOKING upstream: https://github.com/lavolpeofficial/orientation-systems/issues/272

## Private A1 extension · 2026-11-06

Files: time-projection.mjs (now honors nullable Task.dueAt); time-private-agenda.mjs (pure follow-up and outbox intent planner); time-private-agenda.test.mjs (21 additional tests). No I/O, agent dispatch, booking writes, notifications or deployment.

### Source boundaries

VITO Task GET /tasks already uses JWT TenantContext. For TIME, an authenticated Owner/Admin server reader must enforce organizationId per row and pass only task id, organizationId, non-sensitive title, status, createdAt, updatedAt and optional dueAt. Never pass descriptions, email, customer data or secrets.

The live Neon staging-synthetic CONTROL BUS message table contains id, sender, recipient, topic, subject, details, idempotency_key and created_at. It has NO organization_id and NO authenticated agent or execution state. A real BUS read is therefore BLOCKED until an independently verified tenant-to-message mapping and restricted server-side read-only role exist. The busVerified flag is an assertion for an already trusted server adapter, NOT an authorization control; never accept it from client input. Do not infer tenancy from sender/recipient, or treat messages as completion evidence. Only pass permitted message id, allowlisted sender label/topic and timestamp; no subject/details.

### Follow-up and notification boundaries

Owner-approved follow-up records require recordId UUID, JWT-derived organizationId, authorized eventId, ISO followupAt and source OWNER_APPROVED_TIME_RECORD. The module validates them but does not create, persist or approve them. Without a trusted durable record, no scheduled follow-up is manufactured.

IN_APP reminder intentions are deterministic (SHA-256 key per tenant+slot+time+lead+channel), with 60-minute and at-deadline policies and a bounded catch-up. The planner is PLAN_ONLY; there is NO durable outbox or send. Existing evidence suppresses duplicate intents, including UNKNOWN outcomes. Production uniqueness requires atomic unique (organization_id, intent_key), lease/recovery semantics and verified delivery receipts. A receipt ID by itself is not delivery proof; only server-verified client/provider acknowledgment may establish delivery.

### QA and release gates

- Local projection + followup/outbox contract tests: 37/37 PASS.
- Real owner-authenticated task API read: PENDING.
- CONTROL BUS secure tenant scope: BLOCKED.
- Durable outbox and independently verifiable delivery evidence: PENDING.
- ONE COCKPIT / BOOKING private E2E: PENDING. Booking Issue #167 stays WAITING.
- Bob independent review: PENDING.
- Public release: OWNER_RELEASE_NO_GO; NO MERGE; NO DEPLOY.
