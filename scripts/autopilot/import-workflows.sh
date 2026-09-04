#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! docker ps --format '{{.Names}}' | grep -qx 'vito-n8n'; then
  echo 'vito-n8n is not running' >&2
  exit 1
fi

echo 'Waiting for n8n readiness before import ...'
n8n_ready=false
for _ in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:5678/healthz >/dev/null 2>&1 || \
     curl -fsS http://127.0.0.1:5678/ >/dev/null 2>&1; then
    n8n_ready=true
    break
  fi

  if ! docker ps --format '{{.Names}}' | grep -qx 'vito-n8n'; then
    echo 'vito-n8n stopped before becoming ready' >&2
    docker logs --tail 150 vito-n8n >&2 || true
    exit 1
  fi

  sleep 1
done

if [[ "$n8n_ready" != "true" ]]; then
  echo 'n8n did not become ready within 180 seconds; refusing workflow import' >&2
  docker logs --tail 200 vito-n8n >&2 || true
  exit 1
fi

docker exec vito-n8n n8n import:workflow \
  --input=/opt/vito/workflows/vito-engineering-bootstrap-v1.json

echo 'Imported VITO_ENGINEERING_BOOTSTRAP_V1.'
echo 'Open http://127.0.0.1:5678, inspect the workflow, then activate it manually.'
