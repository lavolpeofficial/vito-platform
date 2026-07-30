#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
HEALTH_URL="${BASE_URL%/}/health"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-20}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"

command -v curl >/dev/null 2>&1 || {
  echo "ERROR: curl is required." >&2
  exit 127
}

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
  http_code="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' "$HEALTH_URL" || true)"

  if [[ "$http_code" == "200" ]]; then
    if grep -q '"status"[[:space:]]*:[[:space:]]*"ok"' "$response_file" && \
       grep -q '"service"[[:space:]]*:[[:space:]]*"vito-api"' "$response_file"; then
      echo "OK: VITO API health check passed at $HEALTH_URL"
      cat "$response_file"
      echo
      exit 0
    fi

    echo "ERROR: Health endpoint returned HTTP 200 with an unexpected body:" >&2
    cat "$response_file" >&2
    echo >&2
    exit 1
  fi

  echo "Waiting for VITO API ($attempt/$MAX_ATTEMPTS, HTTP ${http_code:-unavailable})..."
  sleep "$SLEEP_SECONDS"
done

echo "ERROR: VITO API did not become healthy at $HEALTH_URL." >&2
[[ -s "$response_file" ]] && cat "$response_file" >&2
exit 1
