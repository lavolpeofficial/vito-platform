#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! docker ps --format '{{.Names}}' | grep -qx 'vito-n8n'; then
  echo 'vito-n8n is not running' >&2
  exit 1
fi

docker exec vito-n8n n8n import:workflow \
  --input=/opt/vito/workflows/vito-engineering-bootstrap-v1.json

echo 'Imported VITO_ENGINEERING_BOOTSTRAP_V1.'
echo 'Open http://127.0.0.1:5678, inspect the workflow, then activate it manually.'
