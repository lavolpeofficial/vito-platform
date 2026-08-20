#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

EXPECTED_BRANCH="feature/vito-eo-01-governed-runtime-v0.1"
REVIEW_DIR="/tmp/vito-eo-01-3-review"
REPORT="$ROOT/.tmp/autopilot/eo-01-3-nemotron-review.txt"
SPEC="$ROOT/docs/architecture/vito-eo-01-3-builder-prompt.md"

mkdir -p "$ROOT/.tmp/autopilot"

branch="$(git branch --show-current)"
if [[ "$branch" != "$EXPECTED_BRANCH" ]]; then
  echo "Refusing EO-01.3 review on branch '$branch'; expected '$EXPECTED_BRANCH'" >&2
  exit 1
fi

command -v opencode >/dev/null 2>&1 || {
  echo "opencode not found" >&2
  exit 1
}

[[ -f "$SPEC" ]] || {
  echo "builder spec missing: $SPEC" >&2
  exit 1
}

echo "===== TRUSTED VERIFICATION ====="
pnpm prisma:generate
pnpm --filter @vito/contracts test
pnpm --filter @vito/api test
pnpm build

rm -rf "$REVIEW_DIR"
mkdir -p "$REVIEW_DIR/repo"

cp "$SPEC" "$REVIEW_DIR/builder-spec.md"
git status --short > "$REVIEW_DIR/status.txt"
git diff > "$REVIEW_DIR/tracked.patch"
git diff --stat > "$REVIEW_DIR/diff-stat.txt"

# Copy all untracked implementation files while preserving paths.
while IFS= read -r f; do
  mkdir -p "$REVIEW_DIR/repo/$(dirname "$f")"
  cp "$f" "$REVIEW_DIR/repo/$f"
done < <(git ls-files --others --exclude-standard)

# Copy full context needed to review EO-01.3 without giving the reviewer the live worktree.
for path in \
  packages/contracts/src/engineering \
  apps/api/src/modules/workflow-runtime \
  apps/api/src/modules/capabilities \
  apps/api/src/modules/audit; do
  if [[ -e "$path" ]]; then
    mkdir -p "$REVIEW_DIR/repo/$(dirname "$path")"
    cp -a "$path" "$REVIEW_DIR/repo/$path"
  fi
done

cp prisma/schema.prisma "$REVIEW_DIR/repo/prisma-schema.prisma"
find prisma/migrations -maxdepth 2 -type f -name 'migration.sql' -print | sort > "$REVIEW_DIR/migrations-list.txt"

{
  echo "VITO EO-01.3 INDEPENDENT REVIEW PACKAGE"
  echo "branch=$branch"
  echo "base=$(git rev-parse HEAD)"
  echo "verification=contracts PASS; api PASS; build PASS"
  echo "commit=NOT CREATED BY REVIEW HARNESS"
  echo "push=NOT PERFORMED BY REVIEW HARNESS"
} > "$REVIEW_DIR/manifest.txt"

cat > "$REVIEW_DIR/review-prompt.txt" <<'EOF'
You are the independent red-team reviewer for VITO-EO-01.3 Provider Registry + Capability Router.

Review strictly against builder-spec.md.
The review package is isolated from the live repository. Inspect:
- builder-spec.md
- tracked.patch
- status.txt
- manifest.txt
- repo/**

Primary review goals:
1. Verify every mandatory EO-01.3 requirement is actually implemented.
2. Check capability/provider separation and ensure provider names never leak into capability taxonomy.
3. Check eligibility ordering: capability -> status -> availability/quota -> assurance -> independence -> budget -> score.
4. Prove an ineligible provider can never win due to score.
5. Check deterministic tie-breaking.
6. Check AL4/independence compatibility without redefining EO-01.1 governance semantics.
7. Check fallback when Anthropic/Claude is unavailable or quota-blocked.
8. Check no-eligible-provider fail-closed behavior.
9. Check tenant isolation, persistence and audit explainability.
10. Check schema/migration safety and that no secrets/prompts are persisted.
11. Verify no productive provider execution, n8n provider branching, generic policy language, ML routing, billing, commit/push/merge automation, or EO-01.4 sandbox implementation was introduced.
12. Look for tests that appear to prove an invariant but do not enforce it under realistic conditions.
13. Treat missing evidence as a finding.
14. Do not modify the live repository; this package is disposable.

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

echo "===== NEMOTRON RED TEAM ====="
opencode run \
  "$(cat "$REVIEW_DIR/review-prompt.txt")" \
  --pure \
  --model=opencode/nemotron-3-ultra-free \
  --title="VITO EO-01.3 Independent Red Team" \
  --dir="$REVIEW_DIR" \
  | tee "$REPORT"

echo
echo "Review complete: $REPORT"
echo "No commit/push was performed by this harness."
