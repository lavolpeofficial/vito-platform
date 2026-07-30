# VITO Platform Architecture v0.2

Status: Draft for implementation

## 1. System role

VITO is the organization-specific Digital Workforce instance of LA VOLPE. It is not a single assistant. A VITO instance contains a VITO Orchestrator and specialized Digital Employees such as ANNA, SOFIA and VIOLA. TIMO is the corresponding organization-specific Digital Workforce instance for ATERIMA.

AOE remains a separate but closely coupled Intelligence Engine. AOE analyses, diagnoses, recognizes patterns and recommends decisions. VITO plans, delegates, executes, audits and learns from operational outcomes.

## 2. Architectural style

The current implementation remains a modular NestJS monolith. Module boundaries are designed so that runtime-heavy components can later be extracted into workers or services without changing domain contracts.

Principles:

1. Domain modules own business rules.
2. Infrastructure implementations sit behind ports.
3. Every operation is organization-scoped.
4. Agent execution is auditable and measurable.
5. Digital Employees do not access databases or external connectors directly.
6. Orchestration, execution, memory, knowledge and tools are separate concerns.
7. PostgreSQL remains the system of record for the MVP.

## 3. Target module map

```text
apps/api/src/
├── common/
├── config/
├── infrastructure/
│   ├── persistence/
│   │   ├── relational/
│   │   ├── vector/
│   │   ├── cache/
│   │   ├── object-storage/
│   │   └── event-store/
│   ├── messaging/
│   ├── observability/
│   └── security/
├── modules/
│   ├── organizations/
│   ├── users/
│   ├── digital-employees/
│   ├── capabilities/
│   ├── tasks/
│   ├── orchestration/
│   ├── agent-runtime/
│   ├── workflows/
│   ├── memory/
│   ├── knowledge/
│   ├── connectors/
│   ├── tools/
│   ├── audit/
│   ├── performance-ledger/
│   ├── auth/
│   └── health/
└── platform/
    ├── agent-runtime/
    ├── orchestration/
    └── persistence/
```

The `platform` directory contains stable contracts only. Concrete NestJS modules and infrastructure adapters implement those contracts.

## 4. Multi-agent execution model

```text
Work Request
  -> VITO Orchestrator
  -> routing and policy decision
  -> Digital Employee selection
  -> Agent Run
  -> capability/tool execution
  -> result evaluation
  -> completion, delegation or escalation
  -> audit and performance ledger
```

### Core entities

- Digital Workforce Instance: organization-specific workforce, e.g. VITO or TIMO.
- Digital Employee: specialized worker, e.g. ANNA, SOFIA or VIOLA.
- Orchestrator: central coordination component inside a workforce instance.
- Agent Run: one bounded execution attempt by one Digital Employee.
- Agent Session: related sequence of Agent Runs with shared context.
- Workflow: governed multi-step process.
- Tool Execution: controlled invocation of an internal or external capability.

## 5. Memory model

Memory is separated by function:

| Memory type | Purpose | Initial storage |
|---|---|---|
| Working memory | Current run/session context | PostgreSQL or cache abstraction |
| Episodic memory | Prior actions and outcomes | PostgreSQL |
| Semantic memory | Retrieved concepts and document chunks | PostgreSQL + pgvector |
| Organizational memory | Policies, decisions, roles and operating knowledge | AOE Knowledge Engine references + PostgreSQL metadata |

Memory records must always include `organizationId`, provenance, visibility and retention metadata. Cross-tenant retrieval is forbidden by contract.

## 6. Persistence strategy

MVP default:

- PostgreSQL for transactional records and system-of-record data.
- pgvector for initial semantic retrieval.
- Object storage only when binary assets are introduced.
- Redis only when distributed locks, queues or short-lived cache justify it.
- A dedicated event store only when replay and event-sourced aggregates become operational requirements.

No domain module may depend directly on a vendor-specific vector, cache, object-store or event-store SDK.

## 7. Connector and tool governance

Connectors provide authenticated access to external systems. Tools expose bounded actions to Digital Employees.

Every execution requires:

- organization scope;
- actor and Digital Employee identity;
- explicit capability grant;
- input validation;
- timeout and retry policy;
- cost and rate-limit metadata where relevant;
- audit event;
- sanitized output;
- human approval for high-impact actions.

Credentials are never stored in prompts, task payloads or memory entries.

## 8. Performance Ledger

Every Agent Run and Tool Execution must produce measurable records. Initial dimensions:

- duration;
- status;
- retry count;
- human approval requirement;
- quality/review outcome;
- estimated time saved;
- cost;
- business outcome reference;
- escalation reason.

The Performance Ledger is an independent domain. Audit records prove what happened; performance records evaluate how well it happened.

## 9. Extraction path

The modular monolith is intentionally compatible with later separation:

1. API remains the control plane.
2. Agent Runtime can move to workers.
3. Workflow execution can move to a queue-backed process.
4. Connectors can become isolated adapters.
5. Memory and knowledge providers can scale independently.

Extraction happens only after measured operational pressure, not in anticipation of hypothetical scale.

## 10. Near-term implementation order

1. Stable platform contracts.
2. Agent Run and Agent Session persistence.
3. Orchestration routing and delegation policy.
4. Tool Registry and capability enforcement.
5. Performance Ledger.
6. Memory interfaces and pgvector adapter.
7. Worker/queue extraction if required.
