# URTALI Partner Portal V1.1

Status: product architecture frozen; implementation branch is owner-review only.

## Purpose

URTALI Partner is the governed operating surface for partner enablement, lead registration, opportunity work, authorized portfolio access, and transparent commissions.

Canonical operating path:

PARTNER WERDEN → WISSEN AUFBAUEN → KUNDEN GEWINNEN → BEDARF VERSTEHEN → PASSENDE LÖSUNG → WERT LIEFERN → GEMEINSAM WACHSEN

## Core boundaries

- Person != Partner Organization != Membership != Business Role != Opportunity Role.
- Authorization = Capability + Offer + Market + Limits + Validity.
- Partner status never implies unrestricted sales authority.
- ADOREN personal evidence never enters the partner portal.
- The portal may receive only an allowlisted, consented B2B orientation summary.
- Invoice != Payment != Eligible CNR != Commission Ledger.
- Lead protection starts only after central acceptance.
- Discount, signing, commission approval, conflict resolution, suspension and offboarding are human-governed.
- No downline commission model.

## Partner lifecycle

APPLY → SCREEN → APPROVE → CONTRACT → VERIFY → TRAIN → CERTIFY → AUTHORIZE → ACTIVATE → PRODUCE → REVIEW → DEVELOP → SUSPEND / OFFBOARD

## Review application scope

The current branch implements the full navigational surface and domain rules with synthetic data only. Lead registration uses browser localStorage so the owner can test interaction without creating server-side records.

No production authentication, API write, database migration, ADOREN personal-data access or deployment is included.

## Integration gates

1. Owner UX acceptance.
2. Tenant/security/data review.
3. Auth0 EU identity decision and session contract.
4. Prisma/API model approval.
5. AuditService integration for critical writes.
6. Staging-only migration and synthetic fixtures.
7. Browser acceptance.
8. Explicit production release approval.
