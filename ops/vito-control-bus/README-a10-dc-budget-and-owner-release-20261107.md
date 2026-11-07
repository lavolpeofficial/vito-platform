# VITO ONE COCKPIT · A10 · DC budget discipline & Owner release gates

**Owner GO:** 2026-11-07. Applies to the existing ONE COCKPIT in PR #177 and the already-established central VITO CONTROL BUS. This is an operations/runbook change only: **no production deployment, credential copy, login attempt, database migration, container restart, or new scheduled job**.

## Tool-call budget (screenshot baseline)

- Desktop Commander: **3,214 / 10,000** calls consumed in November; **6,786 remaining** when observed.
- Dashboard displayed 459 calls/day to date, reset **1 December 2026** with ~24 days left. Sustainable mathematical average: ~**283 calls/day**. Operating target: **at most 250 DC calls/day** to retain variance buffer.
- This figure is a point-in-time account dashboard measurement, not a live API-derived quota. Never claim a current balance from the screenshot after it changes.

## Execution policy · effective immediately

1. **GitHub status/PR/diff/comments** → use the connected GitHub API directly. No SSH/Commander clones or repeated status commands.
2. **Neon read-only queries, role/view checks, CONTROL BUS entries** → use the connected Neon API directly. Avoid remote psql when the connector answers.
3. **FSN1/HEL1 reality checks** → use Commander only when actual host state is essential. Bundle safe **read-only** checks (host, memory, swap, disk, Docker, route/TLS, bind mounts) into **one** targeted terminal invocation. Capture a concise report; do not stream repeated `docker stats`.
4. **Completed test gates** are immutable evidence attached to the exact build commit and environment. Rerun only on changed relevant code, a new target image, a materially changed runtime, or a release acceptance gate.
5. Use the **existing** hourly central VITO CONTROL BUS automation; do not create 6 parallel portal automations or extra hourly DC polling jobs.
6. **Stop rule:** no speculative Commander calls, no broad `docker system prune`, `swapoff`, indiscriminate container stop, duplicate build or staging installation. Prefer existing HEL1 80-GB data volume for private builds/archives. Production operations are change-controlled and reversible.
7. Never print, log, commit, transmit through URL query strings, or place database passwords/JWTs into the browser, GitHub comments, or shell history. Use approved root-owned 0600 secret stores and narrowly scoped runtime bindings, verified without displaying their values.

## Reused proven evidence (do not redo without an invalidating change)

| Gate | Confirmed evidence | Meaning |
| --- | --- | --- |
| A5 | NestJS + Next native builds, API 14/14 and FE 13/13 | private build passed |
| A6 | real Neon view-only data with synthetic Owner session | not a live Owner login |
| A7 | signed JWT/password HTTP **19/19**, synthetic test identities | real verification code, not actual production Owner credentials |
| A8 after A9 | 9/9 host capacity checks; **978 MiB available RAM**, 575 MiB free swap, 6061 MiB disk; 35 active containers | capacity passed at the observation, NOT deploy authorization |
| Neon reader | `vito_cockpit_reader_a3`: SELECT on two approved projections, no base table read/write | separate role exists; do not reuse monitor credentials |
| FSN1 Owner binding | exactly one live organization with Owner user; matches running UI Owner organization UUID | verified by read-only boolean comparison; no UUID printed |
| A9 | seven historically isolated preview/closed-revision containers stopped reversibly; VITO/URTALI HTTP200 valid TLS | no deletion; retain rollback |

Primary evidence: [A9 PR comment](https://github.com/lavolpeofficial/vito-platform/pull/177#issuecomment-6711988077) and central CONTROL BUS report **#94**.

## A10 remaining hard gates

### G1 — Secret delivery
A dedicated `VITO_CONTROL_BUS_READONLY_DATABASE_URL` for the validated **`vito_cockpit_reader_a3`** role must be provisioned only to the **server-side NestJS API runtime**, using an approved root-only secret mechanism. The existing `/etc/vito/control-bus-watch.env` is an unrelated monitor credential and **must not be repurposed** as the cockpit reader. Verify privileges again at connection time. Keep `VITO_CONTROL_BUS_READER_ENABLED=false` until the authenticated private QA succeeds.

### G2 — Owner identity and session
Use the ordinary VITO login and an already-authorized **real Owner browser session**. Test `GET /executive/receipts` and `GET /executive/reports`, and ensure anonymous access, ADMIN, foreign tenants, expired/revoked tokens and insecure headers are rejected; use no fabricated production JWT, no production password extraction, no request replay of private credentials. Use a private controlled integration path before public promotion.

### G3 — Release and rollback
Snapshot the current UI/API bind-mounted assets and image IDs; verify exact commit/build hashes, host A8 capacity again, and a constrained rollback path. Do not build a second full production stack on FSN1 just because A8 passed once. Merge/promote PR #177 only after the reviewer/Owner authorizes the actual rollout and all security checks pass. Validate VITO login/overview, URTALI public paths and the data-source freshness/unsigned-report labels after promotion.

### G4 — Status representation
CONTROL BUS `sender` and specialist receipts are **unsigned self-reports**. Do not label them authenticated ACK, verified execution or legal/public approval. Missing/old data shows `UNKNOWN`/`STALE`, never green.

**Verdict:** `A10_BUDGET_POLICY_DOCUMENTED` · `NEON_VIEW_ONLY_ROLE_CONFIRMED` · `OWNER_ORGANIZATION_MATCH_CONFIRMED` · `REAL_SIGNED_OWNER_BROWSER_SESSION_PENDING` · `READER_SECRET_RUNTIME_PENDING` · `PUBLIC_RELEASE_NO_GO`.
