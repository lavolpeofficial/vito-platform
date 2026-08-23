# VITO — Company Operations Manager Model v0.1

## Status

- State: Architecture decision
- Scope: Multi-tenant workforce hierarchy
- First concrete instance: ATERIMA

## Decision

VITO remains the global Workforce Operating System and must not become the operational manager of every customer organization.

Each larger company/tenant receives its own **Company Operations Manager** layer. This layer owns company-specific operational coordination, routing, priorities, escalation rules, KPIs, and Company DNA.

For ATERIMA, this manager is **TIMO**.

TIMO is therefore **not a clone of VITO**.

## Core Principle

> **VITO does not run the companies. VITO runs the digital workforce infrastructure. Company Operations Managers run the individual company instances.**

This separation is mandatory for scalability. Without it, VITO would accumulate the operational rules, priorities, exceptions, workflows, and employee routing logic of every customer organization. At 20–30+ companies this would create tenant-complexity explosion, excessive orchestration load, stronger cross-tenant coupling, and higher operational risk.

## Hierarchy

```text
VITO · Workforce Operating System
│
├── ATERIMA
│   └── TIMO · Company Operations Manager
│       ├── PAVEL · Recruiting
│       └── KONRAD · Customer Operations / Customer Portal
│
├── Company B
│   └── Company Operations Manager B
│       ├── Digital Employee ...
│       └── Digital Employee ...
│
└── Company C
    └── Company Operations Manager C
        ├── Digital Employee ...
        └── Digital Employee ...
```

## Responsibility Boundaries

### VITO

VITO remains global, generic, and tenant-safe.

Responsibilities:

- tenant / organization management
- workforce orchestration infrastructure
- capability runtime
- governed execution
- permissions and authority boundaries
- policy enforcement
- Human Gates
- provider / adapter execution
- audit and traceability
- performance infrastructure
- shared platform services
- cross-tenant isolation

VITO should know **which organization, manager, capability, policy, and digital employee are involved**, but it should not contain every organization's detailed operating model.

### Company Operations Manager

The Company Operations Manager is the organization-specific management layer.

Responsibilities:

- Company DNA
- company-specific routing rules
- operational priorities
- escalation rules
- SLA / workload coordination
- cross-functional task coordination
- company-specific KPIs
- exception handling
- employee delegation
- operational context
- human escalation within the company

The Company Operations Manager translates company events and business situations into work for specialized digital employees.

### Specialized Digital Employees

Specialized employees perform bounded operational roles.

For ATERIMA v0.1:

- **PAVEL** — Recruiting
- **KONRAD** — Customer Operations / Customer Portal

They do not become general company orchestrators.

## ATERIMA Example

```text
Incoming ATERIMA event
        ↓
      TIMO
        ↓
Classify business context
        ↓
┌────────────────────┬────────────────────┐
│                    │                    │
Recruiting         Customer            Exception /
case               case                cross-functional
│                    │                    │
PAVEL              KONRAD              TIMO / Human Gate
```

Examples:

- recruiting lead → PAVEL
- customer / family inquiry → KONRAD
- ambiguous ownership → TIMO
- conflict between departments → TIMO
- critical escalation → TIMO + human review

## TIMO Must Stay Thin

TIMO should not become a permanently reasoning general-purpose LLM agent.

Default principle:

> **Deterministic routing first. AI reasoning only where interpretation is actually required.**

Standard cases should be handled by rules and explicit routing.

Example:

```text
IF case.type = RECRUITING
→ PAVEL

IF case.type = CUSTOMER
→ KONRAD

IF customer.urgency = CRITICAL
→ KONRAD + HUMAN ESCALATION

IF employee.confidence < threshold
→ TIMO / HUMAN REVIEW
```

TIMO should invoke richer reasoning only for cases such as:

- ambiguous ownership
- multi-department situations
- priority conflicts
- exception handling
- resource conflicts
- unusual escalation decisions

This prevents unnecessary agent cascades such as:

```text
VITO thinks
→ TIMO thinks
→ employee thinks
→ AOE thinks
→ TIMO thinks again
```

The architecture should minimize unnecessary model calls, latency, and orchestration complexity.

## Why the Manager Layer Exists

### 1. Scalability

Without a Company Operations Manager, VITO eventually needs to understand the operational logic of every tenant directly.

At 20–30+ organizations this creates a central complexity bottleneck.

The manager layer distributes company-specific coordination.

### 2. Tenant Isolation

Company rules remain attached to the respective organization instead of becoming mixed into the VITO core.

A bad TIMO configuration should affect ATERIMA, not unrelated tenants.

### 3. Lower Core Complexity

VITO can remain a stable platform while company structures evolve independently.

### 4. Reusable Product Architecture

The pattern can be instantiated for every customer:

```text
VITO Core
→ Tenant
→ Company Operations Manager
→ Specialized Digital Employees
```

TIMO is the first implementation of this reusable manager pattern.

### 5. Cost and Performance Control

The manager layer does not require a full LLM call for every event.

Most routing should be deterministic. Intelligent management is reserved for exceptions.

### 6. Organizational Clarity

Responsibilities become explicit:

- VITO = infrastructure and governance
- Company Manager = company operations coordination
- Digital Employees = specialized execution
- AOE = intelligence / assessment / orientation support

## AOE Relationship

AOE is **not part of the employee hierarchy**.

AOE remains the Intelligence / Orientation Engine and may be called by TIMO, PAVEL, KONRAD, or other employees when assessment or interpretation is required.

Examples:

```text
PAVEL → AOE Recruiting Assessment
KONRAD → AOE Customer Need Assessment
TIMO → AOE Operations / Business Assessment
```

The separation is:

- **AOE evaluates and orients**
- **VITO governs and executes workforce infrastructure**
- **TIMO coordinates ATERIMA operations**
- **PAVEL / KONRAD perform specialist work**

## Dual Human Authority Model

A Company Operations Manager must not have one undifferentiated human owner for both business and technical authority.

VITO defines two separate human authority roles for each Company Operations Manager instance:

### Business Authority Owner

The Business Authority Owner is accountable for what the Company Operations Manager is permitted to do from an organizational and commercial perspective.

Responsibilities include:

- business-process authority
- operational decision boundaries
- company priorities
- customer and recruiting rules
- exceptional business approvals
- commercial commitments
- escalation policy
- final business accountability

For **ATERIMA v0.1**, the Business Authority Owner for TIMO is:

> **Peter — Geschäftsführer / Managing Director of ATERIMA**

Peter is the highest business escalation and decision authority for TIMO. This does not imply that every routine action requires Peter's approval. Human Gates should be used only where the defined authority model requires them.

### Technical Authority Owner

The Technical Authority Owner is accountable for what the Company Operations Manager is technically permitted to access and execute.

Responsibilities include:

- system access and permissions
- integration authorization
- credential governance
- API and infrastructure access
- security controls
- deployment / technical release authority where applicable
- technical incident handling
- technical revocation and containment

For **ATERIMA v0.1**, the Technical Authority Owner remains a **configurable role to be assigned to an appropriate ATERIMA IT responsible person**.

The Technical Authority Owner must not automatically gain business authority merely because they control technical systems. Likewise, the Business Authority Owner must not automatically bypass technical security, credential, deployment, or access-control boundaries.

### Separation of Authority

```text
                    PETER
             Business Authority
                    │
                    │
VITO ───────────── TIMO ───────────── IT
Governance     ATERIMA Manager    Technical Authority
                    │
             ┌──────┴──────┐
           PAVEL          KONRAD
         Recruiting       Customer
```

The two authority dimensions are intentionally independent:

```text
BUSINESS AUTHORITY
What may the company operation decide or promise?

TECHNICAL AUTHORITY
What may the system access or execute?
```

A consequential action may require one or both authority dimensions depending on the capability and risk class.

This separation should become a reusable VITO product primitive for larger tenants. In smaller organizations both authority roles may be assigned to the same human, but the roles remain logically distinct in the model.

## Initial Autonomy Model

For early production, the Company Operations Manager should start conservatively.

Recommended progression:

- Level 2 initially: read, analyze, research, route, update internal state, prepare external actions; consequential external actions remain gated
- Level 3 later: standard communication / scheduling may become autonomous once reliability is demonstrated

Autonomy remains capability-specific and governed by VITO authority and Human Gate rules.

## Anti-Patterns

Do not build:

1. TIMO as a second global VITO.
2. TIMO as a permanently active general agent.
3. Company-specific rules directly into the VITO core.
4. Unbounded agent-to-agent planning loops.
5. Specialized employees that also become company orchestrators.
6. Cross-tenant operational context sharing.
7. A single undifferentiated human authority role that conflates business and technical power.
8. Technical administrators automatically acquiring business decision authority.
9. Business executives automatically bypassing technical security boundaries.

## Product Implication

The Company Operations Manager should become a reusable VITO product primitive.

Conceptually:

```text
VITO Platform
+ Tenant / Company DNA
+ Company Operations Manager
+ Business Authority Owner
+ Technical Authority Owner
+ Specialized Digital Employees
+ AOE Intelligence
+ Governance
+ Performance Ledger
```

This allows VITO to support many organizations without turning the central orchestrator into the operational brain of every customer company.

## ATERIMA v0.1 Structure

```text
VITO
└── ATERIMA
    ├── Business Authority: Peter · Geschäftsführer
    ├── Technical Authority: ATERIMA IT · TBD
    └── TIMO · Company Operations Manager
        ├── PAVEL · Recruiting
        └── KONRAD · Customer Operations / Customer Portal
```

This is the canonical starting structure for the ATERIMA VITO instance.

## Architectural Rules

> **Company-specific operational intelligence belongs primarily to the Company Operations Manager / Company DNA layer, not to the VITO core.**

> **Business authority and technical authority are separate governance dimensions. Neither role implicitly inherits the authority of the other.**

VITO should scale by delegating organization-specific management, not by accumulating it centrally.
