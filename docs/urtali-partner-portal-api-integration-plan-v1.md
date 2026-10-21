# URTALI Partner Portal — Minimal API Integration Plan V1

Status: IMPLEMENTATION PLAN ONLY
Merge: NO_GO
Deployment: NO_GO
Database migration: NO_GO

## Goal

Connect the approved UI to VITO platform capabilities in small, reviewable stages while preserving current governance and privacy boundaries.

## Phase 0 — Current review build

Already available:
- complete navigation
- synthetic demo data
- partner lifecycle UX
- Academy UX
- lead/opportunity UX
- document/sales content UX
- commission UX
- support/profile/policy/admin review UX
- permission concepts
- privacy helper/tests
- local-only review mode

No live integration.

## Phase 1 — Read-only identity and membership

Endpoints / server queries:
- current user
- active partner membership
- role
- authorization summary
- portfolio permissions
- current policy acknowledgement summary

Writes:
NONE

Acceptance:
- session required
- server-side scope proven
- synthetic fallback removed only in integrated staging
- no ADOREN personal data

## Phase 2 — Read-only commercial data

Read:
- own leads
- assigned opportunities
- own commissions
- Academy progress
- governed documents
- solutions portfolio

Writes:
NONE

Acceptance:
- cross-partner access negative tests
- cross-org negative tests
- expired authorization behavior
- search permission boundary

## Phase 3 — Lead registration write

Write:
- submit lead

Server responsibilities:
- normalize input
- duplicate/conflict precheck
- create SUBMITTED / REVIEW_REQUIRED state
- audit
- never auto-create protection

No partner self-approval.

## Phase 4 — Central lead review

Internal-only write:
- accept
- reject
- mark duplicate
- existing customer/opportunity
- protected by other partner

On ACCEPTED:
- create protection window
- audit reviewer and reason

## Phase 5 — Opportunity workflow

Partner-permitted writes:
- update allowed next-action fields
- request proposal
- add governed business note

Human/internal writes:
- proposal approval
- commercial exception
- authority changes

No signing authority by default.

## Phase 6 — Commission ledger read + governed internal writes

Partner:
- read own ledger

Internal:
- calculate
- approve
- reverse
- mark paid

Never accept commission amount/rate from client as authoritative.

## Phase 7 — Academy progression

Read:
- modules
- progress
- certification

Write:
- quiz result / completion event

Authorization remains separate from completion.

Human approval may still be required for level changes.

## Phase 8 — Documents / policies

Read:
- current allowlisted content

Write:
- policy acknowledgement

Store:
- policy id
- version
- membership/user
- timestamp

Mandatory policy reaccept can gate defined actions.

## Phase 9 — VITO support integration

Only after preceding authorization model is proven.

VITO context may receive allowlisted:
- user role
- authorization
- portfolio
- opportunity business context

Must not receive automatically:
- ADOREN personal evidence
- unrelated customer data
- other partner data

No autonomous critical commercial write in MVP.

## Proposed API surface

Illustrative only:

GET /partner/me
GET /partner/authorizations
GET /partner/portfolio
GET /partner/leads
POST /partner/leads
GET /partner/opportunities
GET /partner/opportunities/:id
POST /partner/opportunities/:id/proposal-request
GET /partner/commissions
GET /partner/academy
POST /partner/academy/:module/completion
GET /partner/documents
GET /partner/policies
POST /partner/policies/:id/acknowledge

Internal:
GET /internal/partner/applications
POST /internal/partner/leads/:id/review
POST /internal/partner/authorizations/:id/decision
POST /internal/partner/commissions/:id/decision

Names are provisional.

## Required services / reuse

Prefer existing VITO platform components:
- Auth/session middleware
- Prisma
- PostgreSQL
- AuditService
- tenant/org guards
- policy/capability patterns where compatible

Do not create a second authorization engine if existing platform components can enforce the contract.

## Write invariants

Every critical write must:
1. authenticate
2. resolve tenant/org/membership
3. authorize action
4. validate payload
5. execute transaction
6. write audit event
7. return safe projection

Where approval is required:
REQUEST != APPROVAL

## Error contract

Use stable classes:
- UNAUTHENTICATED
- FORBIDDEN
- MEMBERSHIP_INACTIVE
- AUTHORIZATION_EXPIRED
- PORTFOLIO_NOT_ALLOWED
- POLICY_ACK_REQUIRED
- LEAD_CONFLICT
- RESOURCE_NOT_FOUND
- VALIDATION_FAILED
- REVIEW_REQUIRED

Avoid leaking sensitive cross-scope resource existence.

## Data migration rule

No migration until:
- schema reviewed
- privacy classification reviewed
- rollback path defined
- staging DB target confirmed
- owner explicitly approves migration

## Staging rule

Staging only after:
- visual owner approval
- security/data gate PASS
- Auth/session contract approved
- API contract approved
- tests green

Production remains separate explicit gate.

## Definition of done for integration readiness

- UI visual baseline approved
- security/data review PASS
- Auth/session contract approved
- endpoint contract approved
- model mapping approved
- audit events defined
- negative test matrix ready
- staging rollback plan ready

This document authorizes no implementation.
