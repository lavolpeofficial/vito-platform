# VITO Engineering Autopilot Contract v1

Status: inactive architecture contract. This document does not activate a runtime worker or grant CODE_BUILD approval.

## Purpose

Remove repetitive operator confirmations for reversible engineering work while preserving Sovereign Authority over irreversible or production-affecting actions.

## Autonomous engineering envelope

Within an explicitly assigned repository and mission, VITO may autonomously inspect repository/CI state, perform root-cause analysis, edit code on isolated `feat/*` branches, run tests, create or update draft pull requests, read CI evidence, fix failed tests, and repeat the build/test/package/draft-PR/CI loop.

Every mutation must remain tenant-, mission-, repository- and feature-branch-scoped. CI evidence must be obtained from authoritative server-owned GitHub data and correlated to the exact head SHA. Caller-supplied approval or CI booleans are not authoritative evidence.

## Hard human gates

The autonomous envelope never permits merge to `main`, production deployment, provider activation, capability activation, approval of a Human Gate, or conversion of a general standing instruction into a concrete CODE_BUILD authorization.

A concrete self-build execution still requires its separately authenticated CODE_BUILD approval. That approval is scoped and consumable; it is not inferred from chat phrases such as `go`, from this document, or from prior approvals for other executions.

## Loop

`PLAN -> BUILD -> TEST -> PACKAGE -> FEATURE_BRANCH -> DRAFT_PR -> CI_READ -> FIX/REPEAT -> HUMAN_GATE`

The loop may repeat automatically before `HUMAN_GATE`. Failures are handled root-cause-first. If authoritative evidence is missing or ambiguous, execution fails closed and records the blocker rather than widening permissions.

## Escalation conditions

Escalation is required only when the next action crosses a hard human gate, changes governance, requires credentials/authorization that are not already available, cannot be made safely within the assigned scope, or remains blocked after bounded automated recovery.

## Activation prerequisites

Runtime activation requires authoritative approval persistence and revocation/consumption semantics, transactional audit and idempotency, a tenant-bound GitHub mutation adapter, immutable branch/PR/head-SHA/CI correlation, negative integration tests, and a real non-production E2E proof. Until those prerequisites are implemented and separately approved, this contract is documentation plus policy/test scaffolding only.
