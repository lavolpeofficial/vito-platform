#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SPEC="$ROOT/docs/architecture/vito-eo-01-4-builder-prompt.md"
WORKDIR="/tmp/vito-eo-01-4-builder"
OUTFILE="$ROOT/.tmp/autopilot/eo-01-4-builder-output.txt"
REPORT="$ROOT/.tmp/autopilot/eo-01-4-builder-gate.txt"

mkdir -p "$ROOT/.tmp/autopilot"

fail_gate() {
  local message="$1"

  {
    echo "VITO-EO-01.4 BUILDER GATE"
    echo
    echo "Gate: CLOSED"
    echo "Reason: $message"
  } | tee "$REPORT"

  exit 10
}

echo "===== EO-01.4 BUILDER PRECHECK ====="

if [[ ! -f "$SPEC" ]]; then
  echo "FAIL: missing builder spec: $SPEC" >&2
  exit 2
fi

if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]]; then
  echo "FAIL: tracked working tree is not clean." >&2
  git -C "$ROOT" status --short
  exit 3
fi

echo "PASS: builder spec exists"
echo "PASS: tracked working tree clean"

rm -rf "$WORKDIR"

echo
echo "===== PREPARING ISOLATED GIT WORKSPACE ====="

git clone \
  --quiet \
  --no-hardlinks \
  "$ROOT" \
  "$WORKDIR"

git -C "$WORKDIR" checkout --quiet --detach HEAD

mkdir -p "$WORKDIR/docs/architecture"
cp "$SPEC" "$WORKDIR/docs/architecture/vito-eo-01-4-builder-prompt.md"

echo "PASS: isolated git workspace created"
echo "HEAD: $(git -C "$WORKDIR" rev-parse --short HEAD)"

cat > "$WORKDIR/eo-01-4-builder-task.txt" <<'PROMPT'
You are implementing VITO-EO-01.4 Execution Policy & Sandbox Contract.

Read first:
- docs/architecture/vito-eo-01-4-builder-prompt.md
- docs/architecture/vito-eo-01-sandbox-permission-matrix.md
- packages/contracts/src/engineering/permissions.ts
- packages/contracts/src/engineering/execution.ts
- packages/contracts/src/engineering/index.ts
- packages/contracts/src/index.ts

Also inspect existing EO-01.1 through EO-01.3 engineering contracts and
test conventions before modifying anything.

Implement EO-01.4 exactly within the builder specification.

Critical invariants:

1. Fail closed.
2. Provider routing eligibility is NOT execution permission.
3. Do not implement productive provider execution.
4. Do not implement EO-01.5+.
5. Builder and reviewer permissions must be materially distinct.
6. Reviewer must never receive productive source write authority.
7. Path authorization must not rely on unsafe raw-prefix matching.
8. Traversal, HOME access, secrets, unknown paths/actions/profiles/policies
   must deny.
9. Git mutation commands must deny before governed release authority.
10. Command chaining must not bypass policy.
11. Prisma changes inside an assigned builder worktree are not globally
    forbidden merely because they are under prisma/.
12. Existing secure defaults must not be weakened.
13. Policy decisions must be explainable and auditable without exposing
    secrets.
14. Add focused tests proving the security invariants.
15. Do not commit, push, merge, rebase, delete branches, or modify remotes.

MANDATORY COMPLETION REQUIREMENTS:

The implementation is NOT complete merely because one source file was
created.

Before finishing you MUST:

A. implement the complete execution-policy contract;
B. add focused execution-policy tests;
C. export the new contract through both engineering/index.ts and root index.ts;
D. run the execution-policy tests;
E. run the complete contracts test suite;
F. run TypeScript validation for contracts;
G. run relevant API tests;
H. run the API build;
I. inspect git diff/status and report all changed files;
J. explicitly state whether any required item remains incomplete.

If any mandatory completion requirement remains unfinished, DO NOT claim
completion. State clearly that the build is incomplete.

Do not stop after planning or after creating the first file.
Continue until the required implementation and validations are complete
or until an actual technical blocker prevents further work.

You may modify only the isolated repository copy.

Do not claim success unless validation actually passed.
PROMPT

rm -f "$OUTFILE" "$REPORT"

echo
echo "===== RUNNING EO-01.4 AUTONOMOUS BUILDER LOOP ====="

BUILDER_MODELS=(
  "opencode/nemotron-3-ultra-free|nemotron-ultra"
  "opencode/mimo-v2.5-free|mimo-v2.5"
  "opencode/nemotron-3.5-lightning-free|nemotron-lightning"
  "opencode/hy3-free|hy3"
)

implementation_complete() {
  [[ -s "$WORKDIR/packages/contracts/src/engineering/execution-policy.ts" ]] &&
  [[ -s "$WORKDIR/packages/contracts/src/engineering/execution-policy.spec.ts" ]] &&
  grep -q "execution-policy" \
    "$WORKDIR/packages/contracts/src/engineering/index.ts" &&
  grep -q "ExecutionProfile" \
    "$WORKDIR/packages/contracts/src/index.ts" &&
  grep -q "evaluatePolicy" \
    "$WORKDIR/packages/contracts/src/index.ts"
}

write_correction_task() {
  local attempt="$1"

  cat > "$WORKDIR/eo-01-4-correction-task.txt" <<PROMPT
You are continuing an interrupted VITO-EO-01.4 Execution Policy & Sandbox Contract implementation.

This is autonomous correction pass ${attempt}.

IMPORTANT:
The previous builder may have completed zero, some, or most of the implementation.
DO NOT restart blindly.
Inspect the CURRENT repository state first.

Read:
- docs/architecture/vito-eo-01-4-builder-prompt.md
- docs/architecture/vito-eo-01-sandbox-permission-matrix.md
- packages/contracts/src/engineering/permissions.ts
- packages/contracts/src/engineering/execution.ts
- packages/contracts/src/engineering/index.ts
- packages/contracts/src/index.ts
- any existing execution-policy implementation/tests

Then inspect:
- git status --short
- git diff
- existing tests

Your job is to FINISH EO-01.4, not merely analyze it.

Mandatory completion requirements:

1. packages/contracts/src/engineering/execution-policy.ts exists and is complete.
2. packages/contracts/src/engineering/execution-policy.spec.ts exists with meaningful security tests.
3. ExecutionProfile exists.
4. ExecutionAction exists.
5. PolicyReasonCode exists.
6. PolicyDecision exists.
7. execution-policy is exported through engineering/index.ts.
8. execution-policy is exported through packages/contracts/src/index.ts.
9. Fail-closed behavior is enforced.
10. Reviewer cannot write productive source.
11. Traversal, HOME, secrets, unknown actions/profiles/policies deny.
12. Git commit/push/merge/rebase/delete mutations deny unless governed release policy explicitly permits the specific action.
13. Shell chaining cannot bypass command classification.
14. Prisma paths inside the assigned builder worktree are not globally denied merely because they are under prisma/.
15. Policy decisions remain explainable/auditable without leaking secrets.

Do NOT implement productive provider execution.
Do NOT implement EO-01.5+.
Do NOT commit, push, merge, rebase, delete branches, or modify remotes.

Continue working until implementation is materially complete or a genuine technical blocker prevents further work.

Before finishing, inspect git status/diff and explicitly report anything incomplete.
PROMPT
}

attempt=0
builder_success=0
: > "$OUTFILE"

for entry in "${BUILDER_MODELS[@]}"; do
  attempt=$((attempt + 1))
  IFS='|' read -r model slug <<< "$entry"

  echo
  echo "===== EO-01.4 BUILD/CORRECTION PASS $attempt ====="
  echo "Model: $model"

  if [[ $attempt -eq 1 ]]; then
    task_file="$WORKDIR/eo-01-4-builder-task.txt"
    title="VITO EO-01.4 Execution Policy Builder"
  else
    write_correction_task "$attempt"
    task_file="$WORKDIR/eo-01-4-correction-task.txt"
    title="VITO EO-01.4 Execution Policy Correction $attempt"
  fi

  PASS_OUT="$ROOT/.tmp/autopilot/eo-01-4-pass-${attempt}-${slug}.txt"

  set +e
  opencode run \
    "$(cat "$task_file")" \
    --pure \
    --model="$model" \
    --title="$title" \
    --dir="$WORKDIR" \
    --print-logs \
    --log-level INFO \
    2>&1 | tee "$PASS_OUT"
  rc=${PIPESTATUS[0]}
  set -e

  cat "$PASS_OUT" >> "$OUTFILE"

  echo
  echo "Pass process exit status: $rc"

  if implementation_complete; then
    echo "PASS: minimum EO-01.4 implementation postconditions now exist."
    builder_success=1
    break
  fi

  echo "INCOMPLETE: required EO-01.4 implementation surface not complete."

  if [[ $rc -ne 0 ]]; then
    echo "Provider/model also exited non-zero; continuing with fallback."
  else
    echo "Agent exited normally but completion gate remains closed; continuing correction loop."
  fi
done

if [[ $builder_success -ne 1 ]]; then
  fail_gate "All EO-01.4 builder/correction passes exhausted without satisfying minimum implementation postconditions."
fi

echo
echo "PASS: autonomous builder loop reached minimum implementation completion."

echo
echo "===== POSTCONDITION 1: REQUIRED IMPLEMENTATION FILES ====="

REQUIRED_FILES=(
  "packages/contracts/src/engineering/execution-policy.ts"
  "packages/contracts/src/engineering/execution-policy.spec.ts"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [[ ! -s "$WORKDIR/$file" ]]; then
    fail_gate "Required implementation file missing or empty: $file"
  fi
  echo "PASS: $file"
done

echo
echo "===== POSTCONDITION 2: REQUIRED CONTRACT SURFACE ====="

POLICY_FILE="$WORKDIR/packages/contracts/src/engineering/execution-policy.ts"

REQUIRED_SYMBOLS=(
  "ExecutionProfile"
  "ExecutionAction"
  "PolicyReasonCode"
  "PolicyDecision"
)

for symbol in "${REQUIRED_SYMBOLS[@]}"; do
  if ! grep -q "$symbol" "$POLICY_FILE"; then
    fail_gate "Required EO-01.4 contract symbol missing: $symbol"
  fi
  echo "PASS: $symbol"
done

echo
echo "===== POSTCONDITION 3: PUBLIC EXPORTS ====="

if ! grep -q "execution-policy" \
  "$WORKDIR/packages/contracts/src/engineering/index.ts"; then
  fail_gate "execution-policy is not exported from engineering/index.ts"
fi

if ! grep -q "ExecutionProfile" \
  "$WORKDIR/packages/contracts/src/index.ts" ||
   ! grep -q "evaluatePolicy" \
  "$WORKDIR/packages/contracts/src/index.ts"; then
  fail_gate "EO-01.4 policy surface is not re-exported from packages/contracts/src/index.ts"
fi

echo "PASS: engineering execution-policy export"
echo "PASS: root contracts EO-01.4 surface export"

echo
echo "===== POSTCONDITION 4: MATERIAL SOURCE CHANGES ====="

CHANGE_LIST="$(
  git -C "$WORKDIR" status --short \
    | grep -v 'docs/architecture/vito-eo-01-4-builder-prompt.md' \
    | grep -v 'eo-01-4-builder-task.txt' \
    || true
)"

if [[ -z "$CHANGE_LIST" ]]; then
  fail_gate "Builder returned success but produced no material repository changes."
fi

printf '%s\n' "$CHANGE_LIST"

echo
echo "===== DEPENDENCY PREPARATION ====="

set +e
(
  cd "$WORKDIR"
  pnpm install --offline --frozen-lockfile
)
install_rc=$?
set -e

if [[ $install_rc -ne 0 ]]; then
  echo "Offline install unavailable; retrying with normal pnpm install."

  set +e
  (
    cd "$WORKDIR"
    pnpm install --frozen-lockfile
  )
  install_rc=$?
  set -e

  if [[ $install_rc -ne 0 ]]; then
    fail_gate "Dependency installation failed; validation cannot be trusted."
  fi
fi

echo "PASS: dependencies available"

echo
echo "===== VALIDATION 1: EXECUTION-POLICY TESTS ====="

set +e
(
  cd "$WORKDIR"
  pnpm --filter @vito/contracts test -- execution-policy
)
test_policy_rc=$?
set -e

if [[ $test_policy_rc -ne 0 ]]; then
  fail_gate "Execution-policy focused tests failed."
fi

echo "PASS: focused execution-policy tests"

echo
echo "===== VALIDATION 2: COMPLETE CONTRACT TEST SUITE ====="

set +e
(
  cd "$WORKDIR"
  pnpm --filter @vito/contracts test
)
contracts_rc=$?
set -e

if [[ $contracts_rc -ne 0 ]]; then
  fail_gate "Contracts test suite failed."
fi

echo "PASS: contracts test suite"

echo
echo "===== VALIDATION 3: CONTRACT TYPESCRIPT ====="

set +e
(
  cd "$WORKDIR"
  pnpm exec tsc --noEmit -p packages/contracts/tsconfig.json
)
contracts_tsc_rc=$?
set -e

if [[ $contracts_tsc_rc -ne 0 ]]; then
  fail_gate "Contracts TypeScript validation failed."
fi

echo "PASS: contracts TypeScript"

echo
echo "===== VALIDATION 4: PRISMA CLIENT GENERATION ====="

set +e
(
  cd "$WORKDIR"
  pnpm exec prisma generate --schema prisma/schema.prisma
)
prisma_generate_rc=$?
set -e

if [[ $prisma_generate_rc -ne 0 ]]; then
  fail_gate "Prisma Client generation failed."
fi

echo "PASS: Prisma Client generated"

echo
echo "===== VALIDATION 5: API TEST SUITE ====="

set +e
(
  cd "$WORKDIR"
  pnpm --filter @vito/api test
)
api_test_rc=$?
set -e

if [[ $api_test_rc -ne 0 ]]; then
  fail_gate "API test suite failed."
fi

echo "PASS: API tests"

echo
echo "===== VALIDATION 6: API BUILD ====="

set +e
(
  cd "$WORKDIR"
  pnpm --filter @vito/api build
)
api_build_rc=$?
set -e

if [[ $api_build_rc -ne 0 ]]; then
  fail_gate "API build failed."
fi

echo "PASS: API build"

echo
echo "===== SECURITY MARKER CHECK ====="

TEST_FILE="$WORKDIR/packages/contracts/src/engineering/execution-policy.spec.ts"

SECURITY_MARKERS=(
  "travers"
  "REVIEWER"
  "commit"
  "push"
  "secret"
  "HOME"
  "unknown"
  "timeout"
)

for marker in "${SECURITY_MARKERS[@]}"; do
  if ! grep -qi "$marker" "$TEST_FILE"; then
    fail_gate "Security test evidence missing marker: $marker"
  fi
  echo "PASS evidence: $marker"
done

echo
echo "===== FINAL ISOLATED DIFF ====="

git -C "$WORKDIR" status --short

echo
git -C "$WORKDIR" diff --stat

echo
echo "===== EO-01.4 BUILDER GATE ====="

{
  echo "VITO-EO-01.4 BUILDER GATE"
  echo
  echo "Gate: OPEN"
  echo "Builder process: PASS"
  echo "Required files: PASS"
  echo "Contract surface: PASS"
  echo "Public exports: PASS"
  echo "Material changes: PASS"
  echo "Focused security tests: PASS"
  echo "Contracts suite: PASS"
  echo "Contracts TypeScript: PASS"
  echo "API tests: PASS"
  echo "API build: PASS"
} | tee "$REPORT"

echo
echo "Builder output:"
echo "$OUTFILE"

echo
echo "Builder gate report:"
echo "$REPORT"

echo
echo "EO-01.4 implementation remains isolated."
echo "No changes were applied to the real repository."
echo "No push/merge/rebase/remote mutation was performed by this harness."
