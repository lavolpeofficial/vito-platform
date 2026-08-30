---
record_type: production-mission
record_id: VITO-PM-001
title: "VITO Production Mission 001 — Governed Documentation Change"
system: vito-platform
status: READY
created: 2026-08-30
base_branch: main
base_sha: "19b9833618ce6c07af86127856e7d89a2e3ad83f"
mission_branch: mission/vito-production-mission-001
---

# VITO Production Mission 001 — Governed Documentation Change

## Objective

Execute the first post-merge production-shaped VITO mission through the merged Operator Bridge and CLOUD_GOVERNED execution path, using a real cloud model and the production governance chain, without manual direct editing of the target file.

## Authorized task

Create exactly one file:

`docs/engineering/vito-production-mission-001-result.md`

with exactly this UTF-8 content, including the final newline:

```text
# VITO Production Mission 001

Status: EXECUTED

This file was created through the governed VITO production execution path.
```

No other repository file may be created, modified, renamed, or deleted by the governed agent.

## Required execution path

The mission must traverse the merged production-shaped chain from `main`:

machine identity
→ Operator Bridge
→ governed capability invocation
→ server-owned CLOUD_GOVERNED execution profile
→ trusted cloud execution boundary
→ trusted OpenCode launcher
→ authorized OpenAI provider/model policy
→ ephemeral governed workspace
→ exact file mutation
→ authoritative VITO change-set capture
→ teardown
→ terminal mission result

The mission must not be satisfied by directly editing the target file outside the governed execution path.

## Governance constraints

- Repository: `lavolpeofficial/vito-platform`
- Base ref: `main`
- Base SHA must resolve from the current protected `main`; expected starting SHA is `19b9833618ce6c07af86127856e7d89a2e3ad83f` unless `main` has advanced only through an explicitly verified repository event.
- CLOUD_GOVERNED profile, provider identity, model policy, credential reference, trusted launcher, repository registry, budgets and workspace root remain server-owned.
- Caller/task input may not override provider, model, credential, launcher path, clone URL, base ref policy, network policy, shell command or arbitrary environment variables.
- No Git commit, push, merge, rebase, force-push or branch deletion from inside governed agent execution.
- `LOCAL_ISOLATED` remains unchanged.
- Credential cleanup and workspace cleanup remain fail-closed.
- Provider identity postcondition must be enforced and pass.

## Acceptance criteria

All must PASS:

1. The request enters through the production-shaped Operator Bridge/governed dispatch path, not a direct test-only executor call.
2. Real governed cloud execution occurs through the authorized provider identity.
3. `expectedProviderId=openai` and `observedProviderId=openai`.
4. Observed model satisfies the server-owned model allow-list if configured.
5. Agent exits successfully.
6. Exactly one changed file is captured: `docs/engineering/vito-production-mission-001-result.md`.
7. File content is byte-for-byte identical to the authorized content above, including final newline.
8. No unrelated repository mutation occurs.
9. Exact governed patch/change-set is captured by VITO.
10. Credential disposition is removed; no reusable credential appears in logs, result evidence, workspace or persisted task metadata.
11. Workspace/session disposition is cleaned; no residual agent process or session artifact remains.
12. Idempotent replay returns the prior governed result without a second provider execution.
13. Conflicting replay with the same idempotency key but altered prompt/content is rejected.
14. Existing PostgreSQL, composed auth/Operator Bridge E2E, contracts, unit and build gates remain green.
15. The target result file is not committed or pushed automatically by the governed agent; any later Git commit is an explicit outer release-engineering step after review.

## Stop conditions

STOP without weakening controls if any of the following is required:

- bypassing Operator Bridge or governed dispatch to make the mission pass;
- direct/manual creation of the target result file as acceptance evidence;
- disabling provider-identity enforcement;
- exposing reusable credentials;
- granting Git push/commit authority to the agent;
- broadening filesystem or caller-controlled network/shell authority;
- changing production governance just to accommodate the mission.

## Report format

Report:

1. exact `main` base SHA used;
2. mission/task/idempotency identifiers (sanitized);
3. execution path actually traversed;
4. expected/observed provider and observed model;
5. terminal result status and exit code;
6. exact changedFiles;
7. exact byte/hash verification of the result file;
8. change-set/patch metadata;
9. credential and workspace disposition;
10. replay and conflict-replay results;
11. post-mission gate results;
12. residual files/processes count;
13. `PRODUCTION MISSION 001: PASS|FAIL`.

Do not merge or modify `main` as part of the mission itself.
