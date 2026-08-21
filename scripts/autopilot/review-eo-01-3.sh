#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

EXPECTED_BRANCH="feature/vito-eo-01-governed-runtime-v0.1"
REVIEW_DIR="/tmp/vito-eo-01-3-review"
REPORT="$ROOT/.tmp/autopilot/eo-01-3-nemotron-review.txt"
SPEC="$ROOT/docs/architecture/vito-eo-01-3-builder-prompt.md"
CORRECTION="$ROOT/docs/architecture/vito-eo-01-3-correction-02.md"

mkdir -p "$ROOT/.tmp/autopilot"

branch="$(git branch --show-current)"
if [[ "$branch" != "$EXPECTED_BRANCH" ]]; then
  echo "Refusing EO-01.3 review on branch '$branch'; expected '$EXPECTED_BRANCH'" >&2
  exit 1
fi

command -v opencode >/dev/null 2>&1 || { echo "opencode not found" >&2; exit 1; }
command -v rsync >/dev/null 2>&1 || { echo "rsync not found" >&2; exit 1; }
[[ -f "$SPEC" ]] || { echo "builder spec missing: $SPEC" >&2; exit 1; }
[[ -f "$CORRECTION" ]] || { echo "correction scope missing: $CORRECTION" >&2; exit 1; }

# Trusted verification is authoritative. Reviewer may inspect/run additional checks,
# but a failed ad-hoc reviewer command must not override these results by itself.
echo "===== TRUSTED VERIFICATION ====="
pnpm prisma:generate
pnpm --filter @vito/contracts test
pnpm --filter @vito/api test
pnpm build

rm -rf "$REVIEW_DIR"
mkdir -p "$REVIEW_DIR/repo"
rm -f "$REPORT"

cp "$SPEC" "$REVIEW_DIR/builder-spec.md"
cp "$CORRECTION" "$REVIEW_DIR/correction-02.md"
git status --short > "$REVIEW_DIR/status.txt"
git diff > "$REVIEW_DIR/tracked.patch"
git diff --stat > "$REVIEW_DIR/diff-stat.txt"
find prisma/migrations -maxdepth 2 -type f -name 'migration.sql' -print | sort > "$REVIEW_DIR/migrations-list.txt"

# Snapshot the actual working tree exactly once. This avoids the previous nested
# engineering/engineering package bug and includes package manifests/config.
rsync -a \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='apps/api/node_modules/' \
  --exclude='packages/contracts/node_modules/' \
  --exclude='.tmp/' \
  --exclude='.vito-artifacts/' \
  --exclude='.env' \
  --exclude='.env.*' \
  "$ROOT/" "$REVIEW_DIR/repo/"

{
  echo "VITO EO-01.3 INDEPENDENT RE-REVIEW PACKAGE"
  echo "branch=$branch"
  echo "base=$(git rev-parse HEAD)"
  echo "verification=contracts 63/63 PASS; api 146/146 PASS; build PASS"
  echo "correction=02 validated"
  echo "commit=NOT CREATED BY REVIEW HARNESS"
  echo "push=NOT PERFORMED BY REVIEW HARNESS"
} > "$REVIEW_DIR/manifest.txt"

cat > "$REVIEW_DIR/review-prompt.txt" <<'EOF'
You are the independent red-team reviewer for VITO-EO-01.3 Provider Registry + Capability Router after Correction 02.

Review strictly against:
- builder-spec.md
- correction-02.md
- the isolated repo/ snapshot
- tracked.patch, status.txt, migrations-list.txt and manifest.txt

Trusted verification already passed before packaging:
- contracts: 63/63 PASS
- API: 146/146 PASS
- build: PASS
Do not treat a failed ad-hoc test command of your own as evidence that these trusted results failed unless you identify an actual implementation defect.

Approved interpretation boundaries from Correction 02:
1. Previous reviewer provider/model-family exclusion constraints are intentionally part of EO-01.3 routing independence support. Do NOT flag their existence as a redefinition of EO-01.1 AL4 governance unless the router itself invents verdict/approval semantics.
2. AVAILABILITY and QUOTA may be separate internal phases as long as both occur before assurance, independence, budget and scoring.
3. ProviderStatus.DEGRADED is intentionally non-routable in v0.1; ProviderHealthStatus.DEGRADED may remain routable with a score penalty.
4. ProviderQuotaStatus.LIMITED may remain routable; EXHAUSTED is ineligible; UNKNOWN may fail closed.
5. Real-DB/testcontainers integration is not a mandatory EO-01.3 acceptance criterion by itself.

Primary review goals:
1. Verify every mandatory EO-01.3 requirement is actually implemented.
2. Verify ProviderCapability is durable, tenant-scoped, unique per provider/capability and requires isEnabled=true for eligibility.
3. Verify legacy supportedCapabilities JSON cannot grant or override routing eligibility.
4. Verify eligibility ordering: capability -> status -> availability/quota -> assurance -> independence -> budget -> score.
5. Verify an ineligible provider can never win due to score.
6. Verify deterministic tie-breaking.
7. Verify actual budget eligibility uses estimatedCostMinorUnits, never normalized costScore.
8. Verify maxCostMinorUnits + unknown estimated cost fails closed with COST_UNKNOWN.
9. Verify fallback when Anthropic/Claude is unavailable/quota-blocked and no-eligible-provider fail-closed behavior.
10. Verify tenant isolation, persistence and audit explainability.
11. Verify schema/migration safety and that no secrets/prompts are persisted.
12. Verify no productive provider execution, n8n provider branching, generic policy language, ML routing, billing, commit/push/merge automation, or EO-01.4 sandbox implementation was introduced.
13. Look for tests that appear to prove an invariant but do not actually enforce it.
14. Treat missing material evidence as a finding, but distinguish material blockers from optional hardening.
15. Do not modify files. Do not commit or push.

Verdict semantics:
A = PASS, no material findings
B = PASS with non-blocking findings
C = FAIL, correction required
D = HUMAN DECISION REQUIRED

Return exactly:

VITO-EO-01.3 RED TEAM REVIEW

Verdict: A|B|C|D

Blocking findings:
- ...

Non-blocking findings:
- ...

Evidence:
- ...

Required corrections:
- ...

Gate:
OPEN|CLOSED|HUMAN_DECISION
EOF

echo "===== NEMOTRON RED TEAM RE-REVIEW ====="
set +e
opencode run \
  "$(cat "$REVIEW_DIR/review-prompt.txt")" \
  --pure \
  --model=opencode/nemotron-3-ultra-free \
  --title="VITO EO-01.3 Correction 02 Independent Re-Review" \
  --dir="$REVIEW_DIR" \
  --print-logs \
  --log-level INFO \
  2>&1 | tee "$REPORT"
review_rc=${PIPESTATUS[0]}
set -e

if [[ $review_rc -ne 0 ]]; then
  echo "Nemotron review exited non-zero: $review_rc" >&2
  exit $review_rc
fi

if [[ ! -s "$REPORT" ]]; then
  echo "FAIL: Nemotron review report is empty" >&2
  exit 2
fi

# Require a structured verdict and gate somewhere in the emitted output.
if ! grep -Eq 'Verdict:[[:space:]]*[ABCD]' "$REPORT"; then
  echo "FAIL: structured Verdict A/B/C/D not found in review output" >&2
  exit 3
fi
if ! grep -Eq 'Gate:[[:space:]]*(OPEN|CLOSED|HUMAN_DECISION)' "$REPORT"; then
  echo "FAIL: structured Gate not found in review output" >&2
  exit 4
fi

echo
echo "===== EXTRACTED REVIEW DECISION ====="
grep -E 'Verdict:[[:space:]]*[ABCD]|Gate:[[:space:]]*(OPEN|CLOSED|HUMAN_DECISION)' "$REPORT" | tail -4

echo
echo "Review complete: $REPORT"
echo "No commit/push was performed by this harness."
