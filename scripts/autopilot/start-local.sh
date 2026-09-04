#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env.autopilot.local"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${VITO_WORKER_TOKEN:?run scripts/autopilot/setup-local-secrets.sh or export VITO_WORKER_TOKEN first}"
: "${N8N_ENCRYPTION_KEY:?run scripts/autopilot/setup-local-secrets.sh or export N8N_ENCRYPTION_KEY first}"

export VITO_WORKER_PORT="${VITO_WORKER_PORT:-8081}"
export VITO_WORKER_DEFAULT_TIMEOUT_MS="${VITO_WORKER_DEFAULT_TIMEOUT_MS:-120000}"

mkdir -p .tmp/autopilot

if [[ -f .tmp/autopilot/worker.pid ]] && kill -0 "$(cat .tmp/autopilot/worker.pid)" 2>/dev/null; then
  echo "controlled worker already running pid=$(cat .tmp/autopilot/worker.pid)"
else
  nohup node tools/engineering-worker/server.mjs \
    > .tmp/autopilot/worker.log 2>&1 &
  echo $! > .tmp/autopilot/worker.pid
fi

worker_ready=false
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${VITO_WORKER_PORT}/health" >/dev/null 2>&1; then
    worker_ready=true
    break
  fi
  sleep 0.5
done

if [[ "$worker_ready" != "true" ]]; then
  echo "controlled worker did not become ready" >&2
  tail -100 .tmp/autopilot/worker.log >&2 || true
  exit 1
fi

curl -fsS "http://127.0.0.1:${VITO_WORKER_PORT}/health" | python3 -m json.tool

docker compose -f infra/n8n/docker-compose.autopilot.yml up -d

echo "Waiting for n8n readiness on 127.0.0.1:5678 ..."
n8n_ready=false
for _ in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:5678/healthz >/dev/null 2>&1 || \
     curl -fsS http://127.0.0.1:5678/ >/dev/null 2>&1; then
    n8n_ready=true
    break
  fi

  if ! docker ps --format '{{.Names}}' | grep -qx 'vito-n8n'; then
    echo "vito-n8n stopped before becoming ready" >&2
    docker logs --tail 150 vito-n8n >&2 || true
    exit 1
  fi

  sleep 1
done

if [[ "$n8n_ready" != "true" ]]; then
  echo "n8n did not become ready within 180 seconds" >&2
  docker logs --tail 200 vito-n8n >&2 || true
  exit 1
fi

echo
echo "Autopilot execution plane READY"
echo "n8n:    http://127.0.0.1:5678"
echo "worker: http://127.0.0.1:${VITO_WORKER_PORT}/health"
echo "log:    $ROOT/.tmp/autopilot/worker.log"
