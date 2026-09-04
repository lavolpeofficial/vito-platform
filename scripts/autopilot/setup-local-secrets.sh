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

read_container_env() {
  local key="$1"
  if docker inspect vito-n8n >/dev/null 2>&1; then
    docker inspect vito-n8n \
      --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | sed -n "s/^${key}=//p" \
      | head -1
  fi
}

VITO_WORKER_TOKEN="$(read_container_env VITO_WORKER_TOKEN || true)"
N8N_ENCRYPTION_KEY="$(read_container_env N8N_ENCRYPTION_KEY || true)"

source_mode="recovered from existing vito-n8n container"

if [[ -z "$VITO_WORKER_TOKEN" ]]; then
  VITO_WORKER_TOKEN="$(openssl rand -hex 32)"
  source_mode="generated locally (no existing worker token found)"
fi

if [[ -z "$N8N_ENCRYPTION_KEY" ]]; then
  N8N_ENCRYPTION_KEY="$(openssl rand -hex 32)"
  source_mode="generated locally (no existing n8n encryption key found)"
fi

cat > "$ENV_FILE" <<EOF
VITO_WORKER_TOKEN=$VITO_WORKER_TOKEN
N8N_ENCRYPTION_KEY=$N8N_ENCRYPTION_KEY
EOF

chmod 600 "$ENV_FILE"

echo "Created local autopilot secret file: $ENV_FILE"
echo "Permissions: $(stat -c '%a' "$ENV_FILE")"
echo "Secret source: $source_mode"
echo "Secrets were not printed."
