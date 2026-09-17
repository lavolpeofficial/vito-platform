# VITO Self-Build: narrowly scoped pre-Human-Gate publication contract v1

Status: **approved by Sovereign Authority on 2026-09-17 for architecture and implementation; NOT activated in runtime**.

## Approval boundary

An authenticated human must separately approve CODE_BUILD for the exact tenant, mission, repository and isolated feature branch before any commit or push. Approval must remain active and auditable; this document is not itself an approval for any CODE_BUILD invocation. Missing, expired, revoked or mismatched approval denies publication.

After that separate approval, and only within its exact scope, the engineering workflow may commit and push to its isolated feature branch, create a **draft** pull request, and read CI results correlated to exactly one immutable full head SHA. Never infer CI success from branch name, timestamp or an ambiguous run. Replays must be idempotent and checked against persisted mission, tenant, repository, branch, PR and SHA evidence before any external mutation. Credentials are server-owned, least-privilege and never exposed to the agent. Missing credentials fail closed.

Merge, deployment, provider/capability activation, governance changes and machine approval of any Human Gate remain prohibited. A green CI run is evidence, **not** human approval. Human release approval remains a separate authenticated human action. Tenant-scoped persistence and audit records are mandatory for each attempted and completed transition, including failures.

## Implementation boundary

`apps/api/src/modules/engineering-release/pre-gate-publication.policy.ts` is a pure, fail-closed policy function with negative tests. It is **not wired** to a GitHub adapter, persistence, approval store or production runtime. Its caller must resolve approval from the server-side authority store, never from agent-supplied booleans. `actorIsMachine` is not a substitute for authenticated CODE_BUILD approval. No GitHub mutation adapter or workflow transition is enabled by this PR.

## Remaining work before activation

1. Security review of server-side CODE_BUILD approval evidence, expiry and revocation.
2. Tenant-bound persistence, atomic idempotency and audit transaction design.
3. Narrow GitHub adapter with credential isolation and immutable SHA/PR correlation.
4. Negative integration tests: cross-tenant, missing credentials, replay, mismatched branch/SHA, zero or multiple CI matches, failed CI, machine Human-Gate approval.
5. Full PLAN → BUILD → TEST → PACKAGE → PR → CI → Human Gate E2E proof in a non-production environment, followed by explicit activation authorization.

No merge, production deployment or provider/capability activation is authorized by this contract.
