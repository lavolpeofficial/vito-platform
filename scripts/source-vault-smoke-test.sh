#!/usr/bin/env bash
set -euo pipefail

# SOURCE VAULT smoke test for one XLSX source.
# Required env:
#   VITO_API_BASE_URL    e.g. https://api.example.com
#   VITO_BEARER_TOKEN    OWNER/ADMIN JWT
# Usage:
#   ./scripts/source-vault-smoke-test.sh "/path/to/file.xlsx"

FILE_PATH="${1:-}"
if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
  echo "Usage: $0 /path/to/file.xlsx" >&2
  exit 2
fi

: "${VITO_API_BASE_URL:?VITO_API_BASE_URL is required}"
: "${VITO_BEARER_TOKEN:?VITO_BEARER_TOKEN is required}"

BASE="${VITO_API_BASE_URL%/}"
AUTH=( -H "Authorization: Bearer ${VITO_BEARER_TOKEN}" )
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

LOCAL_SHA="$(sha256sum "$FILE_PATH" | awk '{print $1}')"
FILE_NAME="$(basename "$FILE_PATH")"

echo "[1/6] Upload: $FILE_NAME"
UPLOAD_JSON="$TMP_DIR/upload.json"
curl --fail-with-body -sS \
  "${AUTH[@]}" \
  -X POST "$BASE/source-vault/upload" \
  -F "file=@${FILE_PATH};type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" \
  -F "sourceType=SPREADSHEET" \
  -F "ingestedBy=smoke-test" \
  -F "projectKey=KI-CONSULTANT" \
  -F "domain=consulting" \
  -F "language=de" \
  -F "confidentiality=INTERNAL" \
  -F "rightsStatus=LICENSED" \
  > "$UPLOAD_JSON"

SOURCE_PK="$(node -e "const x=require(process.argv[1]); console.log(x.source?.id ?? x.sourceId ?? '')" "$UPLOAD_JSON")"
REMOTE_SHA="$(node -e "const x=require(process.argv[1]); console.log(x.source?.sha256 ?? x.sha256 ?? '')" "$UPLOAD_JSON")"

if [[ -z "$SOURCE_PK" ]]; then
  echo "Upload response did not expose a source primary key:" >&2
  cat "$UPLOAD_JSON" >&2
  exit 1
fi

if [[ "$REMOTE_SHA" != "$LOCAL_SHA" ]]; then
  echo "SHA mismatch after upload: local=$LOCAL_SHA remote=$REMOTE_SHA" >&2
  exit 1
fi

echo "[2/6] Exact duplicate check"
DUP_JSON="$TMP_DIR/duplicate.json"
curl --fail-with-body -sS "${AUTH[@]}" \
  "$BASE/source-vault/duplicates/$LOCAL_SHA" > "$DUP_JSON"
node -e "const x=require(process.argv[1]); if(!x.duplicate) process.exit(1)" "$DUP_JSON"

echo "[3/6] Download original + integrity check"
DOWNLOADED="$TMP_DIR/original.xlsx"
curl --fail-with-body -sS "${AUTH[@]}" \
  "$BASE/source-vault/sources/$SOURCE_PK/content" -o "$DOWNLOADED"
DOWN_SHA="$(sha256sum "$DOWNLOADED" | awk '{print $1}')"
if [[ "$DOWN_SHA" != "$LOCAL_SHA" ]]; then
  echo "SHA mismatch after download: local=$LOCAL_SHA downloaded=$DOWN_SHA" >&2
  exit 1
fi

echo "[4/6] XLSX extraction"
EXTRACT_JSON="$TMP_DIR/extract.json"
curl --fail-with-body -sS "${AUTH[@]}" \
  -X POST "$BASE/source-vault/sources/$SOURCE_PK/extract/xlsx" > "$EXTRACT_JSON"
node - <<'NODE' "$EXTRACT_JSON"
const x = require(process.argv[2]);
if (!x.extraction || x.status !== 'EXTRACTED') {
  console.error(x);
  process.exit(1);
}
console.log(`  sheets=${x.extraction.totals.sheets} cells=${x.extraction.totals.cells} formulas=${x.extraction.totals.formulas}`);
NODE

echo "[5/6] Re-upload must not create a second original"
REUPLOAD_JSON="$TMP_DIR/reupload.json"
curl --fail-with-body -sS \
  "${AUTH[@]}" \
  -X POST "$BASE/source-vault/upload" \
  -F "file=@${FILE_PATH};type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" \
  -F "sourceType=SPREADSHEET" \
  -F "ingestedBy=smoke-test" \
  -F "projectKey=KI-CONSULTANT" \
  -F "domain=consulting" \
  -F "language=de" \
  -F "confidentiality=INTERNAL" \
  -F "rightsStatus=LICENSED" \
  > "$REUPLOAD_JSON"
node -e "const x=require(process.argv[1]); if(!x.duplicate) { console.error(x); process.exit(1); }" "$REUPLOAD_JSON"

echo "[6/6] PASS"
echo "sourcePk=$SOURCE_PK"
echo "sha256=$LOCAL_SHA"
