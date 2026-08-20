# VITO-EO-01 — Sandbox & Permission Matrix

Status: Draft security specification

## Principle

All agent execution is fail-closed. Permissions are explicit grants, not implied capability side effects.

## Roles

| Action / Resource | Builder | Reviewer | VITO Orchestrator | Release Authority |
|---|---:|---:|---:|---:|
| Read assigned repository/worktree | ALLOW | ALLOW | READ METADATA/ARTIFACTS | ALLOW AS REQUIRED |
| Modify production source | BUILDER WORKTREE ONLY | DENY | DENY | DENY BY DEFAULT |
| Run tests | ALLOW | ALLOW | DENY DIRECT EXECUTION | POLICY-CONTROLLED |
| Create review artifacts | ALLOW | ALLOW | ALLOW ORCHESTRATION METADATA | ALLOW RELEASE RECORD |
| Read secrets | DENY | DENY | DENY | DENY BY DEFAULT |
| Unrestricted HOME access | DENY | DENY | DENY | DENY |
| External network | POLICY-CONTROLLED | POLICY-CONTROLLED | POLICY-CONTROLLED | POLICY-CONTROLLED |
| Git status/diff/read operations | ALLOW | ALLOW | ALLOW METADATA | ALLOW |
| Git commit | DENY | DENY | DENY | ALLOW ONLY AFTER APPROVED RELEASE GATE |
| Git push | DENY | DENY | DENY | ALLOW ONLY AFTER APPROVED RELEASE GATE |
| Merge | DENY | DENY | DENY | DENY IN EO-01 v0.1 UNLESS EXPLICIT FUTURE POLICY |
| Branch deletion | DENY | DENY | DENY | DENY |
| Change workflow policy | DENY | DENY | POLICY LOAD ONLY | HUMAN ADMIN ONLY |
| Approve release | DENY | DENY | DENY | HUMAN ONLY |

## Filesystem model

Recommended logical boundaries:

- builder worktree: writable only by builder execution profile
- reviewer worktree: read-only for source; ephemeral test outputs may use isolated temp path
- artifact store: append/create via governed runtime; accepted immutable artifacts cannot be overwritten
- secrets paths: explicit deny list plus separate secret broker in future, never repository-wide environment inheritance
- HOME: no unrestricted traversal

## Git command policy

### Allowed before Human Release Gate

Read-only operations may include:
- `git status`
- `git diff`
- `git show`
- `git log`
- `git rev-parse`
- `git branch --show-current`

Mutation operations are denied:
- `git commit`
- `git push`
- `git merge`
- `git rebase` unless explicitly required by future isolated maintenance policy
- `git branch -D`
- remote ref deletion

### Release domain

Commit/push becomes eligible only when all are true:

1. workflow is at approved release state
2. explicit Human Gate is APPROVED
3. approval references the exact artifact/revision context
4. execution policy grants the specific release action
5. release actor is the governed release adapter/authority
6. audit record is created

## Network policy

Default: deny unless adapter execution requires a known endpoint.

Future allowlists should be provider/tool scoped, not generic Internet access.

## Secrets policy

Default: deny.

EO-01 v0.1 does not need a general-purpose secret broker. Provider credentials should be injected only into the provider adapter process with minimum scope and must not become readable task context or artifacts.

## Budget controls

Every execution profile can constrain:
- timeout
- maximum provider retries
- token budget where measurable
- cost budget where measurable
- process/command count if needed later

Budget exhaustion is not a correction-loop event.

## Required normalized policy outcomes

- `POLICY_BLOCKED`
- `TIMED_OUT`
- `QUOTA_BLOCKED`
- `CANCELLED`

These are execution outcomes and must not be silently converted into code-quality findings.

## Security tests required before productive provider execution

- path traversal outside allowed worktree rejected
- denied path wins over broader allowed path
- reviewer write attempt rejected
- commit attempt rejected before release gate
- push attempt rejected before release gate
- secrets path read rejected
- unrestricted HOME read rejected
- missing/unknown policy fails closed
- timeout enforced
- policy decision written to audit chain

## Explicitly forbidden shortcuts

- `dangerously-skip-permissions`
- unrestricted shell under user HOME
- shared writable builder/reviewer worktree
- exposing complete environment variables to model context
- automatic push/merge
- policy fallback to ALLOW on parse/configuration error
