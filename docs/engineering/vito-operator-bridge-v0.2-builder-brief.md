---
record_type: implementation-brief
record_id: VITO-OB-002-BUILDER
title: "Operator Bridge v0.2 — Builder Brief"
system: vito-platform
subsystem: operator-bridge
status: AUTHORIZED
created: 2026-08-28
updated: 2026-08-28
author: VITO Engineering
implementation_branch: feat/vito-operator-bridge-v0.2-first-real-flow
architecture_record: docs/engineering/vito-operator-bridge-v0.2-first-real-flow-design.md
architecture_review: docs/engineering/vito-operator-bridge-v0.2-architecture-review.md
---

# VITO-OB-002 — Builder Brief

## Builder

Use OpenCode with Big Pickle for implementation.

## Mission

Implement the smallest possible production-grade operator smoke harness that proves one real VITO-side engineering roundtrip through the existing Operator Bridge and real configured `CODE_BUILD` provider.

The architecture review is PASS. Implementation is authorized, but scope is strict.

Do not redesign OB-001. Do not add external ChatGPT connectivity. Do not add autonomous commit, push, PR, merge, repository selection, provider selection, executable selection, shell authority, or sandbox overrides.

## Authoritative records

Read these first and treat them as binding:

1. `docs/engineering/vito-operator-bridge-v0.2-first-real-flow-design.md`
2. `docs/engineering/vito-operator-bridge-v0.2-architecture-review.md`
3. `docs/engineering/vito-operator-bridge-v0.1-design.md`

Inspect the current implementation on the branch before changing anything.

## Expected implementation

Primary deliverable:

`./scripts/operator-bridge-real-flow.mjs`

Add one convenient package command if it fits the repository conventions:

`npm run operator-bridge:real-flow`

The harness must:

- read `VITO_BASE_URL` and `VITO_OPERATOR_TOKEN` from environment only;
- never print, persist, serialize, or include the Bearer token in errors;
- generate one UUID `requestId`;
- POST to `/v1/operator/tasks` using `capabilityCode: CODE_BUILD`;
- submit the canonical task that creates exactly:
  `docs/engineering/operator-bridge-real-flow-proof.md`;
- require exactly this semantic content:

  `# Operator Bridge Real Flow Proof`

  `This file was created by a governed VITO operator task.`

- explicitly instruct the provider to make no unrelated changes;
- poll `GET /v1/operator/tasks/:taskId` at a bounded interval with a hard timeout;
- derive terminal/success status handling from the actual repository contract, not invented strings;
- reject any result where `changedFiles` is not exactly the canonical proof path;
- require a non-empty governed patch while sensitive payload retention permits it;
- verify the patch contains the intended file addition/content;
- require `workspaceDisposition === 'CLEANED'`;
- reject obvious credential leakage in stdout/stderr/patch;
- perform a second GET and verify durable identity/result metadata consistency;
- replay the exact same POST with the same requestId and prove idempotent resolution;
- send a materially different payload with the same requestId and prove the existing idempotency conflict fails closed;
- exit non-zero for every invariant violation;
- print only a concise sanitized PASS/FAIL summary.

## Hard prohibitions

The harness MUST NOT:

- invoke OpenCode directly;
- invoke Bubblewrap or the RemoteExecutionWorker directly;
- write the proof file itself;
- inspect or mutate internal DB tables;
- inspect internal worktree paths as an acceptance shortcut;
- apply the returned patch;
- create commits or branches in the target repository;
- push or merge;
- accept repository URL, base ref, provider ID, executable path, command, environment passthrough, sandbox flags, or credentials from CLI options;
- weaken any auth, tenant, routing, policy, idempotency, retention, or sandbox control established by OB-001.

## Core-runtime change rule

Core runtime changes are NOT expected.

If the real flow cannot work without changing Operator Bridge, Agent Workforce, Provider Router, Governed Runtime, Governed Invocation, HeadlessLocalAgentAdapter, RemoteExecutionWorker, auth guards, RepositoryRegistry, sandboxing, persistence schema, or the public task contract:

STOP.

Do not broaden scope. Report the exact blocker, relevant files, current behavior, expected behavior, and smallest architectural options back for review.

## Testing requirements

Add focused automated tests for the harness logic where practical without requiring real credentials or a real model in CI. Extract pure helpers only where this materially improves testability and does not create unnecessary abstraction.

At minimum verify:

- required environment validation;
- token does not appear in formatted errors;
- bounded polling timeout behavior;
- exact changed-files validation;
- patch-content validation;
- workspace disposition validation;
- durable GET consistency check;
- exact replay validation;
- conflicting replay rejection handling;
- non-zero behavior on invariant failures.

Use the repository's existing test conventions. Do not introduce a new test framework.

The real provider acceptance run must remain an explicit operator command and must NOT become a normal CI dependency.

## Required regression gates

Before declaring implementation complete, run the repository's existing relevant gates and report exact results. At minimum:

- Prisma generate/validate if touched or required by repository test setup;
- API unit tests;
- Operator Bridge tests;
- PostgreSQL Operator Bridge gate;
- scoped auth/application E2E gate;
- typecheck;
- build;
- `git diff --check`;
- new harness tests.

Do not claim PASS for a command that was not actually run.

## Real-provider acceptance

After automated tests are green, perform the explicit real-provider run only if the local environment already has the required VITO service, trusted repository registry/configuration, Bubblewrap prerequisites, actual headless coding provider, machine identity, and credentials.

Do not fabricate or commit credentials.

A real-provider PASS must show, sanitized:

- POST task identity;
- routed real provider metadata;
- terminal success-equivalent status;
- exactly one changed file: `docs/engineering/operator-bridge-real-flow-proof.md`;
- non-empty exact governed patch containing the expected addition;
- `workspaceDisposition: CLEANED`;
- exact replay resolves idempotently without a second logical task/execution;
- conflicting replay fails closed;
- second GET is durable/consistent;
- no secret leakage.

If the environment is missing prerequisites, automated implementation can still be complete, but mark the operational acceptance as BLOCKED with the precise missing prerequisite. Do not simulate success.

## Acceptance record

If and only if the real-provider run actually succeeds, create:

`docs/engineering/vito-operator-bridge-v0.2-acceptance.md`

It must contain sanitized evidence only: date/time, branch/commit, commands, relevant status/result metadata, changed file, cleanup disposition, replay/conflict outcomes, test summary, and explicit confirmation that no credentials or raw secrets are recorded.

Do not paste full sensitive stdout/stderr or a token-bearing command line.

## Git discipline

Work only on:

`feat/vito-operator-bridge-v0.2-first-real-flow`

Do not push to `main`.

Keep changes minimal and reviewable. Before commit, inspect the complete diff and confirm there are no unrelated changes.

Suggested implementation commit:

`feat(vito): add operator bridge real-flow harness`

If acceptance evidence is produced after the real run, a separate documentation commit is acceptable:

`docs(vito): record OB-002 real-flow acceptance`

Push the feature branch when complete.

## Final report format

Return a concise builder report containing:

1. implementation status: COMPLETE / BLOCKED;
2. files changed;
3. architecture deviations: NONE or exact list;
4. automated test/gate results with counts where available;
5. real-provider acceptance: PASS / FAIL / BLOCKED;
6. if BLOCKED, exact prerequisite or failure;
7. commit SHA(s);
8. push status;
9. `READY FOR SOL REVIEW: YES/NO`.

Do not open or merge a PR unless explicitly instructed after Sol review.
