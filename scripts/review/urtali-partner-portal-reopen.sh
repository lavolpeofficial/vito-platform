#!/usr/bin/env bash
set -Eeuo pipefail

PORT=3002
HOST=127.0.0.1
URL="http://$HOST:$PORT/"
REVIEW_URL="${URL}review"
LOG="${TMPDIR:-/tmp}/urtali-partner-portal-review.log"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "PARTNER_PORTAL_ACCESS=BLOCKED REASON=NOT_IN_GIT_REPOSITORY" >&2
  exit 1
}
cd "$ROOT"

if [[ ! -f apps/partner-portal/package.json ]]; then
  echo "PARTNER_PORTAL_ACCESS=BLOCKED REASON=PORTAL_SOURCE_MISSING" >&2
  exit 1
fi

if curl -fsS --max-time 2 "$REVIEW_URL" >/dev/null 2>&1; then
  echo "PARTNER_PORTAL_ACCESS=READY"
  echo "OPEN=$URL"
  exit 0
fi

PID="$(ss -ltnp "sport = :$PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1 || true)"
if [[ -n "$PID" ]]; then
  CMD="$(ps -p "$PID" -o args= 2>/dev/null || true)"
  if [[ "$CMD" == *next* || "$CMD" == *partner-portal* || "$CMD" == *node* ]]; then
    kill "$PID" 2>/dev/null || true
    sleep 2
  else
    echo "PARTNER_PORTAL_ACCESS=BLOCKED REASON=PORT_${PORT}_IN_USE PID=$PID" >&2
    echo "PROCESS=$CMD" >&2
    exit 1
  fi
fi

nohup pnpm --filter @vito/partner-portal dev >"$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "$REVIEW_URL" >/dev/null 2>&1; then
    echo "PARTNER_PORTAL_ACCESS=READY"
    echo "SERVER_PID=$SERVER_PID"
    echo "OPEN=$URL"
    echo "REVIEW=$REVIEW_URL"
    echo "LOG=$LOG"
    exit 0
  fi
  sleep 1
done

echo "PARTNER_PORTAL_ACCESS=BLOCKED REASON=START_TIMEOUT" >&2
echo "LOG=$LOG" >&2
tail -40 "$LOG" >&2 || true
exit 1
