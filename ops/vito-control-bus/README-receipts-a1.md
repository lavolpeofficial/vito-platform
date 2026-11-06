# VITO CONTROL BUS · private receipt projection A1
## Purpose
Deliver a **read-only, owner-only** projection of VITO dispatches and specialist return receipts using the **existing** Neon `vito_control_bus_v1.messages` table. This is a source candidate for **ONE COCKPIT #174**, not a standalone dashboard and not a new messaging database.

### Evidence states
| Source event | Machine representation | What it does NOT prove |
|---|---|---|
| VITO outgoing `task` / `handoff` | `DISPATCHED_NOT_ACKNOWLEDGED` | Chat read, agent accepted, work started |
| Specialist's independent `report` with matching `in_reply_to` and `receipt_state=RECEIVED` | `RECEIPT_REPORTED_UNVERIFIED_SENDER` | Authenticated identity, signed ACK, implementation |
| User pastes specialist-chat response into VITO; VITO logs self-report | No independent receipt. Retain as separate human-reported evidence | Specialist's own durable message |
| Specialist claims `completed` or supplies a test count | Must be checked against independent source and scope | Release approval, correctness or live delivery |

**Never** automatically turn receipt statuses into `ACK_SIGNED`, `ACCEPTED`, `COMPLETED`, `LEGAL_APPROVED`, or `PUBLIC_GO`. `sender` is a text label, not an authenticated agent identity. An INSERT via a shared Neon owner credential cannot establish agent-specific provenance.

### A1 source and test
- Query: [receipt-ledger-readonly.sql](./receipt-ledger-readonly.sql). No network, no DDL, no writes. Read-only using existing columns.
- On 06.11.2026 queried the connected real Neon DB twice: first all 16 outgoing dispatches were `DISPATCHED_NOT_ACKNOWLEDGED`, then independent EMPORIO report **#69** was discovered (sender `emporio`, recipient `vito`, `details.in_reply_to=67`, `details.receipt_state=RECEIVED`). The candidate was corrected and rerun: 16 dispatch rows, **only #67** has `receipt_id=69` / `RECEIPT_REPORTED_UNVERIFIED_SENDER`. Manual owner-relayed report **#68** (sender `vito`) remains excluded. All rows retain `authenticated_agent_ack=false`, `execution_verified=false`, `owner_release_approved=false`. No source- or site-integration completion is claimed.
- The query must be invoked only in authorized Owner/Admin backend contexts with tenant-safe access. The raw messages table currently contains **no organization_id**; therefore this query must NOT be exposed as a general tenant query, unrestricted REST endpoint or public browser call.
- For performance keep a bounded result limit and add appropriate database read permissions before genuine deployment. Never use superuser fallback in a runtime.
- No automatic polling agent, chat wakeup, native API route or new service is delivered by the SQL alone.

### Receipt writer / separate specialist pilot
Owner authorized a narrowly bounded single EMPORIO pilot: independently read Neon message **#67**, then optionally write one independent report with `sender=emporio`, `recipient=vito`, `topic=report`, `in_reply_to=67`, `receipt_state=RECEIVED`, and a stable sender-scoped idempotency key. The writer must use generated/identity `id` (never set manually) and `ON CONFLICT(sender,idempotency_key) DO NOTHING`. If connection, authorization or source verification fails, do **not** forge an ACK.

Specialist reply is still an **unsigned report**, subject to a separate evidence check and potential cryptographic agent identity implementation. Do not treat a pilot receipt as proof of performed work.

### Release boundary
PR/branch only; no merge, production SQL, data migration, alternate dashboard, provider service, Agent IAM activation, public deploy or paid API.
