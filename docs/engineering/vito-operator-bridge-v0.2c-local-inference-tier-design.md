---
record_type: architecture-design
record_id: VITO-OB-002C
title: "Operator Bridge v0.2C — Local Inference Execution Tier"
system: vito-platform
subsystem: operator-bridge / governed-runtime
status: PROPOSED
created: 2026-08-29
updated: 2026-08-29
author: VITO Engineering
review_gate: ARCHITECTURE_REVIEW
related_pr: null
related_branch: design/vito-operator-bridge-v0.2c-local-inference-tier
supersedes: null
superseded_by: null
baseline:
  branch: feat/vito-operator-bridge-v0.2a-runtime-compatibility
  sha: "d611b30"
revision: 1
---

# VITO Operator Bridge v0.2C — Local Inference Execution Tier

## 1. Context

VITO-OB-002 proved the Operator Bridge harness and acceptance path up to the real provider boundary. VITO-OB-002A corrected two real runtime contract mismatches without weakening governance: the governed sandbox environment contract and a narrowly scoped trusted coding-agent command path.

VITO-OB-002B then investigated whether a cloud-hosted OpenCode provider could be used while retaining Bubblewrap `--unshare-net`. Empirical evidence showed that the installed OpenCode runtime speaks to the model provider over HTTP(S)/TCP, does not support Unix-domain-socket provider transport, and requires a reusable provider credential inside the agent process. Therefore the preferred governed provider-egress design was not technically viable without either weakening network isolation or introducing a separate credential-broker/egress subsystem.

OB-002C explores the safer alternative: a **credential-free local inference execution tier** that preserves the existing no-network sandbox boundary.

The target is not "run any local AI". The target is narrowly:

> Execute the canonical OB-002 `CODE_BUILD` proof task through the existing VITO governed path using a locally hosted/model-resident inference backend that does not require Internet access or reusable cloud-provider credentials inside the sandbox.

---

## 2. Non-negotiable invariants

OB-002C MUST preserve all of the following:

- Bubblewrap network namespace isolation remains enabled (`--unshare-net`).
- No cloud/provider API key is mounted, copied, injected, or exposed inside the sandbox.
- No arbitrary host network access is added.
- No caller-controlled executable path, model path, repository URL, base ref, shell command, or sandbox flag is introduced.
- Existing machine identity, tenant binding, policy evaluation, trusted executable resolution, repository registry, workspace provisioning, patch capture, retention, cleanup, and idempotency semantics remain authoritative.
- Git commit, push, merge, rebase, and branch deletion remain denied.
- The first task remains the existing documentation-only proof file from OB-002.

If any candidate local-inference path requires weakening one of these invariants, STOP and report the blocker.

---

## 3. Architecture principle

A host-local inference server listening on `127.0.0.1` is **not sufficient** because the agent executes in a separate network namespace. A correct OB-002C solution must put the inference transport on a channel reachable **inside the same sandbox namespace** without granting general network access.

Preferred architecture order:

1. **Same-sandbox local inference process**: a trusted launcher starts a local inference server and OpenCode inside one Bubblewrap execution, binding only to loopback inside that namespace. Model weights are exposed read-only from a trusted server-owned path.
2. **In-process/local-file provider**: if the installed OpenCode runtime supports a provider that does not require HTTP/TCP at all, that may be used instead, provided the provider implementation and model path are server-owned and credential-free.
3. Any other mechanism requires a new architecture review.

A host-side HTTP server that requires removing `--unshare-net`, host networking, slirp/pasta, bridged interfaces, NAT, or arbitrary TCP egress is explicitly out of scope.

---

## 4. Phase 0 — empirical feasibility investigation (mandatory before code)

The builder MUST first inspect the actual workstation and installed software. No implementation is authorized until this evidence is collected.

### 4.1 Hardware inventory

Record sanitized output for:

- CPU model and logical cores;
- total RAM and currently available RAM;
- GPU(s), VRAM, driver/runtime availability;
- architecture (`x86_64`, etc.);
- free disk space relevant to model storage.

No hardware purchase is authorized by this milestone.

### 4.2 Local inference runtimes

Check whether any suitable local runtime is already installed or safely available through repository/operator-supported mechanisms, including at minimum:

- `ollama`;
- `llama-server` / `llama.cpp`;
- any OpenCode-supported local provider/runtime already present.

Do not install large runtimes or model weights during investigation without explicit operator approval.

### 4.3 OpenCode compatibility

Empirically determine from the installed OpenCode version and its local docs/config/provider schema:

- which local providers are supported;
- whether a configurable `baseURL` can point to loopback inside the sandbox namespace;
- whether the provider can operate without a reusable credential (or with a non-secret dummy value if the SDK schema syntactically requires one);
- whether the chosen model/provider supports tool use / coding-agent behavior required by OpenCode `run`;
- whether OpenCode can complete a minimal deterministic file-write instruction using that local model.

Do not assume Ollama or OpenAI-compatible behavior without testing the actual installed runtime.

### 4.4 Same-namespace proof

Before modifying VITO, prove manually with a temporary Bubblewrap command that:

1. `--unshare-net` is active;
2. the candidate local inference process starts **inside** that Bubblewrap namespace;
3. OpenCode inside the same namespace can reach it over namespace-local loopback (for example `127.0.0.1:<fixed-port>`);
4. no host/network egress is required;
5. the model completes a trivial bounded prompt;
6. all temporary processes terminate when the Bubblewrap process exits.

The probe must not mutate the VITO repository and must not use cloud credentials.

If this proof fails, STOP. Do not implement VITO changes.

---

## 5. Candidate runtime topology

If Phase 0 passes, the expected production-shaped topology is:

```text
RemoteExecutionWorker
  -> BubblewrapSandboxExecutor
       -> trusted local-agent launcher
            -> start local inference backend on namespace-local loopback
               (trusted binary + trusted read-only model path)
            -> wait for bounded readiness
            -> start OpenCode with server-owned local-provider config
            -> OpenCode performs governed CODE_BUILD task
            -> launcher terminates inference backend on exit/timeout
  -> changed-files + exact patch capture
  -> workspace cleanup
```

The local inference backend and OpenCode must share the same isolated network namespace. The inference backend MUST bind only to loopback unless a stronger mechanism is demonstrated and separately reviewed.

---

## 6. Trusted local model registry

Model identity must be server-owned. The operator request must never contain a filesystem model path.

If implementation is required, introduce the smallest trusted configuration necessary, conceptually:

```text
LocalInferenceProfile {
  profileId
  providerKind
  launcherAlias
  modelId
  trustedModelPath
  contextLimit
  maxParallelism
  enabled
}
```

Rules:

- model path resolves from trusted VITO configuration only;
- model directory is read-only in the sandbox;
- no wildcard model discovery;
- no arbitrary model download at execution time;
- no network-based model pull;
- startup fails closed if binary/model path, ownership, permissions, or expected digest/identity validation fails;
- one explicit profile is sufficient for OB-002C.

A database-backed registry is not required if an immutable server-side configuration is simpler and consistent with current VITO conventions.

---

## 7. Trusted launcher requirements

The trusted launcher is execution infrastructure, not caller-controlled shell authority.

It MUST:

- have a server-resolved executable identity;
- use fixed/server-owned inference binary, model, host, and port values;
- bind inference to namespace-local loopback only;
- use bounded startup and shutdown timeouts;
- ensure child inference process termination on normal exit, OpenCode failure, timeout, or signal;
- not invoke a shell with caller-provided interpolation;
- not consume arbitrary environment variables;
- not expose host credentials;
- not download models/plugins/packages;
- return OpenCode's exit semantics in a deterministic way;
- leave no persistent inference process after sandbox teardown.

If a launcher script is used, it must be treated as a trusted executable artifact and covered by tests/review. Prefer a small typed implementation or fixed argv composition over free-form shell.

---

## 8. Sandbox filesystem exposure

Only the minimum additional read-only paths may be exposed for local inference:

- trusted inference binary and its required runtime libraries;
- trusted model directory/files;
- any fixed tokenizer/config files required by that model/runtime.

The existing writable workspace remains the only writable project state. Model files must never be copied into the worktree.

No user home directory, OpenCode credential directory, SSH directory, package cache, or broad model-directory parent should be mounted merely for convenience.

---

## 9. Execution policy

OB-002A's narrow `CODE_BUILD + BUILDER + LOCAL_TOOL + exact trusted coding-agent alias` policy remains the authority.

OB-002C must not add a general `llama-server`, `ollama`, `python`, `bash`, `sh`, or arbitrary runtime command to caller-visible allowed commands.

If the local inference backend must be started, that should happen **inside the trusted launcher implementation** under server-owned fixed arguments. It is not a separate caller-requested command.

---

## 10. Resource governance

Local inference introduces CPU/GPU/RAM pressure and therefore requires explicit bounded resource behavior.

At minimum:

- one concurrent local inference execution for OB-002C unless evidence supports more;
- bounded model context/token output;
- existing task duration budget remains authoritative;
- launcher readiness timeout must be materially shorter than total task timeout;
- inference process must terminate on parent death;
- OOM or model startup failure must produce a terminal governed failure, not hang indefinitely.

Do not claim strong cgroup/GPU isolation unless it is actually implemented and tested. OB-002C may use coarse single-flight concurrency for the first proof.

---

## 11. Model quality gate

The objective is not benchmark leadership. The local model must only be capable enough to satisfy the canonical acceptance task reliably.

Before integration, run the candidate model through at least five repetitions of a bounded temporary-workspace task equivalent to:

```text
Create exactly one specified markdown file with exactly specified content.
Make no other changes.
```

PASS criterion: 5/5 produce exactly the requested mutation and no unrelated file changes within the configured timeout.

If no available model can satisfy this trivial gate reliably on current hardware, STOP and report hardware/runtime constraints. Do not degrade the OB-002 acceptance criteria.

---

## 12. Implementation authorization boundary

Only after Phase 0 and the model-quality gate both PASS is implementation authorized.

Expected implementation may include only the smallest necessary changes to:

- trusted executable / local inference profile configuration;
- trusted launcher implementation/artifact;
- Bubblewrap read-only bind configuration for exact trusted model/runtime paths;
- adapter/provider metadata required to select the local provider server-side;
- tests and `.env.example`/operator documentation for non-secret local inference configuration;
- OB-002 acceptance documentation after a real successful run.

Do not refactor unrelated runtime layers.

If more than a narrow launcher/config/bind delta is required, STOP for architecture review.

---

## 13. Tests required

If implementation proceeds, tests must cover at minimum:

1. cloud credentials are not required or forwarded;
2. `--unshare-net` remains present;
3. model and inference binary paths are server-owned and cannot be caller overridden;
4. model path is read-only;
5. unexpected model/runtime path fails closed;
6. inference backend binds namespace-local loopback only;
7. launcher kills child inference process on success, failure, timeout, and signal;
8. arbitrary environment and command injection remain denied;
9. existing OB-001/002/002A security tests remain green;
10. canonical real-flow harness passes with the local provider;
11. idempotent replay does not run the provider twice;
12. conflicting replay fails closed;
13. workspace disposition remains `CLEANED`;
14. exact changed file and governed patch are returned.

---

## 14. Acceptance evidence

OB-002C succeeds only if a real end-to-end run demonstrates:

```text
Operator Bridge
 -> VITO governed routing/policy
 -> Bubblewrap with --unshare-net
 -> trusted OpenCode/local-inference launcher
 -> local model execution with no cloud credential
 -> exactly one canonical proof file mutation
 -> exact governed patch
 -> workspace cleanup
 -> idempotent replay proof
 -> conflict replay proof
```

Acceptance report must include sanitized versions/runtime/model/hardware identifiers, duration, task status, provider identity, changed files, patch verification, workspace disposition, and proof that no Internet/provider credential was used.

---

## 15. Decision after investigation

The builder must return one of exactly three outcomes:

### PASS — local tier feasible

The workstation supports a credential-free local model path that works inside the unchanged network-isolated sandbox. Proceed with the narrow authorized implementation.

### BLOCKED — hardware/model capability

The architecture is technically valid but current workstation resources or available model quality are insufficient. Report exact RAM/VRAM/runtime/model requirement and stop; do not buy hardware automatically.

### BLOCKED — runtime topology

The installed OpenCode/local runtime cannot operate with an inference backend inside the same network-isolated sandbox without broader authority. Stop and recommend a separately designed execution tier or credential-broker/egress architecture.

---

## 16. Strategic note

A successful local inference tier is valuable beyond OB-002. It creates a sovereign execution class for VITO tasks where confidentiality, offline operation, deterministic network isolation, or cloud independence matters more than maximum model capability.

It should not automatically replace cloud models for all future work. Future VITO architecture may intentionally maintain multiple governed execution tiers, for example:

```text
LOCAL_ISOLATED   -> no network, no cloud credentials, local inference
CLOUD_MEDIATED   -> future reviewed egress/credential broker
HUMAN_EXTERNAL   -> operator-controlled external tooling
```

Only `LOCAL_ISOLATED` is in scope here.

---

## 17. Architecture verdict

**PASS WITH INVESTIGATION-FIRST AUTHORIZATION.**

No VITO runtime implementation is authorized until the empirical same-sandbox local-inference proof and 5/5 model-quality gate pass. The builder must stop rather than weaken `--unshare-net`, inject cloud credentials, or reduce OB-002 acceptance criteria.
