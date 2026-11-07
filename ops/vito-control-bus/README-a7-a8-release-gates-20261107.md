# VITO ONE COCKPIT · A7/A8 authentication + FSN1 release preflight · 07 Nov 2026

**Owner instruction:** continue finalizing the existing ONE COCKPIT, without redoing archived storage work or creating another login. Target: [private draft PR #177](https://github.com/lavolpeofficial/vito-platform/pull/177). Existing live `vito.la-volpe.it` remains unchanged.

## A7 · Actually executed on isolated HEL1 source
Exact local sources: `apps/api/test/executive-owner-auth-a7.e2e-spec.ts` and `apps/api/test/executive-owner-login-a7.e2e-spec.ts` (already authored in PR #177; no duplicate test suite created).
- `jest --config ./test/jest-e2e.json --runInBand --runTestsByPath ...`
- **2/2 suites PASS; 19/19 assertions PASS; exit 0**.
- Actual NestJS HTTP test stack, Passport JWT verification, bcrypt password authentication, AuthService.login and Owner-only route guards using **test-only keys and in-memory fake account records**. Covers valid signed Owner token, legitimate password-login → signed token → receipts/reports HTTP 200, anonymous 401, forged/expired/stale token 401, revoked account / suspended org denial, ADMIN 403, foreign Owner organization 403, mismatched token organization claim and machine principal restrictions.
- **Not** a real productive Owner account session. Does not disclose or derive production JWT secrets or passwords. Real Neon + actual UI data pipeline remains A6 verified separately, not claimed as this A7 test.

## A8 · Actual live-host capacity preflight
Added `ops/vito-control-bus/FSN1_RELEASE_PREFLIGHT_A8.sh` to PR #177; pure read-only checks for disk, available RAM, free swap, current live Docker running state, actual mounted API/UI build content, and public login TLS. **Executed exact GitHub source on FSN1** after correcting numeric shell boolean interpretation.

| Probe | Actual outcome |
|---|---|
| Host FSN1 | PASS |
| FSN1 root >=4 GiB free | PASS, ~6062 MiB |
| MemAvailable >=900 MiB | **BLOCKED, ~712 MiB** |
| SwapFree >=128 MiB | **BLOCKED, ~5 MiB** |
| `vito-r376-ui-live` running | PASS |
| `vito-r369-api-live` running | PASS |
| Current API / UI bind mounts exist | PASS |
| `https://vito.la-volpe.it/login` | PASS, HTTP 200, TLS verified |
| **Final verdict** | **`A8_PREFLIGHT=BLOCKED_NO_DEPLOY`, exit 75** |

FSN1 resources are constrained despite successful storage migration: about **6 GB root disk free**, only **~680–715 MiB available RAM**, and practically no free swap. Current VITO live service memory from `docker stats --no-stream`: `vito-r376-ui-live` ~145 MiB, `vito-r369-api-live` ~206 MiB, `vito-r368-api-live` ~138 MiB. Also >30 live/private/staging containers and several independent preview services. **No container was stopped or restarted** in this pass.

## Release decision / next gates
1. **No second full VITO canary on FSN1 while A8 is blocked.** Current production login, containers and rollback assets remain intact.
2. Safely reduce resource contention using a separate dependency-aware inventory of obsolete preview stacks; **do not stop BOB/URTALI/EMPORIO/staging services blindly**, and do not run `swapoff` or `docker system prune` on this memory-starved host.
3. Run the real VITO Owner login using the regular app login and an authorized session in a private release path, not an invented production Owner token or production JWT signing key. Then validate the new endpoint's actual JWT and tenant-boundary behavior.
4. Persist only the dedicated Neon view-only account under approved FSN1 API secret management, not GitHub, shell logs or the Next.js browser.
5. Release PR #177 by a separately reviewed, atomic/reversible replacement only after A8 passes and a rollback snapshot and post-live probes are ready. PR remains DRAFT; do not confuse source tests with deployed backend functionality.

**Verdict:** `A7_SIGNED_AUTH_TEST_ONLY_19_19_PASS` · `A6_REAL_NEON_AND_SYNTHETIC_UI_PASS` · `A8_FS1_MEMORY_AND_SWAP_BLOCKED` · `PR177_DRAFT` · `LIVE_UNCHANGED`.
