# VITO × URTALI TIME · A1 (isolated, read-only)

Status: **PRIVATE CANDIDATE / NO MERGE / NO DEPLOY / NO BOOKING CHANGE**.

This is a projection adapter, **not a second booking/calendar engine**. It maps already-authorized, tenant-scoped VITO task snapshots and permitted non-sensitive Neon CONTROL BUS receipt metadata into observable TIME activity events. It cannot schedule appointments, send notifications, approve a task, or dispatch an agent.

## Test

Run with Node.js 22+:

node --test ops/vito-time-stage-a/time-projection.test.mjs

The isolated local implementation was tested with **16/16 PASS** on 2026-11-06. A CI or live runtime test on this GitHub branch is NOT yet demonstrated.

## Boundaries

- Reuse existing VITO Owner/Admin JWT/HttpOnly, tenant-scoped API and event evidence; the adapter does **not** implement authentication.
- For tasks, reject cross-tenant data. BUS receipt metadata must additionally be tenant-scoped by the server-side reader.
- No user/customer descriptions, email addresses, bus details or secrets passed to TIME.
- A source sender label is not verified agent identity. A task with COMPLETED status is not proof of successful execution.
- Existing VITO task schema contains **no guaranteed dueAt**: output deadlineAt=null is intentional. Never fabricate due dates.
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
