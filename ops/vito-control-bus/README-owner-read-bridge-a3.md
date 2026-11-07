# VITO ONE COCKPIT · A3 · Owner-only CONTROL BUS API (private candidate)

**Decision (07 Nov 2026):** The owner-facing CONTROL BUS bridge is now **implemented in the VITO API source**, not activated. This extends the existing [ONE COCKPIT PR #177](https://github.com/lavolpeofficial/vito-platform/pull/177) and [Issue #174](https://github.com/lavolpeofficial/vito-platform/issues/174). It does **not** create a new login, UI, database, API credential in the frontend, or additional automations.

## Source changes
- `apps/api/src/app.module.ts`: mounts `ExecutiveReceiptsModule` on the existing VITO application.
- `apps/api/src/modules/executive-receipts/executive-receipts.controller.ts`: `GET /executive/receipts`, existing global JWT AuthGuard plus OWNER role decorator, no requester-controlled organization argument.
- `.../executive-receipts.service.ts`: singleton dedicated Prisma database client, lazy on first permitted request, bounded fixed read query, no exposure of raw `details`, SQL errors or credentials. Explicit one-owner-tenant JWT role check; every call rejects if feature disabled or no approved reader.
- `.../owner-bus.contract.ts`: normalized names/IDs/labels for the *existing* frontend `receipt-ledger/contracts.ts`. All three proofs `authenticatedAgentAck`, `executionVerified`, `ownerReleaseApproved` **always false**. No sender label is accepted as proof of identity.
- `ops/vito-control-bus/owner-receipts-view-a3.private.sql`: **review-only SQL** projection. The `CREATE VIEW` header remains deliberately commented. No DB migrations, users, role grants or secrets were executed.
- `.../executive-receipts.spec.ts`: Jest negative contract/service-gate test source, pending full API Jest run.

## Mandatory security boundary

The **existing** `vito_control_bus_v1.messages` table has **no organization_id** or authenticated specialist identity. This cannot safely serve arbitrary VITO tenants. A3 is allowed to serve **only the explicitly configured Owner organization** and **only OWNER JWT sessions**.

Production environment configuration (not populated here):
```text
VITO_CONTROL_BUS_READER_ENABLED=false
VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID=<verified-existing-VITO-organization-UUID>
VITO_CONTROL_BUS_READONLY_DATABASE_URL=<dedicated-TLS-Neon-view-only-PostgreSQL-URI>
```
Never put these values or credentials into Next.js browser bundles, GitHub, source comments or shared logs. The reader must have only `SELECT` on `vito_control_bus_v1.owner_receipts_projection_v1`, **no `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the underlying `messages` table**. The API checks these permissions on every data read, and fails closed with a generic `CONTROL_BUS_SOURCE_UNAVAILABLE` if violated.

The separate PrismaClient is **one singleton pool**, lazily opened and disconnected on shutdown. The VITO application datasource is not repointed to the Neon CONTROL BUS. The original recipient scope, 100-row limit and cautious receipt semantics remain unchanged.

### Actual source verification
- 07.11.2026: 9/9 isolated runtime tests PASS on HEL1 for Owner JWT tenant, insecure header/role denial, reader privileges, unsigned receipts, missing acknowledgements, malformed and duplicate records, bounded size and verified empty state.
- Four new API source files passed TypeScript syntax transpilation (4/4); standalone pure contract strict `tsc --noEmit` **PASS**.
- Seven additional **isolated mocked service checks PASS 7/7**: trusted Owner read, singleton reader reuse across requests, cross-tenant rejection before DB access, non-Owner/insecure-auth denial, disabled source fail-closed, write-capable DB credential rejection and missing reader configuration. Mocked SQL is **not** evidence of an authenticated live Neon connection.
- **Full NestJS build and integration Jest tests NOT RUN**. Source-level and mocked tests are not authenticated browser QA.
- Real Neon read-only SQL candidate originally returned **25** VITO dispatches, only **one** unsigned specialist receipt. The receipt is an unsigned specialist report, not authenticated completion. After the subsequent URTALI release handoff, the new role safely sees dispatch #89; this is **not** evidence URTALI accepted #89.
- On **07.11.2026** the Owner-authorized *additive*, private database gate was executed on Neon staging-synthetic branch `br-delicate-unit-babt3aup`, database `adoren_auth_staging`:
  - Created `vito_control_bus_v1.owner_receipts_projection_v1` as `security_barrier` view exposing only `dispatch_id, recipient, topic, subject, dispatched_at, receipt_id` and bounded to the latest 100 outgoing VITO task/handoff messages.
  - Created empty dedicated grant scope `vito_cockpit_reader_scope_v1` and Neon `read_only` login `vito_cockpit_reader_a3` scoped to that schema; granted `USAGE` on the BUS schema and `SELECT` only on the narrow view. **No direct SELECT/INSERT/UPDATE/DELETE rights on `vito_control_bus_v1.messages`.**
  - Independently connected *as the new role*: `can_select_view=true`, `can_select_table=false`, `can_insert_table=false`, `can_update_table=false`, `can_delete_table=false`; `rolsuper=false`, `rolcreaterole=false`, `rolcreatedb=false`, `rolbypassrls=false`.
  - Verified actual view query under the new role returns bounded dispatch rows and only the six allowlisted columns. Attempted `SELECT id FROM vito_control_bus_v1.messages` with the reader: rejected with **SQLSTATE 42501 permission denied**.
  - The existing Neon owner account **retains its prior rights**, but must never be used by the runtime reader. No message, source business table, or existing portal release was modified.
- **Full NestJS build and integration Jest tests NOT RUN**, **VITO Owner organization UUID not yet verified**, **restricted connection URL not bound to VITO runtime**, and **authenticated existing ONE COCKPIT browser QA NOT RUN**. The API feature flag remains **disabled**.

## Gates

| Gate | Result |
|---|---|
| Endpoint, source contracts, singleton pool, Owner restriction | IMPLEMENTED IN PRIVATE PR |
| Pure negative runtime checks | PASS 9/9 + mocked service 7/7 |
| Pure strict TypeScript check | PASS |
| Full VITO API build / Jest | NOT RUN |
| Dedicated restricted database user | CREATED, VERIFIED VIEW-ONLY IN STAGING |
| Narrow view | CREATED IN STAGING, SELECT VERIFIED |
| Owner organization UUID mapping | NOT VERIFIED / NOT CONFIGURED |
| Real SQL under restricted role | PASS · direct source-table read DENIED |
| Authenticated real read via new API | NOT RUN · runtime still disabled |
| Next.js logged-in browser | NOT RUN |
| GitHub merge or public deploy | NO_GO |

**The Owner GO for the private restricted view/role was executed.** Next identify the real existing VITO Owner organization UUID, configure the restricted connection securely in an isolated runtime, run full Nest build/Jest and authenticated existing ONE COCKPIT browser. Do not activate `VITO_CONTROL_BUS_READER_ENABLED` before all checks pass. Longer-term multi-tenant use requires a genuinely tenant-owned bus schema / authenticated agent identities, not merely a frontend filter.

**Verdict:** `A3_OWNER_READ_BRIDGE_SOURCE_READY` · `CONTRACT_PASS_9_OF_9` · `DB_VIEW_ROLE_STAGING_VERIFIED` · `FULL_BUILD_PENDING` · `PUBLIC_NO_GO`.
