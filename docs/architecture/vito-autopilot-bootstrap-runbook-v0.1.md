# VITO Engineering Autopilot Bootstrap Runbook v0.1

## Status

Phase A bootstrap scaffold implemented on `feature/vito-eo-01-governed-runtime-v0.1`.

This runbook deliberately stops before productive builder/reviewer adapters. Issue #11 (Execution Policy & Sandbox) states that no productive provider adapter may execute before the sandbox/policy block is approved.

## Implemented now

- localhost-only controlled engineering worker on port 8081
- bearer-authenticated typed `POST /execute`
- static repository registry
- actions: `GIT_INSPECT`, `RUN_BUILD`, `RUN_TESTS`, `RUN_PRISMA_GENERATE`
- arbitrary actions fail closed with `POLICY_BLOCKED`
- subprocesses use `shell: false`
- explicit minimal environment; no inherited HOME
- timeout and process-group termination
- stdout/stderr size cap
- immutable-on-first-write stdout/stderr artifacts with SHA-256
- execution-id idempotency in worker process
- self-hosted n8n compose on localhost port 5678 using Linux host networking
- importable `VITO_ENGINEERING_BOOTSTRAP_V1` n8n workflow
- local bootstrap/import/smoke-test scripts

## Intentionally not enabled yet

- `INVOKE_BUILDER`
- `INVOKE_REVIEWER`
- arbitrary shell
- git commit/push/merge/delete
- secrets in prompt context
- semantic correction-loop authority in n8n

These remain blocked until EO-01.3/EO-01.4 governance is in place.

## Local bootstrap

From the runtime worktree:

```bash
cd /home/alessandro/Downloads/vito-platform_eo01_runtime
git pull --ff-only

export VITO_WORKER_TOKEN="$(openssl rand -hex 32)"
export N8N_ENCRYPTION_KEY="$(openssl rand -hex 32)"

bash scripts/autopilot/start-local.sh
bash scripts/autopilot/smoke-test.sh
bash scripts/autopilot/import-workflows.sh
```

Then open `http://127.0.0.1:5678`, inspect `VITO_ENGINEERING_BOOTSTRAP_V1`, and activate it manually after confirming its HTTP Request nodes point only to the controlled worker.

## Expected smoke-test invariants

1. `/health` returns `ok`.
2. authenticated `GIT_INSPECT` succeeds for `vito-platform`.
3. action `GIT_PUSH` returns HTTP 403 / `POLICY_BLOCKED`.
4. worker creates `.vito-artifacts/<executionId>/stdout.txt` and `stderr.txt` with SHA-256 references.
5. n8n never receives unrestricted shell access.

## Next implementation sequence

1. EO-01.3 Provider Registry & Capability Router.
2. EO-01.4 Execution Policy & Sandbox.
3. Only after EO-01.4 gate: builder/reviewer provider adapters.
4. Connect n8n to VITO provider routing instead of provider names.
5. Add immutable review-package action.
6. Add structured verdict parser and correction loop.
7. Stop at Human Release Gate.

## Important bootstrap caveat

The worker v0.1 execution-id cache is in-memory and therefore process-local. Durable execution idempotency belongs in the VITO runtime / AgentExecution persistence in later EO blocks. Until then, the worker is a build-phase harness, not a durable production execution service.
