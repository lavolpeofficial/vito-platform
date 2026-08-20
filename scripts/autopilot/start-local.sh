#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${VITO_WORKER_TOKEN:?export VITO_WORKER_TOKEN first}"
: "${N8N_ENCRYPTION_KEY:?export N8N_ENCRYPTION_KEY first}"

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

for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:${VITO_WORKER_PORT}/health >/dev/null; then
    break
  fi
  sleep 0.5
done

curl -fsS http://127.0.0.1:${VITO_WORKER_PORT}/health | python3 -m json.tool

docker compose -f infra/n8n/docker-compose.autopilot.yml up -d

echo
echo "Autopilot execution plane started"
echo "n8n:    http://127.0.0.1:5678"
echo "worker: http://127.0.0.1:${VITO_WORKER_PORT}/health"
echo "log:    $ROOT/.tmp/autopilot/worker.log"
