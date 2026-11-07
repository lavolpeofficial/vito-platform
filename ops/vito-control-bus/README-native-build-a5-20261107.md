# VITO ONE COCKPIT · A5 isolated native build and login gate · 07.11.2026

**Scope:** Owner instruction “bauen wir VITO zu Ende”. Existing [PR #177](https://github.com/lavolpeofficial/vito-platform/pull/177), not a new dashboard or a new auth system. Source repo `lavolpeofficial/vito-platform` on private branch `feat/vito-control-bus-receipts-a1-20261106`.

## Actual test environment

HEL1 isolation path:
`/mnt/HC_Volume_107046139/vito-cockpit-a3-isolated-20261107`

The working tree was checked clean against commit `e08bed8309ca2e0978abfdeb11b25cd7654a431d` before tests. **Other working trees** (`/srv/lavolpe/src/vito-platform-staging`) have concurrent uncommitted changes, so they were not touched. Existing live VITO on FSN1 was not restarted or replaced.

### Verified, actually executed

| Gate | Result |
|---|---|
| Native NestJS API `nest build` with bounded heap | **PASS**, exit 0 |
| API Jest tests `executive-receipts.spec.ts` and `owner-specialist-reports.spec.ts` | **14/14 PASS**, 2/2 suites |
| Native Next.js Control Center production build | **PASS**, Next.js 16.2.1, TypeScript PASS, 15/15 static pages |
| OWNER operational/receipt/reports UI contracts | **13/13 PASS** |
| Anonymous `GET /` on isolated Next `127.0.0.1:31991` | 307 → `/login`, `Cache-Control: private, no-store` |
| Anonymous `GET /login` | 200 |
| Anonymous `GET /operations` | 307 → `/login` |
| Isolated Next server | Stopped after smoke check |
| Existing public VITO `https://vito.la-volpe.it/login` | HTTP 200, valid TLS |
| Neon `vito_cockpit_reader_a3` on staging-synthetic | SELECT on two allowlisted projections; raw messages read/write denied |

HEL1's system Node 22 executable lacks direct TypeScript source stripping (`ERR_NO_TYPESCRIPT`). A native repo test command dependent on `--experimental-strip-types` failed for that environmental reason. To remove the obstacle permanently without adding dependencies, **PR #177 now includes** `apps/control-center/tests/run-contract-tests.cjs` using its already-pinned TypeScript dependency, and changes the `test` script accordingly. The **actual saved new runner** was executed against the existing sources: **13/13 PASS**.

### Actual Owner organization boundary

Read-only Prisma query against the **currently running FSN1 VITO API database** found exactly **one** distinct organization linked to an OWNER user. Its exact UUID was not copied to GitHub or this report and must be set via private runtime configuration only. The in-source one-Owner UUID boundary remains fail-closed.

### Current deployment blockers

1. **Runtime credential handoff** for `VITO_CONTROL_BUS_READONLY_DATABASE_URL` via authorized secret management. Never commit or echo database passwords or use the existing Neon staging owner credential. Verify actual reader grants and Owner organization UUID under a private VITO test runtime. The code's default `VITO_CONTROL_BUS_READER_ENABLED` stays false.
2. **Authenticated Owner login/browser test** of `/executive/receipts`, `/executive/reports` and the existing ONE COCKPIT. Include negative cross-tenant/non-OWNER checks. Anonymous redirect smoke is **not** this gate.
3. **Diff/release review**, repository branch integration and reversible rollout on FSN1. The build on HEL1 is neither a deployed service nor confirmation that the browser sees real Control Bus data.
4. Source-health semantics: a BUS `sender`/report status is **not an authenticated agent acknowledgement**, confirmed execution, approval or guarantee of background chat activation.
5. The existing staging UI/API tree has concurrent uncommitted changes; preserve it untouched and review before merging to avoid losing parallel work.

**Verdict:** `PRIVATE_API_BUILD_PASS` · `PRIVATE_NEXT_BUILD_PASS` · `JEST_14_OF_14_PASS` · `UI_CONTRACTS_13_OF_13_PASS` · `ANON_AUTH_ROUTE_GATE_PASS` · `OWNER_LOGIN_AND_SECRET_BINDING_PENDING` · `PUBLIC_DEPLOY_NO_GO`.

The reported URTALI R65 public release #91 was independently spot-checked (four `/legal/` and four `/terms/` routes returned HTTP 200 with valid TLS). It is a separate project and does not authorize VITO deployment.
