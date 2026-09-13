#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/deploy/staging/docker-compose.yml"
ENV_FILE="${VITO_STAGING_ENV_FILE:-$ROOT_DIR/deploy/staging/.env}"

: "${VITO_OWNER_EMAIL:?VITO_OWNER_EMAIL is required}"
: "${VITO_OWNER_PASSWORD:?VITO_OWNER_PASSWORD is required}"

if (( ${#VITO_OWNER_PASSWORD} < 12 )); then
  echo 'ERROR: VITO_OWNER_PASSWORD must contain at least 12 characters.' >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: staging env file not found: $ENV_FILE" >&2
  exit 2
fi

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

curl --fail --silent --show-error http://127.0.0.1:33000/health >/dev/null

export SEED_OWNER_EMAIL="$VITO_OWNER_EMAIL"
export SEED_OWNER_PASSWORD="$VITO_OWNER_PASSWORD"
"${compose[@]}" exec -T \
  -e SEED_OWNER_EMAIL \
  -e SEED_OWNER_PASSWORD \
  api pnpm prisma:seed >/dev/null

VITO_BASE_URL="${VITO_BASE_URL:-http://127.0.0.1:33000}" \
VITO_ORGANIZATION_SLUG="${VITO_ORGANIZATION_SLUG:-aterima}" \
node "$ROOT_DIR/scripts/staging/auth-smoke.mjs"
