# ADR-005: Multi-Agent Platform Boundaries

- Status: Accepted
- Date: 2026-07-30

## Context

VITO is evolving from a CRUD-oriented backend for organizations, Digital Employees, capabilities and tasks into a governed Digital Workforce Platform. Future requirements include multiple Digital Employees, organization-specific orchestrators, different memory types, external connectors, background execution and multiple persistence technologies.

Introducing microservices or several databases immediately would increase operational complexity before load and isolation requirements are known. Keeping all concerns in the existing modules without explicit boundaries would create the opposite risk: orchestration, execution, memory and infrastructure would become tightly coupled.

## Decision

VITO remains a modular NestJS monolith for the current product phase.

The following architectural boundaries are mandatory:

1. `orchestration` owns routing, delegation, coordination and escalation policy.
2. `agent-runtime` owns Agent Runs, Agent Sessions, execution lifecycle and runtime state.
3. `workflows` owns governed multi-step process definitions and progress.
4. `memory` owns working, episodic and semantic memory policies.
5. `knowledge` owns references to governed organizational knowledge and retrieval coordination.
6. `connectors` own external-system authentication and transport adapters.
7. `tools` own the controlled actions exposed to Digital Employees.
8. `performance-ledger` owns measurable operational performance records.
9. `audit` remains the immutable accountability trail and is not replaced by the Performance Ledger.
10. Vendor-specific persistence implementations remain behind stable platform ports.

PostgreSQL is the initial system of record. pgvector is the preferred initial vector capability. Redis, object storage, a dedicated vector database and an event store are introduced only when supported by measured requirements.

## Consequences

### Positive

- Existing deployment and transaction simplicity is preserved.
- Domain boundaries are explicit before additional runtime complexity is introduced.
- Agent execution can later move to workers without rewriting domain contracts.
- Storage technology can evolve behind ports.
- Multi-tenant enforcement and auditing stay consistent.

### Negative

- Developers must actively prevent cross-module shortcuts.
- Some contracts exist before full concrete implementations.
- A modular monolith does not provide process-level fault isolation.

## Guardrails

- Every persistence query and retrieval request carries `organizationId`.
- Digital Employees never call infrastructure SDKs directly.
- Tools require capability authorization before execution.
- High-impact actions require an approval policy.
- Credentials must not enter prompts, task payloads, audit metadata or agent memory.
- Cross-tenant retrieval returns no information about the existence of foreign records.

## Revisit conditions

Reconsider service extraction when at least one of these is demonstrated:

- independently scaling Agent Runtime workers are required;
- connector isolation is required for security or availability;
- workflow execution exceeds acceptable API-process resource use;
- a persistence workload has materially different scaling or compliance needs;
- release cadence between modules becomes an operational bottleneck.
