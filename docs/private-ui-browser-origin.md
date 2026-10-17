# Private Control Center browser origin

Status: reviewed-code candidate; no live deployment or browser acceptance implied.

## Finding

The Control Center already supports `VITO_CONTROL_CENTER_PUBLIC_ORIGIN` in
`lib/auth/request.ts`. Browser origin and internal API transport are distinct.
Keep `VITO_API_BASE_URL` pointed directly at the private API and configure the
explicit browser origin on the UI process. A second gateway is unnecessary for
an SSH-only UI tunnel.

If a gateway is used, its API routes must include the session dependencies:
`lib/auth/session.ts` reads `/users/:id` and `/organizations/:id`. The UI login
route also reads `/organizations/:id`. Routing these to the UI instead of the
API prevents session validation and can lead to redirects to login.

## Private operator configuration

Example loopback browser origin: `http://localhost:34122`.
Set this exact origin as `VITO_CONTROL_CENTER_PUBLIC_ORIGIN` for the UI process.
Keep the existing direct `VITO_API_BASE_URL` and production cookie policy.
Before changing configuration, verify the deployed auth source and build support
the public-origin variable, confirm private loopback listeners, and record the
current configuration for rollback. Server addresses, deployment paths, account
identifiers and secret-file paths belong in private operator configuration,
not this public repository.

Restart only the private UI after applying the reviewed configuration. Leave
public services, scheduler activation, providers and database contents outside
the change. Revert the configuration and verify UI health if any gate fails.

## HTTP acceptance probe

`scripts/staging/riccardo-browser-smoke.mjs` requires these operator-supplied
environment variables; none should be committed with private values:

- `VITO_SMOKE_PASSWORD_FILE`: existing private staging password file.
- `VITO_SMOKE_ORGANIZATION`: dedicated staging organization slug.
- `VITO_SMOKE_EMAIL`: dedicated staging owner account.
- `VITO_SMOKE_ORIGIN`: optional; defaults to `http://localhost:34122`.
- `VITO_SMOKE_TRANSPORT`: optional; defaults to `http://127.0.0.1:34122`.

The CLI accepts only HTTP loopback origins and transports. With the private
configuration supplied by the operator, run:

```bash
node scripts/staging/riccardo-browser-smoke.mjs
```

It tests foreign-origin rejection, anonymous session denial, anonymous activity
redirect, UI `/api/auth/login`, the actual issued cookie and security attributes,
authenticated `/api/auth/session`, identity continuity and activity SSR containing
the synthetic staging marker `STAGING TEST`. Use only the dedicated staging
fixture, with workers/providers already disabled. No fixture is created by this
probe. Login may cause normal application audit effects.

Passwords, cookies and response bodies are never logged. The probe uses the
cookie issued by the UI instead of manufacturing one from a backend JWT.
It deliberately replays that cookie, so it does not prove browser acceptance of
`Secure; __Host-` cookies on local HTTP. Confirm login and reload in the actual
browser using the exact configured hostname and port. If browser cookie policy
blocks this, use a reviewed local HTTPS approach; never strip cookie protections.

## Tests

```bash
node --check scripts/staging/riccardo-browser-smoke.mjs
node --experimental-strip-types --test apps/control-center/tests/auth.test.ts apps/control-center/tests/riccardo-browser-smoke.test.ts
```

Synthetic tests cover configured and native origin acceptance, rejection of other
origins despite spoofed forwarded headers, UI-cookie reuse, insecure-cookie
rejection, session identity mismatch and authenticated HTTP 307 failures.
These establish local regression coverage, not remote runtime health.

No auth policy, tenant contract, application code or production deployment is
changed by this commit. Runtime deployment remains a separate reviewed step.
