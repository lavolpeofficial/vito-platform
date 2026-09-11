# ADR-011 · CUSTOS autonomy governance kernel

**Status:** Proposed for implementation review  
**Date:** 2026-09-11  
**Owner:** VITO execution/security boundary

## Context

LA VOLPE wants high agent autonomy without granting broad, persistent authority. Human approval on every internal step would destroy throughput; unrestricted agent permissions would create unacceptable blast radius.

VITO already owns execution permissions, orchestration and auditability. The existing Governed Runtime provides trusted server-side execution context, operation envelopes and execution records. CUSTOS is therefore introduced as a deterministic authorization kernel in front of execution boundaries, not as another autonomous agent and not as a replacement for the existing runtime/audit layer.

## Decision

CUSTOS applies the following invariant model:

1. **Autonomy is separate from authority.**
2. **A0-A2 is the fast zone**: observe, think and reversible experimentation run autonomously inside a pre-authorized envelope.
3. **A3 is bounded productive action** inside an active mission-bound envelope.
4. **A3-E is emergency containment only** and may preserve/freeze/rollback state but must not expand authority.
5. **A4 requires explicit human approval.**
6. **Default deny / least privilege** applies outside an active envelope.
7. **Purpose binding**: an envelope is bound to actor + mission + capability + resource + environment + expiry.
8. **Capability ceiling**: child/subagent authority may never exceed parent authority.
9. **Bounded scaling**: worker count is limited by the mission envelope; scaling does not create new authority.
10. **Governance mutation is denied** to agents regardless of autonomy level.
11. **Privileges decay** through mandatory envelope expiry rather than persistent elevation.
12. **Fail closed** on invalid, expired or mismatched envelopes.

## Speed principle

> Maximum freedom inside the space. Maximum hardness at the boundary.

CUSTOS must not synchronously micromanage every internal reasoning step. The fast path is established by issuing a bounded autonomy envelope once and allowing repeated A0-A2 actions inside it. Boundary transitions and externally consequential operations are the points where authorization is enforced.

Future implementation may cache identical low-risk decisions for a short TTL, provided the cache key includes actor, mission, capability, resource scope, environment and policy version.

## Security boundaries

CUSTOS must never be able to autonomously:

- rewrite the LA VOLPE Constitution or Root of Trust;
- grant itself new privileges;
- disable or delete audit history;
- issue unrestricted permanent credentials;
- convert agent consensus into governance authority.

The Root of Trust and kill authority remain external to autonomous agents and to CUSTOS policy evaluation.

## Emergency authority

A3-E is restricted to containment actions:

- STOP
- ISOLATE
- FREEZE
- BACKUP
- FAILOVER
- ROLLBACK
- REVOKE_TEMPORARY_ACCESS
- RATE_LIMIT

Emergency authority must minimize state change. Destructive deletion, privilege expansion, financial transfers, contracts, Constitution changes and disabling CUSTOS/audit are never implied by A3-E.

## Initial implementation

`apps/api/src/modules/custos/` contains the deterministic v0.1 policy kernel:

- `custos.types.ts` — autonomy levels, mission envelope and decision contracts;
- `custos.service.ts` — fail-closed authorization engine;
- `custos.service.spec.ts` — invariant tests;
- `custos.module.ts` — global Nest module for later runtime integration.

The first increment deliberately does **not** weaken or rewrite existing Governed Runtime controls and does not introduce production deployment authority, new external adapters or permanent credentials.

## Follow-up

Before wiring CUSTOS as a mandatory gate on existing production-capable execution paths, define explicit capability profiles for VITO, TIMO, RICCARDO, CONTE, AOE and OSSERVATORE and map existing runtime actions to those capabilities. Integration must preserve current tenant isolation, JWT security and audit persistence.
