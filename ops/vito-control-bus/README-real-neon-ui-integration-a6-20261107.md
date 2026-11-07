# VITO ONE COCKPIT · A6 · Real CONTROL BUS integration + synthetic Owner UI test

**Date:** 07 Nov 2026. **Source:** existing draft [PR #177](https://github.com/lavolpeofficial/vito-platform/pull/177), following [A5 builds](https://github.com/lavolpeofficial/vito-platform/blob/feat/vito-control-bus-receipts-a1-20261106/ops/vito-control-bus/README-native-build-a5-20261107.md). No new cockpit, Login, database, agent schedule or shared owner credentials.

## Verified actual integration (HEL1 isolated)

1. Confirmed latest private PR #177 remained OPEN / DRAFT and the `vito_cockpit_reader_a3` PostgreSQL account still had **SELECT on both** exact bounded views and **no SELECT** on the original `vito_control_bus_v1.messages` table.
2. Obtained **only the dedicated read-only role** connection from the authorized Neon connector. Placed its runtime values temporarily under a private, ephemeral `/run` directory with `0700` directory and `0600` configuration permissions. No password, full URI, bearer token, or Owner UUID was emitted in tool output or committed to GitHub.
3. Ran the **compiled NestJS `ExecutiveReceiptsService`**, not a SQL imitation, against real Neon through its own `PrismaClient`. A synthetic in-process Owner tenant context (same organization identity as verified from the existing FSN1 VITO Owner database) succeeded:
   - **26** bounded dispatch receipts; latest `dispatchId=89`.
   - **41** bounded self-reported specialist status rows; latest `reportId=91`.
   - Wrong tenant, ADMIN role and `insecure-header` auth context all rejected with **ForbiddenException**.
   - Returned rows consistently keep `authenticatedAgentAck=false`, `executionVerified=false`, `ownerReleaseApproved=false`.
4. Serialized the **actual backend JSON** and passed it through the **actual Next.js frontend parsers** `parseReceiptOverview` and `parseSpecialistReportsOverview`. Both accepted all rows (26/26, 41/41), fresh and same-tenant, with no false cryptographic ACK/approval claims.
5. Started the previously built private Next.js 16.2.1 UI only at `127.0.0.1:31991`, with an ephemeral loopback-only QA API at `127.0.0.1:32980`. The QA API used a **synthetic, unsigned test token and mock account records** for testing the UI only; it read real receipt/report data via the restricted Neon role and served a synthetic Operations summary.
   - Anonymous `GET /` → **307 /login**.
   - Synthetic Owner-cookie `GET /` → **200**, rendered **ONE COCKPIT**, operations panel, real CONTROL BUS handoffs and specialist panel, including the reported URTALI R65 live status in message **#91**.
   - This is **not proof of actual signed JWT validation or real VITO Owner login**; the synthetic API deliberately substitutes for that gate.
6. Terminated **both** loopback servers and verified no listeners on those ports. Deleted the entire private `/run` directory, including temporary Neon connection parameters, mock token/cookie and QA HTML.

## Established previous gates (A5, unchanged)
- NestJS API native build **PASS**; Jest **14/14 PASS**.
- Next.js production build **PASS**, including TypeScript and static generation **15/15**.
- Frontend contract tests **13/13 PASS**; portable test runner added to PR #177 for HEL1's Node build lacking native TypeScript stripping.
- Existing public VITO login still returns HTTP 200 / TLS verified. No live restart or change.

## Remaining release gates – do not claim COMPLETE yet

1. **Real signed Owner JWT login end-to-end** on the existing VITO API, including unauthorized, ADMIN, other-organization negative cases. Do not mint an Owner JWT from an internal signing secret as a substitute for a legitimate login.
2. **Secure persistent runtime secret provisioning on FSN1** (dedicated view-only connection, exact verified Owner organization ID) via approved service secret management, and feature flag gated to Owner only.
3. **Private FSN1 canary**, API/Next runtime smoke/browser QA, rollback specification and review of concurrent uncommitted staging work. No automatic merge into unrelated branches.
4. Controlled production release to the **existing** `https://vito.la-volpe.it/login`, only after the signed-session and canary/rollback tests. A source build does not mean public live.
5. **Verified agent ACK and execution proof** is a separate post-MVP trust feature. CONTROL BUS sender labels and reported status remain unsigned and cannot prove autonomous execution.

**Evidence status:** `REAL_NEON_READONLY_SERVICE_PASS` · `API_TO_UI_JSON_CONTRACT_PASS` · `SYNTHETIC_OWNER_UI_RENDER_PASS` · `TEMPORARY_SECRETS_CLEANED` · `SIGNED_OWNER_LOGIN_PENDING` · `FSN1_CANARY_PENDING` · `PRODUCTION_UNCHANGED`.

**Owner interpretation:** the user wants VITO finished and autonomous; this A6 gate demonstrates a working data pipeline but does not waive identity, authorization or release protections.
