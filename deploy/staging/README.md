# VITO staging runtime

This stack is the first server-side VITO runtime baseline. It is intentionally **not** a public or production deployment.

## Security boundary

- API and Control Center bind to `127.0.0.1` only.
- PostgreSQL has no host port.
- The Docker network is internal.
- Swagger is disabled.
- Insecure tenant headers are disabled.
- Operator Bridge remains `internal`.
- No server credentials are configured.
- No repositories or trusted local executables are authorized.
- Bubblewrap is required for governed execution.
- Human Release remains an application-level explicit human boundary.

The stack therefore provides runtime health, database migrations, authentication/application surfaces and Control Center connectivity without silently enabling coding-agent execution.

## Host preparation

Create a dedicated checkout outside the GitHub Actions runner workspace. Do not deploy from `_work`.

Create `deploy/staging/.env` from `.env.example` and populate independent high-entropy values for `VITO_STAGING_DB_PASSWORD` and `VITO_STAGING_JWT_SECRET`.

## Start

```bash
docker compose --env-file deploy/staging/.env -f deploy/staging/docker-compose.yml up -d --build
```

The stack applies the committed Prisma migration chain before starting the API. It never uses `prisma db push`.

## Verify

```bash
curl --fail http://127.0.0.1:33000/health
docker compose --env-file deploy/staging/.env -f deploy/staging/docker-compose.yml ps
```

The Control Center is available only on the host loopback interface at `http://127.0.0.1:33001` until an explicit ingress decision is approved.

## Stop

```bash
docker compose --env-file deploy/staging/.env -f deploy/staging/docker-compose.yml down
```

Do not add `--volumes` unless the staging data is explicitly intended to be destroyed.
