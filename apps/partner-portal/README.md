# URTALI Partner Portal

Status: **owner-review build / no production integration**

This application is an isolated Next.js partner-portal surface inside the VITO monorepo. It implements the reviewed URTALI Partner V1.1 information architecture without touching production auth, databases, commissions, ADOREN personal evidence, or deployment.

## Included

- URTALI visual system with mountain motif
- dashboard with one primary next-action block
- Academy / authorization journey
- Solutions / authorized portfolio
- Sales Hub
- Lead list and browser-local review registration
- Opportunities and qualification view
- Documents
- Commission ledger presentation
- Support / VITO integration boundary
- Partner profile, policies and portfolio permissions
- pure domain tests for authorization, CNR, commission and lead protection

## Explicit boundaries

- No Auth0 connection yet.
- No API writes.
- No database migration.
- No production/customer data.
- Lead registration in review mode writes only to browser localStorage.
- VITO Copilot is not invoked.
- ADOREN personal evidence is not represented or exposed.
- No deployment configuration is added.

## Local commands

    pnpm --filter @vito/partner-portal test
    pnpm --filter @vito/partner-portal typecheck
    pnpm --filter @vito/partner-portal build
    pnpm --filter @vito/partner-portal dev

Default development port: 3002.

## Next gates

1. Owner UX review.
2. Security/data model review.
3. Auth0 EU integration design.
4. API/domain integration with tenant isolation and AuditService.
5. Staging-only acceptance before any public route.
