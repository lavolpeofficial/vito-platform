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

if command -v curl >/dev/null 2>&1; then
  HTTP_CODE="$(curl -sS -o /tmp/urtali-partner-review-check.$$ -w '%{http_code}' --max-time 2 http://127.0.0.1:3002/review 2>/dev/null || true)"
  if [[ "$HTTP_CODE" == "200" ]] && grep -q "Review Checklist" /tmp/urtali-partner-review-check.$$ 2>/dev/null; then
    rm -f /tmp/urtali-partner-review-check.$$
    echo "PARTNER_PORTAL_REVIEW=ALREADY_RUNNING"
    echo "HOT_RELOAD=AVAILABLE"
    echo "OPEN=http://127.0.0.1:3002/"
    exit 0
  fi
  rm -f /tmp/urtali-partner-review-check.$$
fi

if command -v ss >/dev/null 2>&1 && ss -ltn 'sport = :3002' 2>/dev/null | grep -q LISTEN; then
  echo "PARTNER_PORTAL_REVIEW=BLOCKED REASON=PORT_3002_IN_USE_BY_OTHER_PROCESS" >&2
  ss -ltnp 'sport = :3002' 2>/dev/null || true
  exit 1
fi

exec pnpm --filter @vito/partner-portal dev
