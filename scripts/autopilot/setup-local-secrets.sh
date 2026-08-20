#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env.autopilot.local"

if [[ -f "$ENV_FILE" ]]; then
  echo "Local autopilot secrets already exist: $ENV_FILE"
  echo "Refusing to overwrite. Delete the file explicitly if rotation is intended."
  exit 0
fi

umask 077
VITO_WORKER_TOKEN="$(openssl rand -hex 32)"
N8N_ENCRYPTION_KEY="$(openssl rand -hex 32)"

cat > "$ENV_FILE" <<EOF
VITO_WORKER_TOKEN=$VITO_WORKER_TOKEN
N8N_ENCRYPTION_KEY=$N8N_ENCRYPTION_KEY
EOF

chmod 600 "$ENV_FILE"

echo "Created local autopilot secret file: $ENV_FILE"
echo "Permissions: $(stat -c '%a' "$ENV_FILE")"
echo "Secrets were generated locally and were not printed."
