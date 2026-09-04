#!/usr/bin/env bash
set -euo pipefail

: "${VITO_WORKER_TOKEN:?export VITO_WORKER_TOKEN first}"

BASE="${VITO_WORKER_URL:-http://127.0.0.1:8081}"

curl -fsS "$BASE/health" | python3 -m json.tool

echo
curl -fsS \
  -H "Authorization: Bearer $VITO_WORKER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "executionId":"smoke-git-inspect",
    "repositoryId":"vito-platform",
    "action":"GIT_INSPECT",
    "timeoutMs":30000,
    "policyVersion":"worker-v0.1"
  }' \
  "$BASE/execute" | python3 -m json.tool

echo
set +e
DENIED=$(curl -sS -w '\n%{http_code}' \
  -H "Authorization: Bearer $VITO_WORKER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "executionId":"smoke-denied",
    "repositoryId":"vito-platform",
    "action":"GIT_PUSH",
    "timeoutMs":30000,
    "policyVersion":"worker-v0.1"
  }' \
  "$BASE/execute")
set -e
HTTP_CODE=$(printf '%s\n' "$DENIED" | tail -1)
BODY=$(printf '%s\n' "$DENIED" | sed '$d')
printf '%s\n' "$BODY" | python3 -m json.tool
[[ "$HTTP_CODE" == "403" ]] || { echo "expected 403 for denied action, got $HTTP_CODE" >&2; exit 1; }

echo 'Smoke test PASS: health, allowed GIT_INSPECT, denied GIT_PUSH.'
