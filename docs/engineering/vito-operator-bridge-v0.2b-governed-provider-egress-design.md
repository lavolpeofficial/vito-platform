---
record_type: architecture-design
record_id: VITO-OB-002B
title: "Operator Bridge v0.2B — Governed Provider Egress"
system: vito-platform
subsystem: remote-execution-worker
status: PROPOSED
created: 2026-08-29
updated: 2026-08-29
author: VITO Engineering
review_gate: ARCHITECTURE_REVIEW
related_branch: design/vito-operator-bridge-v0.2b-governed-provider-egress
baseline:
  branch: feat/vito-operator-bridge-v0.2a-runtime-compatibility
revision: 1
---

# VITO Operator Bridge v0.2B — Governed Provider Egress

## 1. Trigger

The OB-002 real-provider acceptance path now reaches the trusted OpenCode launcher inside the Bubblewrap sandbox. The run then stalls because the sandbox is created with `--unshare-net`, while the selected real coding provider (`build · big-pickle`) is a hosted inference service and therefore requires outbound network access.

This is a legitimate architecture stop. The acceptance criteria must not be weakened and the sandbox must not be switched to unrestricted networking.

## 2. Goal

Introduce a narrowly governed provider-egress mechanism that allows a trusted local coding agent to reach only explicitly approved inference endpoints while preserving all other sandbox and execution controls.

Target property:

```text
Coding agent in Bubblewrap
  -> approved provider egress boundary
  -> explicitly allowed model/provider destination(s)

Coding agent in Bubblewrap
  -X-> arbitrary internet
  -X-> arbitrary LAN
  -X-> operator-selected proxy
  -X-> operator-selected DNS target
```

## 3. Non-goals

OB-002B MUST NOT:

- remove `--unshare-net` and give the sandbox host networking;
- set `VITO_SANDBOX_TECHNOLOGY=none`;
- permit arbitrary outbound TCP/UDP;
- permit caller-supplied domains, IPs, proxies, CA bundles, DNS servers, or sockets;
- expose host credentials or provider secrets directly to the sandbox unless a separately governed credential path already exists;
- broaden CODE_BUILD to arbitrary shell/network authority;
- change repository, base-ref, executable, tenant, or machine-scope authority;
- introduce git commit/push/merge authority;
- declare the real-flow acceptance successful without an actual provider roundtrip.

## 4. Architecture Decision

### Decision A — Keep the sandbox network namespace isolated

Bubblewrap retains `--unshare-net`.

The sandbox does not receive general host networking. Instead, outbound model traffic must traverse a dedicated, trusted egress mediator exposed to the sandbox through a deliberately mounted local IPC endpoint.

Preferred v0.1 mechanism:

```text
Sandboxed OpenCode
  -> Unix-domain socket mounted read/write at a fixed sandbox path
  -> host-side VITO Provider Egress Proxy
  -> HTTPS to allowlisted provider origins
```

Rationale:

- preserves network namespace isolation;
- avoids arbitrary DNS/network access from the sandbox;
- allows destination policy to remain server-owned;
- gives one auditable choke point for provider egress;
- can enforce request limits, timeouts, destination allowlists, and credential injection outside the sandbox.

A localhost TCP listener alone is insufficient because `--unshare-net` creates an isolated loopback namespace. A Unix socket bind is compatible with continued network namespace isolation and is therefore preferred.

### Decision B — Egress destinations are trusted configuration, never operator input

The egress mediator owns an explicit provider allowlist. Each entry must bind a stable provider key to one or more exact HTTPS origins.

Example conceptual configuration:

```text
providerKey: opencode-zen
allowedOrigins:
  - https://<authoritative-provider-origin>
```

No wildcard domains, CIDRs, arbitrary URLs, redirects to unapproved origins, or request-time destination overrides are allowed.

The actual provider origin used by OpenCode must be discovered from the installed/provider configuration during implementation. The design intentionally does not guess or hard-code a public endpoint name.

### Decision C — Provider credentials remain outside the sandbox

If the hosted provider requires a bearer token, API key, OAuth token, session credential, or equivalent secret, the preferred architecture is host-side credential injection in the egress mediator.

The sandbox should receive only a non-secret local proxy endpoint plus non-sensitive provider-selection metadata.

If OpenCode's client stack cannot operate through such a mediator without possessing a provider credential itself, implementation MUST STOP and report that credential boundary as a new architecture blocker. OB-002B does not authorize mounting the user's OpenCode home, auth database, generic secret files, or host credential stores into the sandbox.

### Decision D — Provider egress is capability/profile scoped

Egress eligibility is conjunctive and must be derived server-side from the trusted invocation context.

Minimum gate:

```text
capability == CODE_BUILD
AND executionProfile == BUILDER
AND provider transport == trusted LOCAL_TOOL coding agent
AND resolved executable == trusted coding-agent alias
AND configured egress provider binding exists
```

If any condition is absent or inconsistent, egress is denied.

Reviewer, unrelated capabilities, arbitrary commands, and untrusted executables receive no provider-egress socket.

### Decision E — Fail closed on mediator failure

The coding task fails if:

- the mediator is unavailable;
- provider mapping is missing;
- the requested destination is not allowlisted;
- a redirect leaves the approved origin set;
- request/response limits are exceeded;
- credential resolution fails;
- TLS verification fails;
- the mediator cannot prove the invocation binding.

There is no automatic fallback to unrestricted networking.

## 5. Required Controls

The provider-egress mediator MUST enforce at least:

1. **Exact origin allowlist** — scheme `https`, exact host, explicit port semantics.
2. **Redirect policy** — deny cross-origin redirects unless the redirect target is separately allowlisted.
3. **TLS verification** — normal certificate verification; no `NODE_TLS_REJECT_UNAUTHORIZED=0`, insecure curl flags, or custom caller CA injection.
4. **Method/body limits** — only methods needed by the coding provider; bounded request body.
5. **Response limits** — bounded headers/body or streaming budget consistent with execution budget.
6. **Timeouts** — connect/read/overall bounds derived from trusted execution budget where applicable.
7. **Credential isolation** — secret material must not be emitted to sandbox stdout/stderr, task patch, or audit payloads.
8. **Auditability** — record provider key, approved origin identifier, bytes/requests, outcome, duration, correlation/invocation identifiers; never log secret values or raw Authorization headers.
9. **No generic CONNECT tunnel** — v0.1 must not expose an unrestricted HTTP CONNECT/SOCKS proxy.
10. **No LAN escape** — reject loopback, link-local, RFC1918/private ranges, metadata-service ranges, and unix/file/gopher/etc. schemes unless an exact separately governed provider architecture later authorizes them.

## 6. Sandbox Integration

Expected production-shaped path:

```text
GovernedInvocation
  -> trusted execution context establishes egress eligibility
  -> RemoteExecutionWorker
  -> BubblewrapSandboxExecutor
       --unshare-net remains
       bind one invocation-scoped Unix socket into sandbox when eligible
       set only the minimum non-secret proxy/client configuration required
  -> OpenCode
       -> egress socket
  -> VITO Provider Egress Proxy
       -> exact approved hosted-provider origin
```

The socket should be invocation-scoped or otherwise strongly bound to invocation identity. Cleanup must remove/invalidate it when the execution completes, fails, or times out.

The socket path itself is server-defined and must not be supplied by the external operator.

## 7. OpenCode Compatibility Investigation

Before implementing code, the builder must determine how the installed OpenCode provider performs hosted inference and whether it supports one of these safe integration modes:

1. explicit HTTP(S) proxy configuration to a Unix-socket-backed mediator;
2. provider base-URL override pointing to a VITO-controlled local mediator;
3. another documented transport override that does not require arbitrary sandbox networking or exposing host credentials.

The builder MUST use the installed runtime/docs/code as evidence and record the exact supported mechanism.

If none exists, STOP. Do not patch OpenCode, monkey-patch TLS/network libraries, bind host network interfaces into the sandbox, or mount its host auth/config home merely to make the acceptance test pass.

## 8. Credential Boundary Investigation

The builder must also identify where the current `build · big-pickle` authentication lives.

PASS conditions for OB-002B architecture remain one of:

- mediator can authenticate upstream without exposing credentials to sandbox; or
- OpenCode uses a non-secret/local authorization mechanism compatible with the mediator and sandbox isolation.

If the only working mode requires copying/mounting reusable hosted-provider credentials into the sandbox, return an architecture blocker for a dedicated credential-broker extension.

## 9. Implementation Scope

Implementation authorization is intentionally conditional.

### Allowed after compatibility evidence is established

- a small provider-egress policy/config contract;
- a host-side egress mediator/proxy owned by VITO;
- invocation-scoped Unix-socket lifecycle;
- minimal Bubblewrap bind/setenv additions necessary to point an eligible trusted coding agent at the mediator;
- tests for destination policy, redirects, private-address rejection, fail-closed behavior, socket cleanup, capability/profile scoping, credential redaction, and preservation of `--unshare-net`;
- `.env.example`/operator documentation for trusted provider-egress configuration, with no secrets committed.

### Not authorized

- generic outbound network support;
- arbitrary HTTP/SOCKS proxying;
- sandbox-visible reusable provider credentials;
- changes to machine-scope auth, tenant isolation, repository authority, git release authority, or Operator Bridge request contract;
- changing the OB-002 canonical proof task or acceptance semantics.

## 10. Acceptance Criteria for OB-002B

OB-002B itself passes only if tests demonstrate:

- `--unshare-net` is still present;
- an ineligible invocation receives no egress endpoint;
- an eligible CODE_BUILD/BUILDER/trusted-coding-agent invocation receives only the governed endpoint;
- unapproved origins fail closed;
- private/LAN/metadata destinations fail closed;
- cross-origin redirects fail closed unless separately allowlisted;
- mediator failure fails the task rather than enabling fallback networking;
- credentials are not present in sandbox environment/log/result payloads where the chosen transport permits host-side injection;
- socket lifecycle is bounded to the execution;
- existing unit/PostgreSQL/E2E/build/typecheck gates remain green.

Then the original **OB-002 real-provider acceptance run must be repeated unchanged**. Only that real run can close OB-002.

## 11. Architecture Review Verdict

**PASS WITH CONDITIONAL IMPLEMENTATION AUTHORIZATION.**

The security model may support hosted coding models without abandoning network isolation, but implementation may proceed only after OpenCode transport and credential behavior are empirically established.

If OpenCode cannot be routed through a VITO-owned allowlisted mediator without exposing reusable credentials or granting arbitrary network access to the sandbox, STOP and return the blocker. The preferred fallback is then a local inference provider or a separately designed credential-broker/egress architecture — not weakening Bubblewrap.
