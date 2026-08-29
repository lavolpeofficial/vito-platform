---
record_type: architecture-review
record_id: VITO-OB-002D-REVIEW-01
title: "Operator Bridge v0.2D — Architecture Review"
system: vito-platform
subsystem: operator-bridge / governed-runtime / remote-execution
status: PASS_WITH_CONDITIONS
created: 2026-08-29
updated: 2026-08-29
reviewer: GPT-5.6 Sol
reviewed_record: VITO-OB-002D
reviewed_branch: design/vito-operator-bridge-v0.2d-governed-cloud-execution-tier
review_gate: ARCHITECTURE_REVIEW
implementation_authorization: NARROW
---

# VITO-OB-002D — Architecture Review

## 1. Verdict

**PASS WITH CONDITIONS — narrow implementation authorization granted.**

The Phase 0 evidence is sufficient to establish that a cloud-backed coding execution tier can be separated from `LOCAL_ISOLATED` without weakening the latter. The recommended Boundary A — a dedicated local trusted cloud-execution service/process with ephemeral HOME/workspace and server-owned credential/profile selection — is the smallest viable boundary demonstrated by the evidence.

No BLOCKER remains for a narrowly scoped implementation.

The principal residual risk is that the first Boundary A implementation does not provide hard per-host egress enforcement. This is acceptable for the first proof only if the compensating controls in this review are implemented and tested exactly; the system must not claim provider-host allowlisting until it is actually enforced.

---

## 2. Evidence accepted

Phase 0 established the following empirically:

- OpenCode cloud execution works with a minimal ephemeral HOME/config/cache rather than the operator's normal HOME.
- Credentials can be injected for the execution without placing them in the repository workspace.
- Post-run scans found no reusable credential residue in workspace, logs, cache or temporary state after cleanup.
- The operator's persistent auth source remained unchanged by the probes.
- Required cloud traffic is HTTPS/443 plus DNS; the tested OpenCode/provider path does not require broad local host integration.
- A bounded exact file-write probe passed repeatedly with exactly one intended file, byte-identical content, no unrelated mutation, deterministic exit and no leftover process/listener.
- Missing/invalid authentication fails closed.
- `LOCAL_ISOLATED` was not modified during the investigation.

These facts satisfy the investigation requirements of the OB-002D design sufficiently to authorize the minimum implementation.

---

## 3. Architecture fit

### 3.1 Execution-tier split

The tier split is correct:

```text
LOCAL_ISOLATED
  -> Bubblewrap --unshare-net
  -> no cloud credential

CLOUD_GOVERNED
  -> separate trusted execution boundary
  -> ephemeral agent HOME/workspace
  -> server-owned provider credential/profile
  -> cloud provider transport
```

The cloud tier MUST NOT be implemented as a flag that removes `--unshare-net` from the existing Bubblewrap executor. The existing local tier remains a separate invariant-preserving path.

### 3.2 VITO remains the control plane

The trusted cloud execution service is an execution adapter, not a new authority. It may execute only a request already authorized by VITO. VITO remains authoritative for:

- organization/tenant identity;
- capability and execution profile;
- provider selection;
- execution tier selection;
- repository and base ref;
- budget;
- task/idempotency ownership;
- change-set capture;
- acceptance postconditions;
- audit and terminal result.

No externally callable generic command-execution API is authorized.

---

## 4. Credential boundary — PASS WITH REQUIRED CONTROLS

The credential approach is acceptable only under all of these conditions:

1. `credentialRef` is server-owned and never accepted from the operator/task payload.
2. The real secret is resolved only inside the trusted cloud execution boundary.
3. Credentials are injected per execution; no persistent operator HOME/config mount is allowed.
4. Ephemeral HOME/config/cache must be unique per execution.
5. Cleanup must occur on success, provider failure, timeout and signal.
6. Returned stdout/stderr, audit events, persisted task metadata and acceptance evidence must never contain credential values.
7. The repository workspace must never contain the credential or auth config.
8. A missing credential must fail closed before provider execution.
9. Tests must use a synthetic canary secret and assert non-presence across all durable/returned surfaces.

A copied long-lived `auth.json` may be used only as a Phase 0 probe technique. The implementation should prefer per-process environment/token injection where supported, because it has a smaller residue surface. If the production implementation must materialize auth state, it must do so only inside the ephemeral execution HOME and delete it on every terminal path.

---

## 5. Network boundary — PASS WITH RESIDUAL RISK

The Phase 0 evidence shows that hard hostname-level egress allowlisting is not yet part of the proposed Boundary A. Therefore:

- Do **not** describe the first implementation as network-allowlisted.
- The execution service may have outbound HTTPS/DNS access required by the cloud provider, but the task/operator may not control destination URLs.
- No provider base URL field may be introduced into the operator request.
- No SSH agent, SSH keys, Git credentials, cloud credential directories or host secrets may be mounted into the execution boundary.
- Git push/commit remain unavailable through policy and absence of credentials.
- OpenCode update/model registry fetches should be disabled where the installed runtime supports it, unless explicitly required and reviewed.
- Residual unrestricted outbound TCP from the agent process is accepted only for the first Flight 001 proof under the compensating controls below.

### Required compensating controls

For the first implementation:

- dedicated process identity or equivalently constrained runtime identity;
- minimal filesystem exposure;
- ephemeral HOME/config/cache;
- single task at a time;
- no host HOME, SSH, Git or unrelated secret mounts;
- server-owned fixed provider/model/profile;
- strict timeout/process-tree termination;
- strict post-execution changed-file and patch validation;
- no Git release authority;
- sanitized stdout/stderr persistence;
- cleanup evidence on every terminal path.

A hardened egress proxy / container network policy may be a later security increment, but it is not a prerequisite for the first bounded Flight 001 if the above controls are verified.

---

## 6. Workspace and change-set authority — PASS

The cloud agent may mutate only the VITO-provisioned ephemeral workspace. It must not receive authority to commit, push, merge, select another repository or alter the base ref.

The existing VITO change-set layer remains authoritative after the process exits. For Flight 001 the acceptance postcondition is exact:

- changed files = exactly the canonical proof markdown path;
- content = byte-equivalent expected content;
- no unrelated mutation;
- exact governed patch captured;
- workspace cleaned;
- no credential-bearing file included in the worktree or patch.

The cloud agent's own success exit code is not sufficient to mark the operator task accepted if these postconditions fail.

---

## 7. Idempotency and ownership — PASS

The existing OperatorTask/idempotency ownership semantics must wrap the new cloud tier unchanged.

Required tests:

- exact replay -> prior result, no second provider execution;
- conflicting replay -> fail closed;
- concurrent duplicate claim -> one execution owner;
- cloud adapter must not introduce its own independent retry/idempotency model that can cause duplicate model calls after VITO has already claimed execution.

---

## 8. Budgets and cost governance — PASS WITH LIMITATION

Duration must be hard-enforced by VITO/process timeout.

Token/cost limits may only be called "hard" if the installed provider/runtime can actually enforce them. If OpenCode/provider settings are advisory, record them as advisory and enforce a hard duration plus one-concurrent-execution ceiling for Flight 001.

No automatic model escalation, fallback provider or unbounded retry loop is authorized.

---

## 9. Failure-path requirements

The implementation is not review-ready until tests cover at minimum:

- no cloud profile -> deny;
- disabled/mismatched profile -> deny;
- wrong capability/profile/provider -> deny;
- operator attempts to choose tier/provider URL/credential -> impossible or rejected;
- missing credential -> fail closed;
- provider auth failure -> terminal sanitized failure;
- DNS/network failure -> terminal sanitized failure;
- timeout -> process tree killed, ephemeral HOME removed;
- agent non-zero exit -> ephemeral HOME removed;
- malformed/unexpected agent output -> terminal failure or governed result, never authority escalation;
- unrelated repository mutation -> Flight 001 acceptance failure;
- synthetic credential canary absent from persisted/returned/logged artifacts;
- local isolated path still runs with `--unshare-net` and unchanged regression tests.

---

## 10. Narrow implementation authorization

The builder MAY implement only the minimum `CLOUD_GOVERNED` execution tier needed for the canonical OB-002 Flight 001 proof.

Authorized scope:

- server-owned execution-tier/profile configuration;
- internal cloud execution adapter/service;
- ephemeral HOME/config/cache lifecycle;
- server-owned credential resolution/injection;
- fixed trusted OpenCode launcher invocation;
- bounded process execution and tree termination;
- integration into the existing governed provider/runtime path;
- tests listed in this review;
- sanitized acceptance evidence.

Not authorized:

- changing or weakening `LOCAL_ISOLATED`;
- generic shell or remote-execution endpoints;
- caller-selectable provider URLs, executable paths, tiers or credentials;
- Git commit/push/merge authority;
- mounting operator HOME/SSH/Git secrets;
- automatic provider fallback/model escalation;
- claiming hostname-level egress allowlisting without implementation and proof;
- broad refactor unrelated to Flight 001.

If the implementation requires any of the above, STOP and return for architecture review.

---

## 11. Review severity summary

- BLOCKER: 0
- HIGH: 0
- MEDIUM: 1 residual risk — no hard per-host egress enforcement in initial Boundary A; accepted conditionally for the bounded first proof with mandatory compensating controls.
- LOW: 0 architecture findings requiring pre-implementation correction.

---

## 12. Final gate

**ARCHITECTURE REVIEW: PASS WITH CONDITIONS**

**IMPLEMENTATION AUTHORIZATION: YES — NARROW**

The next builder step is implementation of the minimum governed cloud execution tier on a new feature branch based on the completed OB-002A implementation. After implementation, Sol must review the actual diff and security tests before the real Flight 001 acceptance run is accepted as complete.
