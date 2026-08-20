# VITO n8n World Harvester Engineering Loop v0.1

Status: Draft first productive workflow
Workflow name: `WORLD_HARVESTER_ENGINEERING_LOOP_V1`

## Acceptance objective
Run the World Harvester Uruguay replay, analyze generated diagnostics, perform governed correction/re-review loops when needed, and stop at a Human Review Gate without Alessandro manually copying terminal commands or agent messages.

## Preconditions
- VITO EO-01.1 contracts/state machine approved
- controlled execution worker available
- aoe-knowledge-engine registered in worker repository registry
- builder and reviewer worktrees available
- provider credentials isolated from prompts/logs
- artifact root configured
- Human Gate callback/notification channel available

## Workflow stages

1. RECEIVE_TASK
   - validate EngineeringTask envelope
   - validate repository/target ref
   - obtain VITO workflowRunId/correlationId

2. BASELINE_INSPECT
   - GIT_INSPECT
   - capture branch, status, diff, HEAD
   - reject unexpected dirty/conflicting state per policy

3. BUILD_WORLD_HARVESTER_SOURCES
   - controlled RUN_BUILD profile
   - capture exit code/stdout/stderr
   - classify known unrelated build failures separately when an approved classifier rule exists

4. TARGETED_ROUTER_BUILD
   - run explicit targeted TypeScript/router build profile
   - failure -> return technical evidence to VITO

5. URUGUAY_REPLAY
   - run registered Uruguay replay profile
   - timeout and technical retries bounded

6. COLLECT_DIAGNOSTICS
   Required outputs where produced:
   - summary.json
   - provider-field-diagnostics.jsonl
   - page-validations.jsonl
   - failures.jsonl
   - run metadata

7. ARTIFACT_HASH
   - register immutable references/hashes
   - associate with workflowRunId/stepRunId/executionId

8. COMPARE_BASELINE
   - compare defined metrics against previous accepted run when available
   - preserve old/new values and delta
   - do not let n8n infer semantic PASS solely from arbitrary metric changes

9. REVIEW_PACKAGE
   - package git metadata, build/test outputs, diagnostics, metric comparison and artifact references

10. ROUTE_REVIEW
   - VITO requests RED_TEAM / CODE_REVIEW capability
   - VITO chooses provider based on policy/availability/assurance

11. REVIEW
   - invoke selected reviewer through worker/adapter
   - return structured ReviewResult

12. VITO_VERDICT_DECISION
   - A/B -> VERIFY
   - C -> CORRECTION if loop budget available
   - D -> Human Gate
   - disagreement -> Human/Arbitration Gate
   - assurance unsatisfied -> Gate CLOSED

13. CORRECTION
   - VITO creates structured correction request from blocking findings
   - route CODE_BUILD provider
   - builder modifies only builder worktree
   - return to build/test/replay/package/review
   - max semantic loops = VITO policy (initially 3)

14. VERIFY
   - rerun required deterministic verification
   - verify artifact lineage/integrity

15. HUMAN_REVIEW_GATE
   - stop workflow
   - provide concise gate package:
     - task
     - final git diff summary
     - tests/builds
     - replay metrics
     - findings resolved/open
     - assurance evidence
     - provider usage/cost where known
     - artifact references
   - no commit/push/merge

## Known-vs-new failure classification

The workflow may distinguish a known unrelated build failure only when:
- classifier rule is explicit and versioned
- evidence identifies the failing project/file/command
- targeted World Harvester validation still runs
- the classification is included in the gate package

No free-form LLM statement may silently suppress a deterministic build failure.

## Metric comparison contract

Candidate metrics should be explicitly listed per workflow version. Examples may include:
- discovered sources
- valid pages
- provider field coverage
- validation pass/fail counts
- failure categories

The exact acceptance thresholds remain VITO/AOE policy, not n8n logic.

## Technical retry policy
n8n may retry bounded transient execution failures. Each retry must retain the same semantic step and increment `attemptNo`, never `correctionLoopCount`.

## Security
- no unrestricted command node against host
- worker action allowlist only
- no secret dumping
- builder/reviewer worktree separation
- destructive commands denied
- Human Gate required for any future release mutation

## Definition of Done
A single start request executes the complete Uruguay engineering loop from baseline inspection through build/replay/diagnostic collection/review/correction/re-review and stops at a human-controlled gate with complete evidence, without manual terminal-command or prompt copy/paste.