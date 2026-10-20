#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "PARTNER_PORTAL_REVIEW=BLOCKED REASON=NOT_IN_GIT_REPOSITORY" >&2
  exit 1
}
cd "$ROOT"

if [[ ! -f apps/partner-portal/package.json ]]; then
  echo "PARTNER_PORTAL_REVIEW=BLOCKED REASON=PORTAL_SOURCE_MISSING" >&2
  exit 1
fi

echo "URTALI_PARTNER_PORTAL=OWNER_REVIEW"
echo "NETWORK=LOOPBACK_ONLY"
echo "AUTH0=NOT_CONNECTED API_WRITES=NONE DATABASE_MIGRATIONS=NONE"
echo "START_URL=http://127.0.0.1:3002/review"

pnpm --filter @vito/partner-portal test
exec pnpm --filter @vito/partner-portal dev
