# VITO PLATFORM · AGENT ENTRYPOINT

## Repository role

This repository is the **VITO implementation / Execution Intelligence platform**.

Before cross-repository, architecture-sensitive, security-sensitive or contract-changing work, read:

1. `lavolpeofficial/la-volpe-canon/LA_VOLPE_SYSTEM_INDEX.md`
2. `lavolpeofficial/la-volpe-canon/REPOSITORY_REGISTRY.md`
3. `lavolpeofficial/la-volpe-canon/AGENT_BOOTSTRAP.md`
4. this repository's `README.md`
5. relevant ADRs/design documents
6. current code, schema and tests

## Repository boundary

VITO owns:

- organizations and tenant execution context
- users and digital employees
- capabilities and tasks
- workforce orchestration
- execution permissions/security boundary
- audit events
- execution-side APIs and adapters when approved

VITO does not own:

- AOE orientation/decision logic
- OSSERVATORE external research/evidence truth
- LA VOLPE ecosystem Canon
- customer-facing white-label product strategy
- CRM/ERP product scope

## Core rule

> **VITO executes approved decisions. It does not independently redefine them.**

AOE = Internal Intelligence.  
OSSERVATORE = External Intelligence.  
VITO = Execution Intelligence.

## Security rule

Security, tenant isolation, authentication/authorization and external-system access are protected areas.

Do not weaken existing security boundaries, production guards, auditability or tenant isolation to simplify implementation.

Before adding a sensitive external adapter, follow the repository's ADR/security requirements and explicit approval gates.

## Cross-repo contracts

If a change modifies the contract between VITO and AOE, OSSERVATORE, Orientation Systems or VIA, record the contract impact explicitly and update the owning architecture/governance source where required.

Code reality establishes what VITO currently implements; Canon and adopted architecture establish what VITO is allowed and intended to implement.