---
record_type: architecture-design
record_id: VITO-OB-002A
title: "Operator Bridge v0.2A — Real Provider Runtime Compatibility"
system: vito-platform
subsystem: governed-runtime
status: PROPOSED
created: 2026-08-28
updated: 2026-08-28
author: VITO Engineering
review_gate: ARCHITECTURE_REVIEW
related_branch: design/vito-operator-bridge-v0.2a-runtime-compatibility
parent_milestone: VITO-OB-002
baseline:
  branch: feat/vito-operator-bridge-v0.2-first-real-flow
revision: 1
---

# VITO-OB-002A — Real Provider Runtime Compatibility

## 1. Trigger

VITO-OB-002 real-provider bring-up correctly stopped before execution. Two independent fail-closed controls currently contradict the intended production-shaped `CODE_BUILD` path:

1. `buildGovernedExecutionEnvironment()` emits governed execution metadata (`EXECUTION_TIMEOUT_MS`, `EXECUTION_MAX_TOKENS`, `EXECUTION_MAX_COST_MINOR_UNITS`, `CAPABILITY_CODE`, `PROVIDER_ID`, `ORGANIZATION_ID`, `WORKFLOW_RUN_ID`, `WORKFLOW_STEP_RUN_ID`, `CORRELATION_ID`, `INVOCATION_ID`), while `RemoteExecutionWorker` currently permits only `PATH`, `USER`, `LANG`, and `LC_ALL` as caller-supplied sandbox variables.
2. The builder execution policy allows ordinary build/test/git commands but does not authorize the trusted coding-agent command alias required by the real headless `CODE_BUILD` provider, so the invocation is rejected as `COMMAND_NOT_ALLOWED` before provider execution.

The purpose of OB-002A is to remove these **contract mismatches without weakening the security model**.

No change in this record may create general shell authority, arbitrary environment forwarding, network access, caller-selected executable paths, caller-selected providers, or repository/base-ref authority.

---

## 2. Verified Current-State Evidence

### 2.1 Governed invocation environment

The governed invocation service constructs a server-owned environment map containing budget and correlation metadata. These values are not caller-controlled executable authority; they are derived from trusted request context, routing, policy, and identifiers.

Current keys:

```text
EXECUTION_TIMEOUT_MS
EXECUTION_MAX_TOKENS
EXECUTION_MAX_COST_MINOR_UNITS
CAPABILITY_CODE
PROVIDER_ID
ORGANIZATION_ID
WORKFLOW_RUN_ID
WORKFLOW_STEP_RUN_ID
CORRELATION_ID
INVOCATION_ID
```

### 2.2 Sandbox boundary

The worker distinguishes:

- system-managed sandbox variables (`HOME`, `TMPDIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`), which callers must never override; and
- caller-permitted variables, currently only `PATH`, `USER`, `LANG`, `LC_ALL`.

All other keys fail closed with `ENV_NOT_ALLOWED`.

This fail-closed behavior is correct. The mismatch is that upstream governed code intentionally supplies keys the downstream sandbox contract does not recognize.

### 2.3 Builder policy

The current builder policy uses an explicit `allowedCommands` list. It authorizes git inspection, package-manager build/test/lint commands, TypeScript/lint/test tools, and Prisma generation. It does not authorize the trusted coding-agent launcher/alias required for the configured `CODE_BUILD` provider.

The explicit allowlist model is correct. The mismatch is that the platform has a real coding-provider path whose trusted launcher cannot be represented by the current profile.

---

## 3. Architecture Decision A — One Shared Governed Sandbox Environment Contract

### 3.1 Principle

There must be **one authoritative set of caller-permitted sandbox environment keys** for governed execution metadata. Upstream and downstream modules must consume the same contract rather than maintaining independent lists.

### 3.2 Required classification

Environment variables must remain separated into three classes:

**A. System-managed sandbox keys** — created by the executor and never caller-overridable:

```text
HOME
TMPDIR
XDG_CONFIG_HOME
XDG_CACHE_HOME
```

**B. Minimal process-compatibility keys** — explicitly permitted from the trusted adapter boundary:

```text
PATH
USER
LANG
LC_ALL
```

**C. Governed execution metadata keys** — server-generated execution context that the governed invocation layer is allowed to forward:

```text
EXECUTION_TIMEOUT_MS
EXECUTION_MAX_TOKENS
EXECUTION_MAX_COST_MINOR_UNITS
CAPABILITY_CODE
PROVIDER_ID
ORGANIZATION_ID
WORKFLOW_RUN_ID
WORKFLOW_STEP_RUN_ID
CORRELATION_ID
INVOCATION_ID
```

No prefix wildcard such as `EXECUTION_*` is permitted. The list must be exact.

### 3.3 Authoritative ownership

The shared contract should live at the lowest reusable trust-boundary layer that both governed invocation and RemoteExecutionWorker can import without circular dependencies. Preferred options, in order:

1. `@vito/contracts` if the constants are appropriately platform-contractual; or
2. a small dedicated internal shared module imported by both runtime components.

The builder must not duplicate the same key list in multiple modules.

### 3.4 Validation invariant

The sandbox executor must continue to reject every non-system key not present in the exact allowlist.

Required invariant:

> `request.env.keys ⊆ PROCESS_COMPATIBILITY_KEYS ∪ GOVERNED_EXECUTION_METADATA_KEYS`

and:

> `request.env.keys ∩ SANDBOX_SYSTEM_MANAGED_ENV = ∅`

Any unknown key remains `ENV_NOT_ALLOWED`.

### 3.5 Secret boundary

None of the newly recognized governed metadata keys may carry credentials, tokens, API keys, raw user secrets, repository credentials, or host environment passthrough.

This change is **not** permission to forward arbitrary `process.env` values.

---

## 4. Architecture Decision B — Dedicated Trusted Coding-Agent Command Authorization

### 4.1 Principle

`CODE_BUILD` needs authority to start the server-selected trusted coding-agent launcher, but this must not become arbitrary `RUN_COMMAND` or shell authorization.

The policy must authorize **an exact trusted command alias/launcher identity**, not arbitrary command text supplied by the operator prompt.

### 4.2 Existing trust chain remains authoritative

The permitted path remains:

```text
Operator intent
 -> capabilityCode = CODE_BUILD
 -> ProviderRouter selects provider
 -> provider metadata supplies trusted command alias
 -> TrustedExecutableResolver resolves alias to a trusted executable
 -> ExecutionPolicy evaluates the requested command
 -> HeadlessLocalAgentAdapter invokes only the resolved executable
```

The external operator still cannot supply executable path, launcher path, shell string, provider ID, repository URL, base ref, or sandbox flags.

### 4.3 Minimal policy shape

Do **not** add broad values such as:

```text
bash
sh
node
npx
opencode *
RUN_COMMAND
*
```

to the generic builder allowlist.

Instead, implementation must choose one of these narrowly scoped patterns:

**Preferred:** capability/profile-specific policy addition where the resolved `CODE_BUILD` provider's exact trusted command alias is added to the builder policy only for that governed invocation.

**Acceptable:** a dedicated coding-agent execution policy/profile whose allowed command set contains only the exact trusted coding-agent alias plus the existing safe builder commands required by that profile.

The command authorization source must be server-owned and must match the trusted executable resolver's declared alias. It must not be derived from prompt text.

### 4.4 Command comparison

Policy comparison must remain deterministic and fail closed. If the configured provider refers to an alias absent from the trusted executable registry or absent from the capability-specific policy, execution fails.

A mismatch must not fall back to generic shell execution.

### 4.5 Network and secret policy unchanged

Authorizing the trusted coding-agent launcher does **not** imply:

- `allowNetwork = true`;
- `allowSecrets = true`;
- git commit/push/merge/rebase authority;
- broader filesystem access;
- host-shell access.

The Bubblewrap network isolation requirement remains unchanged for OB-002.

---

## 5. Separation of Responsibilities

The corrected path must preserve these owners:

| Decision | Authority |
|---|---|
| capability | Operator intent, validated server-side |
| provider | ProviderRouter |
| executable alias | trusted provider declaration |
| executable path | TrustedExecutableResolver |
| command authorization | ExecutionPolicyResolver / policy evaluation |
| repository | RepositoryRegistry |
| base ref | RepositoryRegistry |
| workspace | governed workspace resolver/provisioner |
| env metadata | GovernedInvocation |
| env acceptance | shared sandbox-env contract + SandboxExecutor |
| sandbox technology | governed sandbox config |
| credentials | CredentialBroker / external operator credential boundary |

No responsibility should be collapsed into the smoke harness.

---

## 6. Implementation Scope

Expected production-code surface is small and must be limited to the two compatibility defects plus tests/documentation.

Likely affected areas:

```text
packages/contracts/...                         # if shared env contract belongs here
apps/api/src/modules/governed-invocation/...   # consume shared env contract / policy context
apps/api/src/modules/remote-execution-worker/types.ts
apps/api/src/modules/remote-execution-worker/...spec.ts
packages/contracts/src/engineering/execution-policy.ts
packages/contracts/src/engineering/...spec.ts
apps/api/src/modules/governed-invocation/...spec.ts
.env.example                                   # document required runtime configuration if appropriate
```

The implementation must **not** redesign Operator Bridge, authentication, provider routing, worktree provisioning, sandbox technology, persistence, idempotency, or result retention.

If the real trusted-provider invocation requires network access or credential injection inside the Bubblewrap sandbox, that is a **new architecture blocker** and must STOP for separate review; it is not authorized by OB-002A.

---

## 7. Required Tests

### 7.1 Environment contract tests

Tests must prove:

1. every governed execution metadata key emitted by `buildGovernedExecutionEnvironment()` is accepted by the sandbox boundary;
2. all system-managed keys remain caller-non-overridable;
3. an unknown variable such as `EVIL_TOKEN` or `LD_PRELOAD` is rejected fail-closed;
4. no host environment is implicitly copied into sandbox env;
5. additions/removals to the governed metadata set cause contract-drift tests to fail if upstream/downstream disagree.

### 7.2 Command policy tests

Tests must prove:

1. ordinary existing safe builder commands remain allowed as before;
2. the exact trusted coding-agent alias is allowed only under the intended `CODE_BUILD`/builder policy context;
3. the same alias is not globally authorized for unrelated capability contexts unless explicitly designed;
4. arbitrary shell commands remain blocked;
5. arbitrary executable paths remain impossible through policy input;
6. an unregistered/mismatched coding-agent alias fails closed;
7. network/secrets/git-release permissions remain false.

### 7.3 Regression gates

The full existing unit, contracts, PostgreSQL Operator Bridge gate, composed E2E, typecheck, build, and `git diff --check` gates must remain green.

---

## 8. Acceptance Sequence

After implementation passes automated gates:

1. return to the existing OB-002 operator harness;
2. provision/identify the machine MEMBER identity with exact `machineScope=vito-bridge`;
3. configure the existing trusted repository registry and trusted coding provider/executable values;
4. start Postgres and VITO API;
5. run `npm run operator-bridge:real-flow`;
6. verify the actual real provider traverses the governed path;
7. require exactly the intended proof-file change, exact patch, idempotency behavior, and `workspaceDisposition=CLEANED`;
8. sanitize and commit acceptance evidence only after the real run succeeds.

OB-002 remains incomplete until this acceptance succeeds.

---

## 9. Security Non-Regression Invariants

The following are non-negotiable:

- no arbitrary env passthrough;
- no wildcard env-prefix authorization;
- no operator-controlled executable path;
- no operator-controlled provider ID;
- no general shell command permission;
- no network enablement;
- no secret enablement;
- no git commit/push/merge/rebase permission;
- no repository/base-ref selection by external caller;
- Bubblewrap remains mandatory for the real acceptance run;
- every newly permitted value is explicit, server-owned, test-covered, and auditable.

---

## 10. Architecture Review Verdict

**SOL ARCHITECTURE VERDICT: PASS WITH NARROW IMPLEMENTATION AUTHORIZATION**

The two blockers are genuine internal contract mismatches, not reasons to weaken governance. The minimal safe correction is:

1. define and consume one exact shared governed sandbox-environment contract; and
2. authorize the exact server-selected trusted coding-agent alias in a capability/profile-scoped policy path rather than broadening the generic command surface.

No other runtime expansion is authorized.

### Implementation authorization

Pickle may implement **only** the compatibility delta defined in this record and the required regression tests/documentation. If implementation discovers a requirement for network access, sandbox credential injection, arbitrary shell execution, or a larger runtime redesign, it must STOP and report the blocker.
