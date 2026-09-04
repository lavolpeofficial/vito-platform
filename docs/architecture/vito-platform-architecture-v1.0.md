# VITO Platform Architecture v1.0

- Status: Canonical
- Version: 1.0
- Date: 2026-07-30
- Scope: VITO Digital Workforce Platform
- Repository: `lavolpeofficial/vito-platform`

## 1. Purpose

This document is the canonical architectural reference for the VITO Platform. It defines the system role, boundaries, principles, domain model, execution model, infrastructure strategy, governance rules and evolution path of VITO as a Digital Workforce Operating System.

All future implementation decisions, ADRs, modules, integrations and data models must be compatible with this document or explicitly amend it through a new architectural decision.

This document supersedes preliminary platform descriptions where they conflict with the definitions below. The document `multi-agent-platform-v0.2.md` remains an implementation draft and historical precursor.

## 2. Canonical system definitions

### 2.1 AOE

AOE is the Intelligence Engine of the ecosystem.

AOE is responsible for:

- analysis;
- orientation;
- pattern recognition;
- diagnostic reasoning;
- decision logic;
- recommendations;
- learning from decision outcomes.

AOE is not the operational workforce and does not own external execution.

### 2.2 VITO

VITO is the organization-specific Digital Workforce instance of LA VOLPE.

VITO is not a single assistant. VITO is not merely an orchestrator. VITO comprises:

- one organization-specific workforce instance;
- one VITO Orchestrator;
- specialized Digital Employees;
- policies, capabilities, workflows and tools;
- operational memory;
- execution, audit and performance mechanisms.

Initial Digital Employees inside VITO are:

- **ANNA** — Executive Assistance, calendar, tasks, projects and follow-ups;
- **SOFIA** — knowledge, documentation and organizational memory;
- **VIOLA** — growth, marketing, visibility, SEO and content.

### 2.3 TIMO

TIMO is the corresponding organization-specific Digital Workforce instance for ATERIMA.

TIMO occupies the same architectural position as VITO but is configured with ATERIMA-specific Company DNA, policies, users, Digital Employees, workflows, tools and connectors.

### 2.4 Digital Workforce Platform

The VITO Platform is the shared software platform that hosts and governs organization-specific workforce instances such as VITO and TIMO.

The platform must support multiple organizations and multiple workforce instances without mixing identity, data, memory, credentials, execution or audit records.

## 3. Architectural thesis

The core architecture is:

```text
Foundation Models
       │
       ▼
AOE — Intelligence Engine
       │
       ▼
VITO Platform — Digital Workforce Operating System
       │
       ├── Workforce Instance
       ├── Orchestrator
       ├── Digital Employees
       ├── Workflows
       ├── Tools and Connectors
       └── Governed Execution
```

AOE determines what is likely to be understood, decided or recommended. VITO determines who should act, under which policy, with which capability, using which tool, and with what level of approval and accountability.

The separation between intelligence and workforce execution is mandatory.

## 4. Architecture goals

The platform is designed to achieve the following goals:

1. Host organization-specific Digital Workforces.
2. Coordinate multiple specialized Digital Employees.
3. Enforce tenant isolation and least privilege.
4. Execute work through governed tools and connectors.
5. Preserve traceability, provenance and accountability.
6. Measure operational quality, cost and outcomes.
7. Integrate AOE without making VITO dependent on one model provider.
8. Evolve from a modular monolith into distributed workers only when justified.
9. Keep domain logic independent from infrastructure vendors.
10. Support human oversight and safe escalation.

## 5. Non-goals

VITO is not intended to become:

- a general-purpose ERP;
- a general-purpose CRM;
- a replacement for all external systems of record;
- a single autonomous super-agent;
- an ungoverned automation layer;
- a direct wrapper around one LLM provider;
- a platform that permits cross-tenant memory or credential sharing;
- a microservice landscape before operational evidence requires it.

External systems such as Gmail, Google Calendar, GitHub, ERPNext, Odoo, HubSpot or Salesforce remain external systems accessed through connectors.

## 6. Architectural principles

### 6.1 Modular monolith first

The current system remains a modular NestJS monolith.

This preserves:

- simple deployment;
- transactional consistency;
- unified tenant enforcement;
- lower operational cost;
- faster domain iteration.

Module boundaries must nevertheless be designed as if selected components could later move into separate workers or services.

### 6.2 Explicit bounded contexts

The following concerns must remain separate:

- organizations;
- users and authorization;
- workforce instances;
- Digital Employees;
- orchestration;
- agent runtime;
- workflows;
- tasks;
- capabilities;
- tools;
- connectors;
- memory;
- knowledge;
- audit;
- performance ledger.

No module may absorb another module's core responsibilities for convenience.

### 6.3 Ports before providers

Domain modules must depend on stable interfaces, not vendor SDKs.

Examples:

- `MemoryStorePort`, not direct Qdrant access;
- `AgentRuntimePort`, not direct queue-worker coupling;
- connector contracts, not direct Google SDK access in Digital Employees;
- semantic retrieval ports, not provider-specific embeddings inside domain services.

### 6.4 Tenant scope is mandatory

Every business operation, persistence query, memory lookup, tool execution and audit record must carry an authoritative `organizationId`.

Tenant identity must originate from verified authentication context or trusted internal execution context, never from an unverified client-controlled value in production.

### 6.5 Human authority remains explicit

Human approval is required where defined by risk, policy or law.

The platform must not hide whether a decision was:

- made by a human;
- recommended by AOE;
- delegated by an orchestrator;
- executed by a Digital Employee;
- performed by an external system.

### 6.6 Model independence

No canonical business rule may depend on one LLM vendor or model version.

Foundation models are replaceable runtime providers. AOE logic, workforce policies, capability rules, audit requirements and domain entities remain provider-independent.

### 6.7 Audit and performance are distinct

Audit answers:

> What happened, who or what caused it, when, and under which context?

Performance answers:

> How well, how quickly, at what cost and with what outcome did it happen?

The Performance Ledger must not replace the immutable audit trail.

## 7. Layer model

```text
┌──────────────────────────────────────────────────────────────┐
│  Experience Layer                                            │
│  Web · Mobile · Voice · API · Messaging Interfaces           │
├──────────────────────────────────────────────────────────────┤
│  Workforce Layer                                             │
│  Workforce Instances · Orchestrators · Digital Employees     │
├──────────────────────────────────────────────────────────────┤
│  Intelligence Layer                                          │
│  AOE · Analysis · Orientation · Decision Recommendations     │
├──────────────────────────────────────────────────────────────┤
│  Execution Layer                                             │
│  Agent Runtime · Tasks · Workflows · Tools · Approvals        │
├──────────────────────────────────────────────────────────────┤
│  Knowledge and Memory Layer                                  │
│  Knowledge Retrieval · Memory · Provenance · Canon References│
├──────────────────────────────────────────────────────────────┤
│  Integration Layer                                           │
│  Connectors · Credentials · Provider Adapters                 │
├──────────────────────────────────────────────────────────────┤
│  Infrastructure Layer                                        │
│  PostgreSQL · pgvector · Queue · Cache · Object Storage       │
├──────────────────────────────────────────────────────────────┤
│  Governance Layer — cross-cutting                             │
│  Identity · Authorization · Policies · Audit · Performance    │
└──────────────────────────────────────────────────────────────┘
```

The Governance Layer is cross-cutting and applies to every other layer.

## 8. Core domain model

### 8.1 Organization

Represents a legal, operational or product tenant.

Examples:

- LA VOLPE;
- ATERIMA;
- future customer organizations.

An Organization owns users, workforce instances, policies, credentials, data, memory and audit records.

### 8.2 Workforce Instance

A Workforce Instance is an organization-specific Digital Workforce configuration.

Canonical attributes include:

- `id`;
- `organizationId`;
- `name`;
- `code`;
- `status`;
- `orchestratorDigitalEmployeeId`;
- policy references;
- configuration version;
- activation and retirement metadata.

Examples:

- VITO for LA VOLPE;
- TIMO for ATERIMA.

A Workforce Instance is not interchangeable with a Digital Employee.

### 8.3 Digital Employee

A Digital Employee is a governed organizational role with a bounded purpose, identity, capability set and execution policy.

A Digital Employee must define:

- organization and workforce membership;
- name and stable code;
- role description;
- responsibility boundary;
- required and optional capabilities;
- permitted tools;
- escalation policy;
- memory access policy;
- model/runtime configuration;
- lifecycle status.

A Digital Employee may act as an orchestrator, executive, manager, specialist or worker.

### 8.4 Orchestrator

The Orchestrator is a specialized Digital Employee or platform role responsible for coordination.

The Orchestrator owns:

- work intake;
- interpretation of operational objectives;
- routing;
- delegation;
- dependency coordination;
- escalation;
- completion review;
- workload balancing;
- policy-aware sequencing.

The Orchestrator does not automatically own every tool or capability. It coordinates work and may itself execute only what its policy permits.

### 8.5 Task

A Task is a unit of organizational work.

Tasks may be assigned to:

- one human user;
- one Digital Employee;
- a workforce queue;
- a workflow stage.

Task assignment invariants must remain explicit and database-enforced where practical.

### 8.6 Agent Session

An Agent Session groups related Agent Runs that share operational context.

Examples:

- one customer request;
- one project workstream;
- one multi-step research assignment;
- one workflow execution.

### 8.7 Agent Run

An Agent Run is one bounded execution attempt by one Digital Employee.

Canonical states are:

```text
QUEUED
RUNNING
WAITING_FOR_APPROVAL
COMPLETED
FAILED
CANCELLED
```

Future states may be added through an ADR. State transitions must be validated and auditable.

An Agent Run must include:

- organization;
- workforce instance;
- Digital Employee;
- objective;
- input reference;
- requested and granted capabilities;
- model/runtime metadata;
- correlation identifier;
- timestamps;
- status;
- outcome or error;
- cost and usage references;
- audit references.

### 8.8 Workflow

A Workflow is a governed multi-step process definition.

A Workflow owns:

- ordered or conditional stages;
- actor requirements;
- approval gates;
- timeout and retry rules;
- compensation or rollback rules where relevant;
- completion conditions;
- versioning.

Workflows must not be reduced to arbitrary prompt chains.

### 8.9 Capability

A Capability is a semantic permission to perform a class of work.

Examples:

- `calendar.read`;
- `calendar.write`;
- `knowledge.search`;
- `document.import`;
- `email.prepare`;
- `email.send`;
- `seo.audit`;
- `social.publish`.

Capabilities are provider-independent. A capability may be implemented by one or more tools.

### 8.10 Tool

A Tool is a bounded executable action available to a Digital Employee.

A Tool definition must include:

- stable tool identifier;
- required capability;
- validated input schema;
- validated output schema;
- risk classification;
- approval requirement;
- timeout and retry policy;
- idempotency rules;
- cost metadata where applicable;
- audit policy;
- provider implementation reference.

### 8.11 Connector

A Connector provides governed access to an external system.

A Connector consists of:

- connector type;
- provider adapter;
- organization-specific connection;
- encrypted credential reference;
- scopes;
- health state;
- rate-limit metadata;
- execution policy.

Digital Employees must not handle raw credentials.

### 8.12 Audit Event

An Audit Event is an immutable accountability record for a security-relevant or business-relevant action.

It should capture:

- organization;
- actor type and actor identifier;
- action;
- entity type and identifier;
- timestamp;
- correlation identifier;
- outcome;
- sanitized metadata;
- policy and approval references where relevant.

### 8.13 Performance Record

A Performance Record evaluates execution quality and efficiency.

Dimensions may include:

- duration;
- completion status;
- retries;
- tool usage;
- model usage;
- cost;
- estimated human time saved;
- review score;
- business outcome;
- escalation rate;
- error category.

Performance data must never silently redefine business policy.

## 9. Workforce topology

### 9.1 LA VOLPE

```text
VITO Workforce Instance
       │
       ├── VITO Orchestrator
       ├── ANNA — Executive Assistance
       ├── SOFIA — Knowledge and Documentation
       └── VIOLA — Growth and Visibility
```

### 9.2 ATERIMA

```text
TIMO Workforce Instance
       │
       ├── TIMO Orchestrator
       └── ATERIMA-specific Digital Employees
```

The same platform primitives are reused, while Company DNA, policies, memory, workflows, tools and connectors remain organization-specific.

## 10. Execution lifecycle

The canonical execution sequence is:

```text
1. Work request received
2. Identity and tenant context verified
3. Objective normalized
4. Policy and risk classification performed
5. Orchestrator selects Digital Employee or workflow
6. Required capabilities resolved
7. Approval gate evaluated
8. Agent Run created
9. Context and authorized memory assembled
10. AOE consulted when orientation or decision support is required
11. Tools executed through governed adapters
12. Output validated and sanitized
13. Result reviewed, delegated, escalated or completed
14. Memory updated according to policy
15. Audit Event written
16. Performance Record written
17. Task or workflow state updated
```

No step may bypass tenant enforcement, capability authorization or required approval.

## 11. AOE integration contract

AOE and VITO must remain separate systems with explicit interfaces.

VITO may send AOE:

- a bounded question;
- relevant context;
- known constraints;
- decision state;
- permitted knowledge references;
- required output schema.

AOE may return:

- analysis;
- detected patterns;
- hypotheses;
- orientation gaps;
- options;
- recommendation;
- confidence or uncertainty;
- required evidence;
- escalation recommendation.

AOE responses are advisory unless an approved policy explicitly allows automatic execution.

VITO remains responsible for:

- actor selection;
- authorization;
- tool execution;
- approval;
- operational sequencing;
- audit;
- performance measurement.

## 12. Memory architecture

Memory is separated into four canonical classes.

### 12.1 Working Memory

Purpose:

- current task context;
- current session state;
- temporary execution variables;
- short-lived intermediate results.

Working Memory should have explicit retention or expiry rules.

### 12.2 Episodic Memory

Purpose:

- prior actions;
- meetings;
- interactions;
- failures;
- decisions;
- outcomes;
- lessons from completed work.

Episodic Memory must preserve provenance and timestamps.

### 12.3 Semantic Memory

Purpose:

- concepts;
- facts;
- document chunks;
- structured knowledge;
- retrieval embeddings;
- references to governed knowledge sources.

Semantic retrieval must not be treated as authoritative without provenance and access checks.

### 12.4 Organizational Memory

Purpose:

- policies;
- roles;
- processes;
- decisions;
- customer and project context;
- company-specific operating knowledge;
- references to the AOE Knowledge Engine and Canon.

Organizational Memory is governed company knowledge, not a raw transcript archive.

### 12.5 Memory invariants

Every memory record must include or derive:

- `organizationId`;
- memory class;
- provenance;
- visibility;
- subject or scope;
- creation time;
- retention rule;
- sensitivity classification;
- deletion or archival rule.

Cross-tenant memory retrieval is prohibited.

Credentials, secrets and unrestricted personal data must not be written into memory.

## 13. Knowledge architecture

The Knowledge domain coordinates governed retrieval from sources such as:

- AOE Knowledge Engine;
- Canon repositories;
- approved documents;
- organizational databases;
- indexed content stores.

Knowledge and Memory are related but not identical:

- Knowledge represents governed information sources and claims.
- Memory represents retained operational context and experience.

Knowledge retrieval must preserve source identity, provenance, version and access scope.

## 14. Capability, tool and connector architecture

The canonical chain is:

```text
Digital Employee
       │
       ▼
Capability Grant
       │
       ▼
Tool Registry
       │
       ▼
Connector Policy
       │
       ▼
Provider Adapter
       │
       ▼
External System
```

A Digital Employee may invoke a tool only when:

1. the employee is active;
2. the employee belongs to the relevant workforce instance;
3. the capability is granted;
4. the organization has an active connector where required;
5. the requested operation is within connector scope;
6. input validation succeeds;
7. the risk policy permits execution;
8. required human approval exists;
9. rate limits and cost policies permit execution.

## 15. Security architecture

### 15.1 Authentication

Production authentication is JWT-based under the current implementation.

The trusted request context includes:

- user identity;
- organization identity;
- role;
- token version or equivalent revocation control.

The insecure tenant-header fallback is development-only and must remain disabled in production.

### 15.2 Authorization

Authorization combines:

- user role;
- organization scope;
- workforce membership;
- Digital Employee capability grants;
- tool policy;
- connector scope;
- approval requirements.

A future fine-grained permission engine may extend the current role model, but must not weaken existing tenant isolation.

### 15.3 Credential management

Credentials must be:

- encrypted at rest;
- referenced, not copied into prompts;
- scoped per organization and connector;
- rotatable;
- revocable;
- excluded from audit payloads, task payloads and memory;
- accessible only to the connector execution boundary.

### 15.4 Data minimization

Only context required for a specific execution may be exposed to a model, Digital Employee or external provider.

## 16. Persistence architecture

### 16.1 Initial system of record

PostgreSQL remains the primary system of record for:

- organizations;
- users;
- workforce instances;
- Digital Employees;
- capabilities;
- tasks;
- workflows;
- Agent Runs and Sessions;
- connector metadata;
- audit references;
- performance records;
- memory metadata.

### 16.2 Semantic retrieval

pgvector is the preferred first semantic retrieval technology because it preserves operational simplicity and tenant-aware relational metadata.

A dedicated vector database may be introduced only when measured retrieval scale, latency, availability or operational isolation requires it.

### 16.3 Cache and queues

Redis or equivalent infrastructure may be introduced for:

- distributed locks;
- background queues;
- rate limiting;
- short-lived cache;
- worker coordination.

Redis must not become the authoritative system of record.

### 16.4 Object storage

Object storage is used for:

- documents;
- media;
- large tool outputs;
- generated artifacts;
- connector attachments.

Database records retain metadata, ownership, access scope and checksums.

### 16.5 Event store

A dedicated event store is not required initially.

It may be introduced only when replay, event-sourced aggregates or regulatory history require it.

## 17. Event architecture

The modular monolith may initially use in-process domain events.

Canonical event examples include:

- `task.created`;
- `workforce.work.requested`;
- `orchestration.delegated`;
- `agent_run.started`;
- `agent_run.completed`;
- `agent_run.failed`;
- `tool_execution.requested`;
- `tool_execution.completed`;
- `approval.required`;
- `memory.recorded`;
- `performance.recorded`.

Events must include:

- event identifier;
- organization identifier;
- event type;
- schema version;
- timestamp;
- correlation identifier;
- actor reference;
- sanitized payload.

A message broker is introduced only when background execution, durability or independent scaling requires it.

## 18. Governance and approval model

Actions must be classified by risk.

Suggested initial classes:

- **R0 — Read-only:** search, retrieve, summarize;
- **R1 — Reversible internal change:** draft, tag, update internal task;
- **R2 — External but reviewable:** prepare email, prepare publication, create proposed event;
- **R3 — External commitment:** send email, publish content, modify customer system;
- **R4 — High-impact:** financial, contractual, legal, personnel, destructive or security-sensitive action.

Default approval policy:

- R0 may execute automatically if authorized;
- R1 may execute automatically under explicit workflow policy;
- R2 normally requires review before external release;
- R3 requires explicit approval unless a narrowly bounded policy exists;
- R4 always requires human authorization and may require dual control.

## 19. Observability

The platform must support:

- structured application logs;
- correlation identifiers;
- runtime metrics;
- tool latency and error metrics;
- model usage and cost metrics;
- queue and worker health;
- connector health;
- security event monitoring;
- tenant-safe diagnostics.

Logs must not leak credentials or cross-tenant content.

## 20. Performance Ledger

The Performance Ledger enables evidence-based improvement of Digital Employees and workflows.

It records operational facts but does not autonomously change canonical policies.

Initial evaluation dimensions:

- completion rate;
- quality score;
- human correction rate;
- time to completion;
- estimated time saved;
- model and tool cost;
- retry rate;
- escalation rate;
- approval delay;
- business outcome.

Changes to routing or agent configuration based on ledger data require controlled review and versioning.

## 21. Repository architecture

Target structure:

```text
vito-platform/
├── apps/
│   └── api/
│       └── src/
│           ├── common/
│           ├── config/
│           ├── modules/
│           │   ├── organizations/
│           │   ├── users/
│           │   ├── workforce-instances/
│           │   ├── digital-employees/
│           │   ├── orchestration/
│           │   ├── agent-runtime/
│           │   ├── workflows/
│           │   ├── tasks/
│           │   ├── capabilities/
│           │   ├── tools/
│           │   ├── connectors/
│           │   ├── memory/
│           │   ├── knowledge/
│           │   ├── audit/
│           │   ├── performance-ledger/
│           │   ├── auth/
│           │   └── health/
│           ├── platform/
│           │   ├── agent-runtime/
│           │   ├── orchestration/
│           │   └── persistence/
│           └── infrastructure/
│               ├── persistence/
│               ├── messaging/
│               ├── connectors/
│               ├── observability/
│               └── security/
├── prisma/
├── docs/
│   ├── architecture/
│   ├── adr/
│   └── runbooks/
└── scripts/
```

The `platform` directory contains stable contracts. Domain implementation belongs in `modules`; provider-specific code belongs in `infrastructure`.

## 22. Scaling and extraction strategy

The platform remains a modular monolith until measured evidence supports extraction.

Likely extraction sequence:

1. Agent Runtime workers;
2. queue-backed workflow execution;
3. isolated connector workers;
4. high-volume knowledge retrieval;
5. specialized memory infrastructure.

A module may be extracted only when at least one is true:

- independent scaling is required;
- fault isolation is required;
- security isolation is required;
- release independence is materially valuable;
- data locality or compliance requires separation;
- process resource usage threatens API stability.

Service extraction must preserve existing contracts, tenant scope, audit correlation and idempotency.

## 23. Multi-database strategy

Multiple databases are not an architectural objective by themselves.

Each additional persistence technology must satisfy a documented requirement and remain behind a port.

Preferred evolution:

```text
Phase 1: PostgreSQL
Phase 2: PostgreSQL + pgvector
Phase 3: optional Redis/queue + object storage
Phase 4: dedicated vector or event infrastructure only if justified
```

## 24. Failure handling

Every external or model-dependent execution must define:

- timeout;
- retry policy;
- maximum attempts;
- idempotency strategy;
- fallback behavior;
- escalation path;
- user-visible status;
- audit outcome.

Retries must not duplicate irreversible actions.

Failed Agent Runs remain inspectable and must not be silently overwritten.

## 25. Versioning

The following elements require explicit versioning:

- workforce configuration;
- Digital Employee role definition;
- prompts and system instructions;
- workflow definitions;
- tool schemas;
- connector adapters;
- policy sets;
- AOE request/response contracts;
- memory schemas;
- event schemas.

Each Agent Run should be traceable to the relevant configuration versions.

## 26. Testing strategy

The platform requires:

- unit tests for domain rules;
- integration tests for persistence and connectors;
- E2E tests for tenant isolation and authorization;
- contract tests for ports and adapters;
- state-transition tests for Agent Runs and Workflows;
- approval-policy tests;
- idempotency tests for high-impact tools;
- regression tests for public health and authentication boundaries;
- adversarial tests for cross-tenant access and prompt/tool abuse.

The `/health` smoke test remains a mandatory bootstrap regression check.

## 27. Implementation roadmap

### Phase 1 — Foundation

- canonical architecture;
- ADRs;
- platform ports;
- health verification;
- stable authentication and tenant context.

### Phase 2 — Workforce Core

- `WorkforceInstance` model;
- orchestrator relationship;
- Digital Employee lifecycle;
- organization-specific workforce configuration.

### Phase 3 — Agent Runtime

- Agent Session;
- Agent Run persistence;
- state machine;
- cancellation, retry and escalation;
- runtime adapter.

### Phase 4 — Tool and Connector Governance

- Tool Registry;
- capability enforcement;
- connector instances;
- encrypted credential references;
- approval gates.

### Phase 5 — Memory and Knowledge

- Working and Episodic Memory;
- semantic retrieval with pgvector;
- organizational knowledge references;
- provenance and retention policies.

### Phase 6 — Performance and Learning

- Performance Ledger;
- quality review;
- cost tracking;
- outcome feedback;
- controlled routing optimization.

### Phase 7 — Distributed Execution

- queue-backed workers;
- connector isolation;
- workload scaling;
- advanced observability.

## 28. Architectural invariants

The following rules are non-negotiable unless this canonical architecture is formally amended:

1. AOE and VITO remain separate architectural systems.
2. VITO is a Digital Workforce instance, not a single assistant.
3. The VITO Orchestrator is a component inside VITO, not synonymous with VITO.
4. TIMO is an organization-specific workforce instance for ATERIMA.
5. Every persisted and executed operation is tenant-scoped.
6. Digital Employees cannot bypass capability and tool governance.
7. Raw credentials never enter prompts, memory or audit payloads.
8. Audit and Performance Ledger remain separate.
9. Domain modules do not depend directly on infrastructure vendors.
10. Human approval remains mandatory for high-impact actions.
11. PostgreSQL remains the initial system of record.
12. Additional services and databases require measured justification.
13. Model providers remain replaceable.
14. Knowledge retrieval must preserve provenance.
15. Cross-tenant access must reveal neither data nor record existence.

## 29. Relationship to ADRs

ADRs record specific decisions within the boundaries of this architecture.

Relevant existing ADRs include:

- ADR-001 — modular monolith, tenant and audit foundations;
- ADR-002 — task assignment invariant;
- ADR-003 — JWT tenant context and MVP authorization;
- ADR-004 — user administration and lifecycle controls;
- ADR-005 — multi-agent platform boundaries.

Where an ADR conflicts with this document, the conflict must be resolved explicitly through a new ADR and a new version of this architecture document.

## 30. Canonical conclusion

VITO is the operational and organizational execution layer of the LA VOLPE ecosystem.

AOE provides intelligence and orientation. VITO transforms approved orientation into governed organizational action through workforce instances, orchestrators, Digital Employees, workflows, capabilities, tools and connectors.

The platform is intentionally designed to begin as a secure modular monolith, while preserving the contracts needed for future workers, specialized persistence and distributed execution.

The architectural objective is not maximum autonomy. The objective is reliable, measurable and accountable digital work.