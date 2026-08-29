---
record_type: implementation-review
record_id: VITO-OB-002D-FLIGHT-001
title: "Operator Bridge v0.2D — Flight 001 Evidence Review"
system: vito-platform
subsystem: operator-bridge / governed-runtime / cloud-governed-execution
status: PASS_WITH_HARDENING_FINDING
created: 2026-08-29
updated: 2026-08-29
author: VITO Engineering
review_gate: IMPLEMENTATION_REVIEW
related_branch: feat/vito-operator-bridge-v0.2d-governed-cloud-execution-tier
reviewed_head: "ea23307543d20db1c3a40177d4b3c64a7af12d23"
revision: 1
---

# VITO Operator Bridge v0.2D — Flight 001 Evidence Review

## 1. Verdict

**Flight 001 — adapter-boundary acceptance: PASS.**

The real governed cloud execution path completed successfully with a real trusted launcher, real cloud-model invocation, a governed ephemeral workspace, exact change-set capture, and credential/session cleanup. No merge or PR was performed.

This PASS is intentionally scoped to the **adapter-boundary Flight 001** selected for the first cloud-governed acceptance run. It does not yet claim the separate full database-seeded AgentWorkforce top-to-bottom dispatch path.

## 2. Observed governed path

The acceptance evidence demonstrates the following production-shaped path:

```text
server-owned cloud profile / governed credential
 -> CloudGovernedAgentAdapter
 -> CLOUD_EXECUTION_WORKER path
 -> GitWorkspaceProvisioner / governed ephemeral worktree
 -> CloudGovernedSandboxExecutor
 -> trusted launcher /usr/local/lib/vito-agent-launchers/opencode
 -> real cloud model invocation
 -> exact bounded documentation mutation
 -> authoritative changed-files / patch capture
 -> cleanup
```

## 3. Acceptance evidence

Observed PASS evidence includes:

- credential teardown: `credentialDisposition=removed`;
- no residual flight files/processes after cleanup;
- temporary session/scaffold state removed after the run;
- repository registry restricted to the intended repository;
- `allowedBaseRefs=["main"]`;
- trusted executable resolved from the root-owned launcher path;
- exact canonical proof mutation completed through the real cloud execution boundary;
- no unrelated mutations remained;
- post-flight API suite: 640 passed, 2 skipped;
- post-flight contracts: 260/260 passed;
- working tree clean after the temporary flight harness was removed;
- no PR opened and no merge performed.

## 4. Credential/provider evidence

The provider probe produced important evidence about the installed OpenCode runtime:

- with the materialized governed credential in the ephemeral session HOME, the launcher selected the intended OpenAI provider path;
- with the governed credential absent in a drained session, the launcher could still fall back to its embedded `opencode/big-pickle` provider capability.

Therefore the governed credential was demonstrated to influence/select the intended provider path for Flight 001, but the trusted launcher binary itself retains an independent embedded cloud-provider capability.

## 5. MEDIUM hardening finding — provider identity postcondition

**Finding ID: OB002D-MEDIUM-PROVIDER-IDENTITY**

A successful `CLOUD_GOVERNED` task must not satisfy acceptance merely because the trusted launcher returned success. The actual provider/model identity used by the coding agent must match the server-authorized cloud execution profile (or an explicitly server-approved equivalent mapping).

Without this postcondition, an embedded/fallback provider such as `opencode/big-pickle` could theoretically execute successfully after the authorized provider credential is unavailable, creating a provider-authority mismatch while the task still appears successful.

Required correction before merge:

1. Server-owned cloud profile must declare the expected provider identity (and, where enforced, allowed model identity/pattern).
2. Cloud execution evidence must expose a sanitized machine-readable provider/model identity from the agent execution path.
3. The trusted cloud adapter/executor must fail closed if the observed provider identity does not match the server-authorized profile.
4. Missing provider-identity evidence must fail closed for Flight 001 / governed cloud acceptance; it must not be silently accepted.
5. Tests must cover:
   - expected provider identity -> PASS;
   - embedded/fallback provider -> fail closed;
   - missing/ambiguous identity -> fail closed;
   - operator/caller cannot override expected provider identity;
   - no credential values appear in provider-identity evidence or terminal errors.
6. The correction must not disable or mutate the launcher's embedded provider globally; VITO must simply refuse to accept a result executed through an unauthorized provider identity.

## 6. Open findings

- BLOCKER: 0
- HIGH: 0
- MEDIUM: 1 (`OB002D-MEDIUM-PROVIDER-IDENTITY`)

The earlier cleanup MEDIUM is closed by commit `ea23307543d20db1c3a40177d4b3c64a7af12d23`.

## 7. Merge gate

**Do not merge OB-002D yet.**

Required sequence:

1. implement the narrow provider-identity postcondition;
2. run deterministic security tests plus the existing contract/API/build gates;
3. independent delta review;
4. rerun Flight 001 through the authorized provider and verify provider identity;
5. then open PR / CI / merge / post-merge verification.
