# VITO ONE COCKPIT · A7 signed-JWT and password-login HTTP gates

**Executed:** 2026-11-07, in the existing private HEL1 tree `/mnt/HC_Volume_107046139/vito-cockpit-a3-isolated-20261107`. Existing source: [PR #177](https://github.com/lavolpeofficial/vito-platform/pull/177). No public service, production login, Neon role, credential or VITO database was changed.

## Actual verification

Executed the **existing, pre-authored** A7 integration-test sources using the project's installed Jest/NestJS infrastructure:

```sh
cd apps/api
NODE_OPTIONS=--max-old-space-size=640 \
  ./node_modules/.bin/jest \
  --config ./test/jest-e2e.json --runInBand \
  --runTestsByPath \
  test/executive-owner-auth-a7.e2e-spec.ts \
  test/executive-owner-login-a7.e2e-spec.ts --silent
```

**Result: 2/2 test suites PASS; 19/19 tests PASS; exit 0.**

The suites execute the real NestJS HTTP framework, Passport-JWT strategy, auth guards, actual `AuthService.login()`, bcrypt password verification and JWT signing/validation, but with **synthetic test-only credentials, keys and in-memory identity database**. Receipt/report data is mocked for this signed-auth test; earlier A6 tested **real** Neon read-only data with a synthetic account and Next UI. Neither alone proves a real live Owner login.

Negative cases covered include anonymous users (401), token tampering (401), expiry (401), stale token versions (401), deactivated Owner (401), suspended organization (401), forged Owner role in ADMIN token (403), a different tenant Owner (403), JWT organization claim mismatch (401), and signed machine identities without necessary scope. The password-login suite tests valid OWNER login `POST /auth/login` → bearer JWT → `GET /executive/receipts` and `/executive/reports` 200, wrong password 401, unknown organization 401, ADMIN valid login but protected endpoint 403, and JWT invalidation after token version change.

## Actual FSN1 release environment observed after archive cleanup

- Root disk: **6.0 GB free / 84% used**.
- `MemAvailable`: **~691 MiB** out of 3814 MiB physical RAM.
- Swap: **2043 of 2047 MiB used**, just ~4 MiB free.
- Current live containers: `vito-r376-ui-live` (bind mounts existing `.next`), `vito-r369-api-live` (bind mounts existing `dist`), `vito-r368-api-live` (rollback/parallel) **Up**.
- `https://vito.la-volpe.it/login`: **HTTP 200, TLS valid**.
- Current live API image and UI bind mounts were inspected read-only. No service restarts.

## Remaining hard gates

1. **Real, already-authorized Owner login:** test using the normal VITO authentication flow tied to the actual FSN1 identity database, no fabrication of production JWTs, no reuse or disclosure of password/secret. Validate both Owner-only endpoints and frontend session in a private controlled deployment, plus negative role/tenant handling.
2. **Private deploy/secret provisioning:** `VITO_CONTROL_BUS_READONLY_DATABASE_URL` must refer only to the verified Neon dedicated view-only role, never the database owner. `VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID` must exactly match the actual Owner organization. Secrets go only in approved server-side secret management, never GitHub, browser bundles or response logs. Feature off until authorization tests pass.
3. **Capacity guard:** Do NOT start a second full VITO stack on FSN1 while available memory is ~691 MiB and swap almost full. Prefer completing QA on HEL1 and performing an atomic, reversible in-place release after approval, preserving both existing bound assets and Docker images. Follow host-level memory/swap probe before changeover.
4. **Merge/release/rollback:** PR #177 remains DRAFT. Coordinate currently changed source worktrees and preserve previous `vito-r376-ui-live` and `vito-r369-api-live` bind mount contents for immediate rollback, with health probes and owner/browser acceptance before public release.
5. **Trust model:** CONTROL BUS specialist `sender` and status are still unsigned self-reports; the UI must not claim authenticated agent ACK, completed execution, or Owner approval without evidence.

**Verdict:** `SIGNED_JWT_TEST_ENV_HTTP_PASS_19_OF_19` · `REAL_NEON_DATA_AND_SYNTHETIC_UI_A6_PASS` · `REAL_PRODUCTION_OWNER_SESSION_PENDING` · `FSN1_LOW_MEMORY` · `PR177_DRAFT` · `PUBLIC_DEPLOY_NO_GO`.

This document intentionally does **not** assert a real production Owner login was completed.