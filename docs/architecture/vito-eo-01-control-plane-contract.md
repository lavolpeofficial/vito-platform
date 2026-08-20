# VITO-EO-01 — Engineering Control Plane Contract v0.1

Status: Prepared product/operations contract

## Goal

Define the minimum information and actions a future VITO Engineering Control Plane must expose. This is not a UI implementation requirement for EO-01.

## Views

### Workflow runs
- run ID
- task/title
- organization
- assurance level
- current step
- status
- correction loop count
- elapsed time
- blocked reason
- correlation ID

### Provider status
- provider code/type
- model family
- supported capabilities
- health/quota/capacity
- last successful execution
- current eligibility reason

### Executions
- step
- provider
- attempt number
- duration
- outcome
- cost/usage
- artifacts

### Reviews
- reviewer executions
- model families
- verdicts
- findings by severity/category
- disagreement state
- assurance evidence completeness

### Human gates
- gate type/status
- exact workflow/evidence context
- requested time
- pending duration
- approver/rejector
- decision timestamp

### Worktrees
- builder/reviewer/release paths
- expected refs
- integrity status
- cleanup status

## Operator actions

Initial allowed actions should remain narrow:
- inspect run
- inspect artifacts/evidence
- cancel governed run
- approve/reject Human Gate if authorized
- request retry/fallback where policy permits
- disable provider administratively

No generic 'force continue' button that bypasses policy/assurance.

## Dashboard metrics

- active/pending/blocked runs
- provider availability/quota
- correction rate
- disagreement rate
- workflow duration
- Human Gate wait time
- provider retries/timeouts
- cost/usage

## Security

Control-plane visibility and actions are tenant/role scoped. Secrets and raw provider credentials are never displayed.

## Non-goals

- no-code workflow designer
- provider marketplace
- unrestricted shell
- manual mutation of audit history
