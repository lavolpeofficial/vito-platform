# VITO Controlled Execution Worker Contract v0.1

Status: Draft security/build specification

## Purpose
Provide a narrow, auditable execution boundary between n8n and local/server-side engineering commands.

n8n must never receive unrestricted shell authority. The worker executes only predeclared actions mapped to controlled command templates.

## API surface

### POST /execute
Request fields:
- executionId
- workflowRunId
- workflowStepRunId
- repositoryId
- worktreeRole
- action
- parameters (schema-bound per action)
- timeoutMs
- correlationId
- causationId
- policyVersion

Response fields:
- executionId
- status
- exitCode
- startedAt
- finishedAt
- durationMs
- stdoutArtifactRef
- stderrArtifactRef
- producedArtifactRefs[]
- normalizedMetrics
- errorCode
- policyDecision

### GET /executions/:id
Read normalized execution state.

### POST /executions/:id/cancel
Cancel only when policy permits.

## Allowed actions v0.1

### GIT_INSPECT
May execute read-only templates for:
- git status --short
- git diff / diff --stat
- git log
- git show
- git rev-parse
- git branch --show-current

### RUN_BUILD
Maps to repository-declared build command, initially e.g. `pnpm build` or a narrower approved build command.

### RUN_TESTS
Maps to repository-declared deterministic test command(s).

### RUN_REPLAY
Only for explicitly registered replay commands such as World Harvester Uruguay replay.

### READ_ARTIFACT
Reads only files under registered artifact/output directories.

### INVOKE_BUILDER
Runs the configured builder adapter within the builder worktree and returns structured report/artifacts.

### INVOKE_REVIEWER
Runs a read-only reviewer adapter against an immutable review package/reviewer worktree.

## Explicitly denied
- arbitrary shell strings
- unrestricted bash/sh execution
- unrestricted HOME access
- `rm -rf`
- filesystem deletion outside explicit future cleanup action
- git commit before approved release action
- git push
- git merge
- branch deletion
- package/system installation
- sudo
- secret/environment dump
- changing firewall/network/security policy

## Repository registry

Worker uses a static/configured registry, not arbitrary paths supplied by n8n.

Each repository entry defines:
- repositoryId
- canonicalPath
- allowed worktree root
- artifact root
- build profiles
- test profiles
- replay profiles
- denied paths
- network policy

Unknown repositoryId -> POLICY_BLOCKED.

## Worktree roles
- BUILDER: source writable within assigned builder worktree
- REVIEWER_A: source read-only; isolated temp test output allowed
- REVIEWER_B: source read-only; isolated temp test output allowed
- RELEASE: no mutation unless VITO Human Gate approval context is validated

## Path enforcement
1. canonicalize path
2. verify under configured worktree root
3. apply denied-path rules
4. denied path always wins
5. symlink escape must be rejected
6. unknown/malformed path -> fail closed

## Process enforcement
- child process timeout
- process-group cancellation
- stdout/stderr size limits
- output redaction for configured secret patterns
- no inherited full environment
- explicit environment allowlist
- exit code always recorded

## Idempotency
Execution requests use `executionId` as idempotency key.
Duplicate active/completed execution requests must not silently create a second mutation-capable process.

## Technical retry
Worker itself does not decide semantic correction.
A technical retry must preserve:
- parent execution identity
- attempt number
- same semantic step
- unchanged correctionLoopCount

## Audit
Emit normalized events for:
- execution received
- policy allowed/denied
- process started
- process timed out/cancelled
- process completed/failed
- artifacts produced

## Required tests
- unknown repository blocked
- path traversal blocked
- symlink escape blocked
- reviewer write blocked
- arbitrary command blocked
- git push blocked
- HOME traversal blocked
- timeout terminates child process
- duplicate execution id does not double-execute
- stdout/stderr returned as artifacts
- allowed build/test commands succeed in fixture repository

## Non-goals
- container scheduler
- generic remote shell
- SSH management platform
- secrets broker
- workflow state authority
- provider selection