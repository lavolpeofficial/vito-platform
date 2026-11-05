# VITO Private Owner · Repeatable synthetic loopback E2E

**Status:** isolated QA only. Does **not** authorize production activation or merge.

## Objective

Verify the actual built Next.js VITO Control Center's login, session cookie, server API helper and owner-only authorization with **synthetic** user and organization records. No real accounts, authentication secrets, production database or Internet services are required.

Test program: `qa/vito-owner-only-synthetic-loopback.mjs`. Uses only the Node standard library. It runs an HMAC-checked synthetic API server on `127.0.0.1:33878` and the *already built* Control Center on `127.0.0.1:33977`. Both processes terminate after the check. It sets fake user/organization pin values **only in the private child-process environment**. It never changes live server configuration.

### Preconditions

- Run only in an isolated development copy containing PR #175 owner-only changes.
- Node.js 22 or newer **with TypeScript support if running TypeScript tests**; the E2E harness itself is plain JavaScript.
- Control Center dependencies installed; compile Next.js (Webpack if required) before testing.
- Both loopback ports unoccupied. Do not expose or forward the test ports.
- Do not run on a public deployment or with real owner credentials, private client secrets or production database connection strings.

### Example

```bash
pnpm --filter @vito/control-center exec next build --webpack
node qa/vito-owner-only-synthetic-loopback.mjs
```

The harness writes a **local, synthetic-only** report to `.local-qa/R378_OWNER_LOGIN_LOOPBACK_E2E_RESULT.json`. This directory is untracked and should never be published.

### Acceptance criteria (25 checks)

Synthetic owner login and session pass. A second human with the same `OWNER` role, an `ADMIN`, and an owner from another organization must all be denied at login, cookie issuance, session re-use and Executive API entry. Anonymous requests, tampered signatures, revoked owner session, cross-origin mutation and unsigned organization-header shortcut are rejected. Host-only Secure/HttpOnly/SameSite cookie flags must be present. Both services bind only to loopback and exit cleanly.

**Test-fixture limitation:** The fake API validates synthetic tokens, rather than exercising a real VITO PostgreSQL/Prisma-backed identity server. The VITO JWT strategy and password login have separate source-level Jest integration coverage in this draft. A successful synthetic E2E is **not** evidence of live owner enrollment, live MFA, proxy policy, real machine execution or production safety.

## Verified private builds · 2026-11-05

| Isolated source | Build ID | Synthetic loopback E2E | Other evidence |
|---|---|---|---|
| Live-lineage R376 + reviewed owner patch | `PwED3a87vWO1LVvv7_7xw` | 25/25 PASS | 148/148 Control Center tests; 28/28 auth tests; TS + Next build + Nest build |
| R377 Gate4 forward-copy + same owner patch | `HrrGuB4EoySST81Al2AOr` | 25/25 PASS | 16/16 owner tests; TS + Next build |

The full original R376 and R377 source trees and the running live R376/R369 containers were **not modified**. Only separate private copies were used. Local test ports were closed after execution.

## Production release remains blocked

Before any activation, obtain securely verified local user/organization IDs, evidence of the true live deployment, real owner sign-in, other-human denial using isolated staging identities, a verified machine workflow, MFA/recovery controls and ingress restrictions. The backend human-only feature flag remains **OFF by default**. The real owner pins must never be committed, pasted into public GitHub or logged. Deploy only through a separate explicit Owner/Security release approval.

Future LA VOLPE ID OIDC federation is separate from these local JWT tests.
