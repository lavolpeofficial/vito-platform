# AOE–VITO Technical Reference Architecture v0.1

- Status: Draft Reference Architecture
- Version: 0.1
- Date: 2026-08-04
- Scope: Technical decomposition and implementation order for AOE–VITO integration
- Repository: `lavolpeofficial/vito-platform`
- Canonical parent: `docs/architecture/vito-platform-architecture-v1.0.md`

## 1. Purpose

This document translates the canonical VITO Platform Architecture into an implementable technical reference architecture.

It defines:

- bounded contexts;
- ownership of data and behavior;
- allowed dependencies;
- application ports;
- domain events;
- API boundaries;
- repository structure;
- persistence responsibilities;
- extraction criteria;
- implementation sequence.

This document does not redefine AOE or VITO. It operationalizes the existing canonical distinction:

- **AOE** provides analysis, orientation, pattern recognition, validation, decision support, recommendations and learning logic.
- **VITO** governs organizations, workforce instances, digital employees, capabilities, tasks, executions, approvals, tools, connectors, audit and performance.

## 2. Architectural style

The platform remains a **modular NestJS monolith** until measured operational evidence justifies extraction.

The monolith is divided into bounded contexts with explicit ports. Modules may share the same process and PostgreSQL cluster, but they must not bypass domain boundaries through arbitrary cross-module Prisma access.

### 2.1 Rules

1. Domain modules own their invariants.
2. Cross-domain reads use exported application services or dedicated query ports.
3. Cross-domain state changes use application commands or domain events.
4. Controllers contain no business rules.
5. Prisma is an infrastructure adapter, not the domain model.
6. `organizationId` is mandatory on every tenant-owned aggregate.
7. Workforce-scoped aggregates also carry `workforceInstanceId` where applicable.
8. No module may call an external provider directly without a connector/tool port.
9. AOE never executes external actions directly.
10. Governance may deny or suspend any proposed execution.

## 3. System boundary

```text
Experience Channels
(Web, API, Voice, Messaging)
          │
          ▼
VITO Application Layer
          │
          ├── Organization Core
          ├── Workforce Core
          ├── Execution Core
          ├── Governance Core
          ├── Memory Core
          ├── Connector Core
          ├── Audit / Performance
          │
          ▼
AOE Integration Port
          │
          ▼
AOE Intelligence Services
(Knowledge, Validation, Pattern, Orientation, Decision, Learning)
```

AOE and VITO may initially run in the same deployment environment, but they remain separate logical systems and must communicate through versioned contracts.

## 4. Bounded contexts

## 4.1 Identity & Tenant Context

Owns:

- Organization identity;
- User identity;
- authentication;
- authorization;
- request tenant context;
- token lifecycle.

Primary aggregates:

- `Organization`
- `User`
- `AuthorityAssignment` (future)

Exports:

- `TenantContextPort`
- `IdentityQueryPort`
- `AuthorizationPort`

Must not own:

- workforce hierarchy;
- execution planning;
- agent memory.

## 4.2 Organizational Core

Owns:

- workforce instances;
- departments;
- teams;
- organizational roles;
- positions;
- reporting relationships;
- organization operating state.

Primary aggregates:

- `WorkforceInstance`
- `Department`
- `Team`
- `OrganizationRole`
- `Position`

Exports:

- `OrganizationStructureQueryPort`
- `WorkforceMembershipPort`
- `ReportingLineQueryPort`

Invariants:

- all hierarchy nodes belong to one organization;
- child structures cannot cross workforce boundaries;
- hierarchy cycles are prohibited;
- managers and members must belong to the same organization and compatible workforce scope.

## 4.3 Digital Workforce Core

Owns:

- digital employee identity;
- employee type and lifecycle;
- workforce membership;
- capability assignments;
- runtime eligibility;
- employee configuration version.

Primary aggregates:

- `DigitalEmployee`
- `DigitalEmployeeCapability`
- `AgentProfile` (future)

Exports:

- `DigitalEmployeeQueryPort`
- `CapabilityEligibilityPort`
- `AgentProfilePort`

Must not own:

- actual agent execution;
- model-provider clients;
- knowledge corpus.

## 4.4 Capability Core

Owns:

- capability definitions;
- risk classification;
- approval requirements;
- capability versions;
- capability bundles;
- tool and knowledge bindings.

Primary aggregates:

- `Capability`
- `CapabilityVersion`
- `CapabilityBundle`
- `CapabilityBinding`

Exports:

- `CapabilityRegistryPort`
- `CapabilityPolicyPort`
- `CapabilityBenchmarkPort`

A capability describes **what the organization can do**. A tool describes **how a capability is technically executed**.

## 4.5 Task & Workflow Core

Owns:

- user or system requests for work;
- task lifecycle;
- workflow definitions;
- workflow steps;
- dependencies;
- due dates and priority inputs.

Primary aggregates:

- `Task`
- `WorkflowDefinition`
- `WorkflowVersion`
- `WorkflowStep`

Exports:

- `TaskCommandPort`
- `TaskQueryPort`
- `WorkflowDefinitionPort`

A task is an intention or work request. It is not the execution record.

## 4.6 Execution Core

Owns:

- execution plans;
- agent runs;
- activities;
- retries;
- execution state;
- correlation and causation identifiers;
- produced results.

Primary aggregates:

- `Execution`
- `ExecutionPlan`
- `ExecutionActivity`
- `AgentRun`
- `ExecutionResult`

Exports:

- `ExecutionCommandPort`
- `ExecutionQueryPort`
- `AgentRuntimePort`
- `SchedulerPort`

Lifecycle baseline:

```text
PLANNED
→ QUEUED
→ RUNNING
→ WAITING_FOR_APPROVAL | WAITING_FOR_INPUT | RETRYING
→ COMPLETED | FAILED | CANCELLED
```

## 4.7 Orchestration Core

Owns:

- decomposition of accepted work;
- agent/capability selection;
- delegation;
- coordination;
- escalation;
- review routing;
- execution-plan assembly.

Primary services:

- `PlanningService`
- `DelegationService`
- `RoutingService`
- `EscalationService`
- `ReviewService`

Exports:

- `OrchestrationPort`

The orchestrator may propose plans, but governance decides whether those plans may execute.

## 4.8 Governance Core

Owns:

- policies;
- approvals;
- autonomy levels;
- risk gates;
- authority limits;
- emergency controls;
- separation-of-duties rules.

Primary aggregates:

- `Policy`
- `ApprovalRequest`
- `AuthorityAssignment`
- `GovernanceDecision`

Exports:

- `GovernanceEvaluationPort`
- `ApprovalCommandPort`
- `AuthorityQueryPort`
- `EmergencyControlPort`

Evaluation result:

```text
ALLOW
ALLOW_WITH_CONDITIONS
REQUIRE_APPROVAL
ESCALATE
DENY
```

## 4.9 Memory Core

Owns operational memory, not canonical scientific knowledge.

Memory classes:

- working memory;
- episodic memory;
- procedural memory;
- organizational memory;
- decision memory.

Primary aggregates:

- `MemoryRecord`
- `MemoryRelation`
- `DecisionMemory`

Exports:

- `MemoryStorePort`
- `MemorySearchPort`
- `RetentionPolicyPort`

Mandatory metadata:

- organization;
- workforce;
- subject;
- source;
- confidence;
- visibility;
- retention;
- version;
- timestamps.

## 4.10 Knowledge Integration Core

VITO does not become the owner of the AOE corpus.

This context owns:

- knowledge references;
- retrieval requests;
- cached retrieval results;
- provenance references;
- knowledge access policy.

Primary objects:

- `KnowledgeReference`
- `KnowledgeQuery`
- `KnowledgeSet`

Exports:

- `KnowledgeRetrievalPort`
- `KnowledgeReferencePort`

The authoritative AOE Knowledge Engine remains outside this bounded context.

## 4.11 Connector & Tool Core

Owns:

- connector definitions;
- provider configurations;
- credential references;
- tool registry;
- tool execution requests;
- rate limits;
- external error normalization.

Primary aggregates:

- `ConnectorDefinition`
- `ConnectorInstance`
- `ToolDefinition`
- `ToolExecution`

Exports:

- `ConnectorRegistryPort`
- `ToolRegistryPort`
- `ToolExecutionPort`

Credentials are stored only in an approved secret store. Domain records contain references, never plaintext secrets.

## 4.12 Audit Core

Owns append-only operational traceability.

Primary aggregate:

- `AuditEvent`

Exports:

- `AuditWriterPort`
- `AuditQueryPort`

Audit records must capture:

- actor;
- action;
- entity;
- organization;
- correlation ID;
- execution ID where applicable;
- before/after references where appropriate;
- timestamp.

## 4.13 Performance & Learning Core

Owns:

- outcomes;
- metric definitions;
- performance records;
- feedback;
- learning candidates;
- anomaly records;
- benchmark results.

Primary aggregates:

- `Outcome`
- `MetricDefinition`
- `PerformanceRecord`
- `FeedbackRecord`
- `LearningCandidate`

Exports:

- `OutcomePort`
- `PerformanceQueryPort`
- `LearningCandidatePort`

Validated cross-organization learning belongs to AOE governance, not directly to VITO runtime logic.

## 5. AOE intelligence contracts

VITO integrates with AOE through versioned ports.

## 5.1 Orientation request

```ts
export interface OrientationRequest {
  requestId: string;
  organizationId: string;
  workforceInstanceId?: string;
  requester: {
    type: 'USER' | 'DIGITAL_EMPLOYEE' | 'SYSTEM';
    id?: string;
  };
  goal?: string;
  problemStatement: string;
  contextReferences: string[];
  urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requestedOutputs: Array<'ORIENTATION' | 'OPTIONS' | 'RECOMMENDATION' | 'EXECUTION_PLAN'>;
}
```

## 5.2 Orientation response

```ts
export interface OrientationResponse {
  requestId: string;
  analysisId: string;
  orientationGaps: OrientationGap[];
  decisionOptions: DecisionOption[];
  recommendation?: Recommendation;
  proposedExecutionPlan?: ProposedExecutionPlan;
  assumptions: string[];
  unresolvedQuestions: string[];
  evidenceReferences: string[];
  confidence: number;
  contractVersion: string;
}
```

## 5.3 Mandatory separation

AOE may return a proposed execution plan. It may not:

- write to external systems;
- approve its own high-risk recommendation;
- bypass VITO governance;
- modify workforce authority;
- directly persist operational outcomes as validated learning.

## 6. Domain event catalogue

Events are past-tense facts. Commands are imperative requests. They must not be mixed.

Initial domain events:

### Organizational Core

- `WorkforceInstanceCreated`
- `WorkforceOrchestratorAssigned`
- `DigitalEmployeeAssignedToWorkforce`
- `DepartmentCreated`
- `DepartmentManagerAssigned`
- `TeamCreated`
- `PositionFilled`

### Task & Execution

- `TaskCreated`
- `TaskAccepted`
- `ExecutionPlanned`
- `ExecutionQueued`
- `ExecutionStarted`
- `ExecutionActivityCompleted`
- `ExecutionWaitingForApproval`
- `ExecutionCompleted`
- `ExecutionFailed`

### Governance

- `GovernanceEvaluated`
- `ApprovalRequested`
- `ApprovalGranted`
- `ApprovalRejected`
- `ExecutionDenied`
- `EmergencyStopActivated`

### Performance & Learning

- `OutcomeObserved`
- `PerformanceRecorded`
- `FeedbackReceived`
- `LearningCandidateCreated`
- `AnomalyDetected`

### AOE integration

- `OrientationRequested`
- `OrientationCompleted`
- `RecommendationProduced`
- `ExecutionPlanProposed`

## 7. Event transport strategy

### Phase 1

Use an in-process event bus behind an `EventBusPort`.

Requirements:

- typed event envelopes;
- correlation ID;
- causation ID;
- organization ID;
- occurred-at timestamp;
- schema version;
- deterministic handler tests.

### Phase 2

Introduce a transactional outbox in PostgreSQL when events trigger asynchronous workers or external effects.

### Phase 3

Introduce a broker only when measured throughput, retry isolation or independent deployment requires it.

Kafka, NATS, RabbitMQ or cloud queues are implementation options, not canonical dependencies.

## 8. Persistence ownership

PostgreSQL remains the system of record for VITO operational data.

Recommended schema ownership:

| Context | Primary persistence |
|---|---|
| Identity | PostgreSQL |
| Organizational Core | PostgreSQL |
| Digital Workforce | PostgreSQL |
| Capabilities | PostgreSQL |
| Tasks / Workflows | PostgreSQL |
| Execution | PostgreSQL |
| Governance | PostgreSQL |
| Audit | PostgreSQL append-only tables |
| Performance | PostgreSQL, later analytical replica if required |
| Memory metadata | PostgreSQL |
| Semantic memory | PostgreSQL + pgvector initially |
| Files / evidence | Object storage with PostgreSQL references |
| Secrets | External secret store |

A separate vector database, graph database, event store or cache requires a documented operational need.

## 9. API boundary

REST remains the primary external API for the first production version.

API groups:

```text
/auth
/organizations
/workforce-instances
/departments
/teams
/organization-roles
/positions
/digital-employees
/capabilities
/tasks
/workflows
/executions
/approvals
/policies
/memory
/knowledge-references
/connectors
/tools
/audit-events
/performance
/orientation-requests
```

Rules:

- external DTOs are not domain entities;
- all tenant-owned routes derive organization identity from authenticated context;
- client-supplied `organizationId` is not trusted;
- mutation endpoints return stable resource representations;
- high-risk mutation endpoints expose approval state;
- API versioning begins before external customers integrate.

## 10. Repository target structure

```text
apps/api/src/
├── common/
│   ├── auth/
│   ├── decorators/
│   ├── errors/
│   ├── events/
│   ├── filters/
│   ├── guards/
│   ├── tenant/
│   └── types/
├── config/
├── infrastructure/
│   ├── persistence/
│   ├── event-bus/
│   ├── object-storage/
│   ├── secrets/
│   ├── observability/
│   └── external-clients/
├── modules/
│   ├── auth/
│   ├── organizations/
│   ├── workforce-instances/
│   ├── departments/
│   ├── teams/
│   ├── organization-roles/
│   ├── positions/
│   ├── digital-employees/
│   ├── capabilities/
│   ├── tasks/
│   ├── workflows/
│   ├── executions/
│   ├── orchestration/
│   ├── governance/
│   ├── approvals/
│   ├── memory/
│   ├── knowledge-integration/
│   ├── connectors/
│   ├── tools/
│   ├── audit/
│   ├── performance/
│   └── health/
└── app.module.ts

packages/
├── contracts/
│   ├── aoe-integration/
│   ├── events/
│   └── shared-types/
└── testing/
    ├── fixtures/
    └── contract-tests/
```

Packages must only be introduced where the code is genuinely shared across applications or deployment units. Internal NestJS modules should remain inside `apps/api`.

## 11. Internal module template

Each substantial bounded context should converge toward:

```text
module-name/
├── application/
│   ├── commands/
│   ├── queries/
│   ├── ports/
│   └── services/
├── domain/
│   ├── aggregates/
│   ├── events/
│   ├── policies/
│   └── value-objects/
├── infrastructure/
│   ├── persistence/
│   └── adapters/
├── presentation/
│   ├── controllers/
│   └── dto/
├── module-name.module.ts
└── README.md
```

This structure should be applied progressively. Existing small CRUD modules need not be mechanically rewritten before business complexity justifies it.

## 12. Observability

Every execution path must support:

- correlation ID;
- structured logs;
- execution and activity IDs;
- organization and workforce context;
- duration;
- external-call status;
- retry count;
- cost metadata where available;
- error classification.

Metrics must not expose tenant data through labels.

## 13. Security invariants

1. No cross-tenant query without an explicit platform-administration path.
2. No external write without capability authorization.
3. No critical execution without governance evaluation.
4. No plaintext credentials in database, logs, prompts, memory or audit metadata.
5. No unbounded autonomous action.
6. No mutable deletion of mandatory audit history.
7. No AOE recommendation is treated as authorization.
8. No memory retrieval may omit tenant scope.
9. No learning candidate modifies critical policy without approval.
10. No connector adapter decides business policy.

## 14. Implementation sequence

### Milestone A — Stabilize current branch

- complete workforce and department implementation;
- add tests for tenant isolation and hierarchy invariants;
- merge the current architecture/foundation PR;
- create smaller implementation PRs thereafter.

### Milestone B — Organizational Core

1. Teams
2. Organization roles
3. Positions
4. Position assignments
5. reporting-line queries
6. organization chart read model

### Milestone C — Execution Foundation

1. `Execution`
2. `ExecutionActivity`
3. lifecycle service
4. correlation IDs
5. in-process event bus
6. execution audit integration

### Milestone D — Governance Foundation

1. policy definitions
2. governance evaluation result
3. approval requests
4. execution waiting state
5. emergency stop

### Milestone E — Agent Runtime

1. runtime port
2. deterministic mock adapter
3. agent run persistence
4. retries and cancellation
5. model-provider adapter interface
6. first real provider adapter

### Milestone F — AOE Integration

1. versioned orientation contracts
2. mock AOE adapter
3. orientation request persistence
4. recommendation persistence
5. governance evaluation of proposed plans
6. production AOE service adapter

### Milestone G — Memory & Knowledge

1. operational memory metadata
2. tenant-safe retrieval
3. knowledge references
4. pgvector evaluation
5. evidence references
6. retention policies

### Milestone H — Performance & Learning

1. outcomes
2. metric definitions
3. performance records
4. feedback
5. learning candidates
6. benchmark and regression framework

## 15. Extraction criteria

A bounded context may become a separate service only when at least one of the following is demonstrated:

- independent scaling requirement;
- distinct security boundary;
- incompatible runtime requirement;
- independent release cadence causing material friction;
- failure isolation requirement;
- sustained queue workload;
- external reuse by multiple products.

Code size alone is not sufficient justification.

## 16. Immediate engineering decisions

The following decisions are binding for the next implementation phase:

1. Continue with the modular monolith.
2. Complete Organization → Workforce → Department → Team → Role → Position before building a dashboard.
3. Introduce `Execution` before expanding `Task` into an overloaded workflow engine.
4. Introduce governance before enabling autonomous external writes.
5. Implement AOE through a versioned integration port, not direct internal imports.
6. Start semantic retrieval with PostgreSQL + pgvector unless benchmarks demonstrate insufficiency.
7. Use an in-process event bus first, then a PostgreSQL outbox before any external broker.
8. Keep audit and performance as separate domains.
9. Keep knowledge and operational memory separate.
10. Keep architecture work subordinate to tested implementation from this point forward.

## 17. Definition of done for a new domain module

A module is not complete until it includes:

- explicit aggregate ownership;
- tenant-scoped invariants;
- validated DTOs;
- application service or command handler;
- persistence adapter;
- audit behavior for mutations;
- unit tests for invariants;
- integration or E2E tests for principal routes;
- Swagger/OpenAPI documentation;
- migration where required;
- module README with boundaries and exported contracts;
- green CI.

## 18. Next implementation target

The next implementation target is **Team** inside the Organizational Core.

Required invariants:

- Team belongs to exactly one organization, workforce and department.
- Department and Team workforce IDs must match.
- Optional manager must belong to the same organization and workforce.
- Team codes are unique within a department.
- Team hierarchy is deferred until a validated need exists.
- All mutations are audited.

After Team, implement Organization Role and Position before beginning the Execution Core.
