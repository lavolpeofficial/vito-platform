---
record_type: architecture-design
record_id: VITO-OB-002D
title: "Operator Bridge v0.2D — Governed Cloud Execution Tier"
system: vito-platform
subsystem: operator-bridge / governed-runtime / remote-execution
status: PROPOSED
created: 2026-08-29
updated: 2026-08-29
author: VITO Engineering
review_gate: ARCHITECTURE_REVIEW
related_pr: null
related_branch: design/vito-operator-bridge-v0.2d-governed-cloud-execution-tier
supersedes: null
superseded_by: null
baseline:
  branch: feat/vito-operator-bridge-v0.2a-runtime-compatibility
  sha: "d611b309e250079ff2f422441bdebeaca2e5d051"
revision: 1
---

# VITO Operator Bridge v0.2D — Governed Cloud Execution Tier

## 1. Context and evidence

OB-002 established the first-real-flow harness. OB-002A repaired real runtime contract mismatches without broadening authority. OB-002B proved that the installed OpenCode cloud-provider path requires HTTP(S)/TCP and reusable provider credentials in the agent process; with Bubblewrap `--unshare-net`, the proposed Unix-socket mediator path is not supported by the installed runtime. OB-002C then proved that same-namespace credential-free local inference is topologically viable while preserving `--unshare-net`, but the available workstation/model combination failed the mandatory 5/5 deterministic file-write quality gate.

Therefore this milestone does not weaken the existing local sandbox. It defines a second, explicit execution tier for capable cloud-backed coding agents.

Target:

> Permit a governed cloud-backed coding execution through a separately trusted execution boundary while preserving VITO's authority over identity, repository, base ref, capability, budgets, lifecycle, change-set capture, audit, idempotency and final acceptance.

The objective is NOT general Internet access from the existing Bubblewrap workspace.

---

## 2. Architectural decision

VITO SHALL distinguish execution tiers rather than pretending one sandbox topology fits both offline and cloud-backed agents.

Initial conceptual tiers:

- `LOCAL_ISOLATED`: existing Bubblewrap execution with `--unshare-net`; no cloud credentials; suitable for sufficiently capable local inference.
- `CLOUD_GOVERNED`: cloud-backed coding-agent execution through a dedicated trusted execution service/boundary with explicit outbound-provider access.

`LOCAL_ISOLATED` remains unchanged by OB-002D. No fallback from `LOCAL_ISOLATED` to `CLOUD_GOVERNED` may occur implicitly.

The execution tier is selected by server-owned provider/profile configuration, never by prompt text or an arbitrary caller flag.

---

## 3. Non-negotiable invariants

OB-002D MUST preserve:

1. Existing machine identity and organization/tenant binding.
2. Existing capability and execution-profile authorization.
3. Server-owned provider routing and trusted executable identity.
4. Server-owned repository registry and exact allowed base refs.
5. Ephemeral server-provisioned workspace semantics.
6. No caller-provided clone URL, executable path, provider URL, credential, shell command, sandbox flag or arbitrary environment variable.
7. Existing execution budgets remain authoritative; cloud execution may impose stricter limits.
8. Git commit, push, merge, rebase, force-push and branch deletion remain denied for the canonical OB-002 proof.
9. Exact change-set/patch capture remains authoritative after execution.
10. Idempotency, audit and terminal-state semantics remain fail-closed.
11. Provider credentials must never be returned in API responses, task evidence, logs, patches or persisted operator payloads.
12. The canonical first acceptance task remains documentation-only and bounded.

Any implementation requiring removal of these invariants requires a new architecture review.

---

## 4. Trust-boundary principle

A cloud-backed coding agent cannot both have zero network and contact a hosted model. Therefore network permission must be attached to a distinct trusted execution boundary, not silently added to the existing `LOCAL_ISOLATED` sandbox.

Preferred topology:

```text
Operator Bridge
  -> Agent Workforce / Governed Runtime
      -> server-owned tier selection
          -> CLOUD_GOVERNED execution service
              -> ephemeral workspace
              -> trusted coding-agent runtime
              -> provider credential injection from trusted secret boundary
              -> outbound provider access under infrastructure policy
              -> bounded execution
              -> sanitized result + workspace state
      -> VITO authoritative change-set capture
      -> audit / retention / cleanup
```

The cloud execution service is an execution boundary, not a second control plane. VITO remains authoritative for whether the task may execute and whether its result is accepted.

---

## 5. Phase 0 — mandatory empirical investigation before implementation

No runtime implementation is authorized until the builder documents the actual OpenCode/provider behavior and a viable minimum cloud execution boundary.

### 5.1 Credential behavior

Using the installed trusted OpenCode runtime, determine empirically:

- exact credential source(s) used by the selected cloud provider;
- whether credentials can be injected per process without mounting the operator's home/config directory;
- whether a minimal temporary agent home/config can avoid persistence of credentials after exit;
- whether OpenCode writes provider tokens or reusable authentication material to workspace, cache, logs or session artifacts;
- what cleanup is required to leave no reusable credential behind.

Never print secret values in evidence. Report only source type, presence/absence and sanitized paths/metadata.

### 5.2 Network behavior

Determine the minimum network behavior required by the selected provider/runtime:

- provider hostname(s) and protocol actually contacted;
- DNS requirements;
- whether redirects/CDNs/additional endpoints are required;
- whether the runtime performs unrelated network calls such as update checks, telemetry, package/model downloads or plugin resolution.

The investigation must distinguish observed provider-required traffic from optional/unrelated traffic.

### 5.3 Workspace behavior

Prove with a temporary non-repository workspace that the cloud agent can:

1. start with a minimal server-created HOME/config;
2. receive only the bounded test instruction;
3. create exactly one requested markdown file;
4. make no unrelated file mutations;
5. exit deterministically;
6. leave no reusable credential in the workspace or temporary agent home after cleanup.

### 5.4 Boundary options

Evaluate, in order:

A. a dedicated local trusted execution service/process with infrastructure-controlled outbound access and ephemeral HOME/workspace;
B. a containerized execution service with explicit outbound network policy and read/write mounts limited to the ephemeral workspace;
C. another isolation mechanism only if A/B cannot satisfy the requirements.

Do not implement a broad `--share-net`/remove-`--unshare-net` toggle in the existing Bubblewrap executor merely to make the cloud provider work.

Phase 0 output must recommend the smallest viable boundary and list residual risks.

---

## 6. Credential boundary

Cloud credentials are infrastructure secrets, not task inputs.

Requirements:

- credential identity is selected from server-owned provider configuration;
- operator/task payload cannot supply or override credential values;
- credentials are injected only into the trusted cloud execution process for the duration required;
- no credential-bearing operator HOME is mounted;
- no credential is copied into the repository workspace;
- child processes that do not require the credential should not inherit it where technically feasible;
- logs and persisted metadata must redact/omit credentials;
- temporary credential/config artifacts must be removed on success, failure, timeout and signal;
- missing credential fails closed as `CREDENTIAL_INJECTION_FAILED` or an existing semantically equivalent terminal governed error.

If the selected OpenCode authentication mechanism cannot satisfy these requirements, STOP.

---

## 7. Network boundary

`CLOUD_GOVERNED` may have outbound network capability only because cloud inference requires it. This does not imply arbitrary task-controlled networking.

Minimum requirements:

- outbound network policy is infrastructure-owned, not caller-controlled;
- inbound listening is unnecessary and should be denied unless separately justified;
- provider destinations should be restricted as tightly as the actual runtime/provider behavior permits;
- task prompts cannot add destinations;
- arbitrary curl/wget/browser/network capability is not granted as a VITO execution capability merely because the agent process has provider transport;
- repository mutation still occurs only in the provisioned workspace;
- no SSH agent/socket or operator credentials are exposed;
- Git push remains denied by policy and absence of push credentials.

If hostname-level egress restriction cannot be robustly enforced in the chosen first boundary, the design review must explicitly record the residual risk and compensate with process identity, minimal filesystem exposure, ephemeral credentials/HOME, no host secrets, strict task scope and post-execution mutation validation. Do not falsely claim network allowlisting that is not actually enforced.

---

## 8. Execution-tier registry

Implementation, if authorized after Phase 0, should introduce the smallest server-owned configuration needed to bind a provider to an execution tier.

Conceptually:

```text
ExecutionTier = LOCAL_ISOLATED | CLOUD_GOVERNED

CloudExecutionProfile {
  profileId
  providerId
  trustedLauncherAlias
  credentialRef
  maxDurationMs
  maxTokens
  maxCostMinorUnits
  maxParallelism
  enabled
}
```

Rules:

- no caller-selected tier;
- no caller-selected credentialRef;
- no caller-selected provider base URL;
- exact provider/capability/profile binding;
- default deny if profile is missing, disabled or inconsistent;
- one explicit cloud profile is sufficient for the first acceptance.

A database registry is not mandatory if immutable server-side configuration is safer and simpler for v0.2D.

---

## 9. Trusted cloud execution service

The service/adapter MUST:

- accept only a typed server-internal execution request;
- use server-resolved provider/profile configuration;
- create or receive only the already-authorized ephemeral workspace;
- use fixed trusted launcher identity;
- construct argv without caller-controlled shell interpolation;
- create a minimal ephemeral HOME/config/cache outside the repository worktree;
- inject only the required provider credential/config;
- enforce timeout and process-tree termination;
- capture bounded stdout/stderr with existing sanitization rules;
- return deterministic execution status;
- delete temporary credential/config/session state after execution;
- never perform Git commit/push/merge on behalf of the agent;
- not become externally reachable as a general command-execution API.

The implementation must not create a generic remote-shell primitive.

---

## 10. Change-set authority and postconditions

The coding agent does not decide what constitutes an acceptable result.

After cloud execution, the existing VITO workspace/change-set layer remains authoritative. At minimum:

- enumerate changed files from the governed workspace;
- capture the exact patch using existing semantics;
- reject changes outside the task's allowed scope where the canonical proof requires exact scope;
- preserve existing patch size limits;
- preserve exact returned patch bytes; do not invent content redaction;
- audit only approved metadata and never secret material;
- clean up according to existing workspaceDisposition semantics.

For Flight 001 the postcondition is strict: exactly the approved proof markdown file with exact expected content and no unrelated mutations.

---

## 11. Resource and cost governance

Cloud execution introduces monetary and abuse risk.

The first implementation must have:

- one concurrent `CLOUD_GOVERNED` execution by default;
- server-owned maximum duration;
- server-owned token/cost ceiling where the provider/runtime exposes enforceable controls;
- no unbounded retry loop;
- no automatic provider/model escalation;
- terminal failure when a budget cannot be enforced as required;
- auditable provider/model/profile identity without secret values.

Do not claim hard cost enforcement if the underlying runtime only supports advisory limits; record the distinction explicitly.

---

## 12. Security failure cases that must be tested

If implementation is authorized, tests must cover at minimum:

1. caller cannot choose `CLOUD_GOVERNED` directly;
2. caller cannot inject/override provider URL;
3. caller cannot inject/override credential;
4. wrong capability/profile/provider cannot obtain cloud execution;
5. missing/disabled cloud profile fails closed;
6. missing credential fails closed;
7. credential value never appears in returned metadata/log persistence fixtures;
8. no operator HOME/SSH/Git credential mount;
9. timeout kills the agent process tree and cleans ephemeral HOME;
10. agent failure cleans ephemeral HOME;
11. exact proof mutation succeeds;
12. unrelated mutation fails the Flight 001 postcondition;
13. Git push/commit remains unavailable/denied;
14. idempotent replay does not execute the provider twice;
15. concurrent duplicate claim preserves existing ownership semantics;
16. provider/network initialization failure is terminal and sanitized;
17. local isolated tier retains `--unshare-net` and its existing tests unchanged.

---

## 13. Flight 001 acceptance gate

The milestone is not complete merely because OpenCode can call a cloud model.

A real acceptance run must traverse the production-shaped path:

```text
machine identity
 -> Operator Bridge
 -> governed capability invocation
 -> server-owned CLOUD_GOVERNED profile
 -> trusted cloud execution boundary
 -> real OpenCode cloud model
 -> bounded documentation-only mutation
 -> exact VITO change-set capture
 -> terminal task result
```

Required evidence:

- real provider execution, not simulation;
- exact task lifecycle and terminal state;
- exactly expected changedFiles;
- exact governed patch corresponds to expected content;
- no unrelated file changes;
- no credential leakage in evidence/logs/persisted task metadata;
- workspaceDisposition is correct;
- idempotent replay returns prior result without second provider execution;
- conflicting replay is rejected;
- local isolated tier remains unchanged;
- all existing unit, contract, PostgreSQL and composed E2E gates pass.

Only then may VITO-OB-002 / Flight 001 be called PASS.

---

## 14. Implementation authorization boundary

The builder is authorized initially for **Phase 0 investigation only**.

Implementation requires all of the following:

- empirical credential behavior is known;
- empirical network behavior is known;
- a minimal execution boundary is selected;
- no reusable credential persists after cleanup;
- no operator HOME/config is required;
- the bounded cloud file-write probe succeeds;
- architecture review accepts the documented residual network risk.

If these conditions are not met, STOP and report the blocker. Do not weaken existing sandboxing or acceptance criteria.

---

## 15. Builder report format

Phase 0 report must state:

1. installed OpenCode version/provider/model tested;
2. credential source and ephemeral-injection result (sanitized);
3. observed required network destinations/behavior;
4. temporary HOME/config/cache behavior;
5. bounded exact file-write result;
6. recommended boundary A/B/C and why;
7. residual security risks;
8. whether implementation authorization conditions are technically satisfiable;
9. exact blocker if not;
10. `READY FOR ARCHITECTURE REVIEW: YES|NO`.

No implementation branch is to be created during Phase 0.
