# Local Verification Runbook

Use this runbook after changes to application bootstrap, authentication guards, tenant context, Docker configuration or health handling.

## 1. Install and generate

```bash
pnpm install
pnpm prisma:generate
```

## 2. Start the stack

```bash
docker compose up -d --build
```

## 3. Inspect container state

```bash
docker compose ps
```

Both PostgreSQL and the API should be running. If the API restarts or exits, inspect:

```bash
docker compose logs --tail=200 api
```

## 4. Run the smoke test

```bash
bash scripts/smoke-test.sh
```

Expected result:

```text
OK: VITO API health check passed at http://localhost:3000/health
```

The response body must contain:

```json
{
  "status": "ok",
  "service": "vito-api",
  "timestamp": "..."
}
```

Custom endpoint:

```bash
BASE_URL=http://localhost:3001 bash scripts/smoke-test.sh
```

## 5. Build and tests

```bash
pnpm build
pnpm test
pnpm test:e2e
```

The E2E test suite requires a reachable PostgreSQL database and the environment variables documented in `.env.example`.

## 6. Failure interpretation

- `HTTP 000`: the API is not reachable or still starting.
- `HTTP 500`: inspect API logs for bootstrap, dependency-injection or database errors.
- `HTTP 200` with unexpected body: the health contract changed or the endpoint is being intercepted.
- repeated container restarts: inspect Docker logs and validate environment variables.

## 7. Security reminder

Do not enable `ALLOW_INSECURE_TENANT_HEADER` in production. Health is intentionally public; all protected routes must remain governed by JWT authentication and tenant-scoped authorization.
