# VITO ONE COCKPIT · A2 Operations attention on existing home

**Scope:** Private existing VITO Control Center extension on [issue #174](https://github.com/lavolpeofficial/vito-platform/issues/174) / [draft PR #177](https://github.com/lavolpeofficial/vito-platform/pull/177). No new login, database, runtime endpoint or provider.

## Implemented on existing branch
- Existing Next.js server-side `ControlCenterHome` retains the authenticated HttpOnly session and OWNER/ADMIN role gating.
- Concurrent **independent** read-only API requests: existing VITO `GET /operations/summary` and candidate `GET /executive/receipts`. If one source is inaccessible, the other source can still render.
- New `lib/executive/operations-gate.ts` strictly verifies `organizationId` against the authenticated session, `READ_ONLY` authority, observation age (≤5 min and ≤60 s future skew), consistent per-status workflow totals and bounded attention data.
- New `components/executive-operations-panel.tsx` renders German-first operational indicators: workflows, blocked/failed/running/pending, outstanding **skill promotion reviews**, provider capability gaps, registered digital employees, and up to five *technical* attention rows.
- **No inferred task completion**. `/operations/summary` is VITO operational telemetry, NOT GitHub issue/project/task truth. A provider outage, stale timestamp or unknown authorization renders **source unavailable**, not "0 offene Aufträge".
- The existing CONTROL BUS receipt panel remains deliberately unconnected until an authenticated, tenant-safe server-side Neon adapter exists. The raw Neon table lacks `organization_id`; `sender` label is not authentication.

## Executed local tests (isolated Node 22 TypeScript-capable environment, 07 Nov 2026)
`node --experimental-strip-types --test tests/executive-operations-gate.test.ts`:

| Test | Result |
|---|---|
| Fresh owner tenant snapshot + bounded attention | PASS |
| Cross-tenant / missing tenant / forged write authority fails closed | PASS |
| Stale / invalid / future timestamps fail closed | PASS |
| Contradictory totals, negative counts and excessive attention fails closed | PASS |
| Genuine, verified zero is distinguishable from outage | PASS |

**5/5 PASS**, private pure-contract tests. A separate HEL1 Node build lacked the TypeScript strip feature (`ERR_NO_TYPESCRIPT`); this was an execution-environment issue, not a negative app test. The same standalone test logic then ran successfully on a TypeScript-capable Node environment. The **native Next.js build and authenticated browser QA have not yet been run** on this PR. Do not mark `LIVE`, `API_CONNECTED`, or `TENANT_SAFE_NEON`.

## Owner release gates
1. Run the new code inside an isolated complete `vito-platform` Next.js build, including existing contract suites.
2. Confirm actual VITO `/operations/summary` authorization and tenant equality using an authorized Owner/Admin test session, with cross-tenant negative.
3. Supply a genuinely tenant-safe read-only Neon adapter and authenticated VITO API endpoint for `/executive/receipts` (not raw SQL or frontend token); then browser QA at the existing ONE COCKPIT login.
4. Separate Owner approval before merge, productive rollout, secrets or agent activation.

**Current verdict:** `PRIVATE_COCKPIT_OPERATIONS_A2_SOURCE_READY` / `PURE_CONTRACT_TESTS_5_OF_5_PASS` / `CONTROL_BUS_API_PENDING` / `LIVE_DEPLOY_NO_GO`.
