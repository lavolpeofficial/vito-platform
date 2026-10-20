# URTALI Partner Portal — Security & Data Review Gate V1

Status: PREPARATION ONLY
Implementation authorization: NONE
Production authorization: NONE

## Objective

Define the mandatory security and data boundaries before Auth0, API, Prisma, database or live ADOREN integration is allowed.

## Security principles

1. Deny by default.
2. Role is not authorization.
3. Authorization is not portfolio permission.
4. Opportunity access never implies access to personal ADOREN evidence.
5. Browser state is never authoritative for permissions.
6. Critical writes require server-side checks and audit.
7. Human approval remains mandatory for commercial and governance exceptions.
8. No secret or privileged token is exposed to the browser.

## Identity model

USER
→ PARTNER_PERSON
→ PARTNER_MEMBERSHIP
→ PARTNER_ORGANIZATION

Separate:
- identity
- organization membership
- business role
- authorization
- portfolio permission
- opportunity role

## Data partitions

### PARTNER DATA
Examples:
- profile
- membership
- role
- training status
- authorizations
- certifications

Partner may read own permitted data.
Admin access is separately governed.

### CUSTOMER BUSINESS DATA
Examples:
- company
- business contact
- lead
- opportunity
- business need
- proposal state

Access only through assigned / permitted commercial context.

### ADOREN PERSONAL
Examples:
- personal free text
- private evidence
- personal orientation responses
- health/private context

Hard boundary:
PARTNER OPPORTUNITY PERMISSION DOES NOT GRANT ADOREN PERSONAL ACCESS.

No personal evidence enters partner-facing reports automatically.

### FINANCIAL DATA
Examples:
- CNR
- commission ledger
- payout state
- commercial rates

Scope must be explicit.
Normal partners see only their allowed financial records.

### INTERNAL LA VOLPE / URTALI
Examples:
- conflict resolution
- internal notes
- compliance review
- platform audit
- security metadata
- internal margins

Never exposed through normal partner role.

## Authorization contract

Effective permission must evaluate:

> ROLE + AUTHORIZATION + PORTFOLIO_PERMISSION + MARKET + LIMITS + VALIDITY + RESOURCE_SCOPE

Levels:
- NONE
- REFERRAL_ONLY
- SALES_ALLOWED
- ADVISORY_ALLOWED
- RESELLER_ALLOWED

No implicit upgrade from training or certification.

## Proposal authority

Separate permission:
- VIEW_ONLY
- REQUEST_ONLY
- PRESENT_ALLOWED
- NEGOTIATE_WITHIN_LIMITS
- SIGNING_AUTHORITY

Default normal partner:
NO SIGNING_AUTHORITY.

## Lead protection

Only central acceptance creates protection.

States:
- SUBMITTED
- REVIEW_REQUIRED
- ACCEPTED
- DUPLICATE
- EXISTING_CUSTOMER
- EXISTING_OPPORTUNITY
- PROTECTED_BY_OTHER_PARTNER
- REJECTED

Protection:
90 days + one approved extension up to max 180 days.

Partner may request extension.
Partner may not approve own extension.

## Commission controls

CUSTOMER INVOICE
≠ PAYMENT
≠ ELIGIBLE CNR
≠ COMMISSION LEDGER

States:
- CALCULATED
- PENDING
- PENDING_PAYMENT
- ELIGIBLE
- APPROVED
- PAID
- REVERSED

Approval and payout remain human-governed.

## Required audit events

At minimum:
- login success/failure
- session revoked
- role changed
- authorization granted/revoked/expired
- portfolio permission changed
- policy acknowledgement
- lead submitted
- lead accepted/rejected/conflict
- opportunity assignment changed
- proposal authority changed
- commercial exception requested/approved/rejected
- commission calculated/approved/reversed/paid
- personal-data boundary access denied
- admin action
- export/download of governed data

Each critical event should capture:
- actor
- tenant / organization
- resource
- action
- result
- timestamp
- correlation id
- reason / approval reference where applicable

Never log secrets or raw sensitive personal evidence.

## Session / browser requirements

- secure cookies
- HttpOnly
- SameSite appropriate to deployment
- CSRF protection for state-changing requests
- explicit logout
- server-side authorization on every governed action
- short-lived access token / session strategy
- revocation support
- no permission truth stored only in localStorage
- no sensitive personal evidence cached in browser storage

## Search boundary

Permission-aware search must only index / return resources visible to current effective authorization.

Forbidden:
- search result leakage from hidden organizations
- snippets from ADOREN PERSONAL
- internal compliance notes to partners
- commission records belonging to other partners

## Export boundary

Any CSV/PDF/export feature later requires:
- authorization check
- allowlisted fields
- audit event
- explicit data classification
- no accidental personal-data inclusion

## Negative acceptance tests

Must fail safely:
1. partner requests another partner's opportunity
2. REFERRAL_ONLY attempts sales action
3. expired authorization attempts proposal action
4. SALES_ALLOWED accesses ADVISORY-only offer
5. partner attempts lead self-approval
6. partner attempts own protection extension approval
7. partner requests ADOREN personal evidence
8. stale browser role after server-side revocation
9. manipulated client payload changes commission rate
10. unacknowledged mandatory policy attempts gated action
11. partner attempts admin route/API
12. cross-organization resource identifier is guessed

## Positive acceptance tests

Must succeed only with correct scope:
1. partner reads own profile
2. partner submits lead
3. accepted lead shows current protection state
4. authorized partner views allowed solution
5. assigned opportunity is readable
6. allowed proposal can be requested
7. own commission ledger is visible
8. current academy status is visible
9. business-only ADOREN summary is visible when explicitly allowlisted

## Gate outcome

PASS only when:
- all data partitions have enforceable server-side boundaries
- authorization is evaluated centrally
- audit coverage exists for critical writes
- negative tests pass
- ADOREN PERSONAL separation is proven
- no client-side permission bypass changes server behavior

Until PASS:
AUTH0/API/DB/STAGING_RELEASE = NO_GO
