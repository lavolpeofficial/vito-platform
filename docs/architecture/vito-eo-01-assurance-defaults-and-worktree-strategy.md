# VITO-EO-01 — Assurance Defaults & Worktree Strategy

Status: Prepared governance specification

## Assurance default policy

### Default mapping
- routine implementation / low-risk refactor: `AL2`
- security, permission, governance, tenant-boundary, audit-critical change: `AL3`
- core architecture, release-boundary, provider-router assurance logic, release execution and other high-impact platform changes: `AL4`

### Conservative escalation
If classification is ambiguous, choose the next higher assurance level. Never silently downgrade because a preferred reviewer/provider is unavailable.

### AL1
Reserved for explicitly low-risk internal experiments where no independent review is required by policy. Not the default for production-bound VITO changes.

### Override rules
Assurance may be raised automatically by policy.
Lowering below the policy minimum requires an explicit human policy exception and audit record.

## Worktree strategy

### Principle
Builder and reviewers must never share the same writable worktree.

### Logical naming
Use run-scoped worktrees such as:
- `vito-builder/{workflowRunId}`
- `vito-reviewer-a/{workflowRunId}`
- `vito-reviewer-b/{workflowRunId}`
- `vito-release/{workflowRunId}` only when needed after Human Gate

Physical directory names may be sanitized short IDs.

### Builder worktree
- based on exact governed base revision
- writable only within allowed repository paths
- no commit/push authority
- produces patch/diff/test artifacts

### Reviewer worktree
- based on governed base + exact candidate patch/revision under review
- source read-only to reviewer execution
- isolated temp output allowed for tests/scanners
- no source mutation, commit or push

### Reviewer independence
Reviewer worktrees must be provisioned independently from builder writable state. Review package must identify exact base revision and candidate diff/hash.

### Release worktree
Release operations are not performed in builder/reviewer worktrees by default.
After approved Human Gate, a governed release context verifies exact approved revision/artifacts before any commit/push action.

## Worktree lifecycle
1. create from validated base ref/SHA
2. record path + base SHA in workflow audit
3. apply governed candidate state where applicable
4. execute role-specific step
5. hash/accept required artifacts
6. mark worktree releasable/cleanup-eligible
7. cleanup only after evidence has been durably stored

## Cleanup rules
- never delete branch/ref as part of automatic worktree cleanup in EO-01 v0.1
- never delete accepted artifacts
- do not cleanup a worktree with unresolved execution or missing artifact capture
- stale worktrees are detected and surfaced; cleanup follows explicit policy

## Git mutation boundary
Before Human Release Gate:
- read operations allowed by role policy
- `commit`, `push`, `merge`, remote ref mutation, branch deletion denied

After Human Gate:
- only release authority/adapter can perform explicitly approved release action
- approval must bind to exact revision/artifact hashes

## Required tests later
- builder/reviewer paths distinct
- reviewer cannot write source
- reviewer sees exact candidate revision
- base SHA recorded
- cleanup cannot erase accepted evidence
- release action cannot use an unapproved revision
