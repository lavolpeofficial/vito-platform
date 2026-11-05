# VITO · Private Owner-Only Interactive Access · Candidate

**Date:** 2026-11-05  
**Status:** DRAFT / REVIEW ONLY / NO MERGE / NO DEPLOY  
**Scope:** existing Next.js VITO **Control Center**; no changes to the VITO NestJS execution API or to machine identities.  
**Owner decision:** VITO Cockpit belongs to exactly one human (the President/Owner). LA VOLPE ID is the future central ecosystem login, not a general permission to use VITO.

## Observed baseline (main before this draft)

- `apps/control-center/app/(control-center)/layout.tsx` called `getAuthenticatedSession()` without a unique private-owner allowlist.
- Existing VITO interactive login used a local `POST /auth/login` and VITO JWT with organization role `OWNER|ADMIN|MEMBER|VIEWER`. Organization `OWNER` does not uniquely identify the human who may access the private Control Center.
- `apps/api/src/modules/auth/strategies/jwt.strategy.ts` validates JWT signature/expiry (Passport strategy) and re-fetches current user/organization status and token_version on every API request.
- `apps/control-center/lib/auth/session.ts` loads the current user and organization via authenticated API requests. This remains the trust boundary for the candidate.
- This code audit is **not** a deployment/runtime assertion. A separate production host/UI may have additional controls that must be inspected before rollout.

## Isolated change

`apps/control-center/lib/auth/owner-access.ts` requires simultaneously:
1. a previously backend-validated VITO session;
2. exact server-only `VITO_CONTROL_OWNER_USER_ID` (UUID);
3. exact server-only `VITO_CONTROL_OWNER_ORGANIZATION_ID` (UUID);
4. user role `OWNER` and matching user and organization membership.

No e-mail string, organization slug, browser role flag, PREMIUM subscription, BRIDGE partner role, or another organization's OWNER role grants access. Missing or malformed configuration denies by default.

`owner-session.ts` resolves current user+organization from the real VITO JWT-backed API, and then applies this policy. It is used:
- when an existing session is restored;
- by the Control Center private page layout;
- by `createAuthenticatedVitoApiClient()` for server components/actions that use that helper;
- at `POST /api/auth/login` **before** issuing the HttpOnly browser cookie.

No new password database, API login endpoint, OAuth client, secrets, or Auth0 mutations are introduced.

## Cross-domain identity target: LA VOLPE ID, never four separate password stores

Later VITO SSO **must** authenticate via a centrally verified LA VOLPE ID (pinned OIDC issuer + subject, client/audience, state, nonce, PKCE, JWT signature, expiry, server session/CSRF protection). The private owner binding must still match **exactly one issuer+subject**, be linked to the explicitly authorized local VITO owner user, and require MFA/step-up for sensitive execution. A `role=OWNER` claim or shared SSO login alone must never satisfy the private VITO control gate.

No providerVerified boolean from browser JSON may create a trusted session. A verified OIDC principal is not the same thing as a VITO local JWT: the future exchange/binding requires an explicitly reviewed implementation and separate negative tests.

Each other portal (LA VOLPE, ADOREN, URTALI, BRIDGE, SELECTA, later EMPORIO) retains its own authorization, data protection and consent rules. No cross-portal customer profile is made visible to VITO merely because the account is shared.

## CRITICAL SCOPE DISTINCTION

This candidate restricts **interactive Control Center entry and its server-side API helper**. It does **not** make the entire VITO API owner-only. The existing NestJS backend supports organization-scoped human accounts and authorized machine identities: those should not be silently disabled, and the API itself needs its own documented human-vs-machine access governance and network boundary. A person with separately valid backend credentials may still be able to call backend endpoints directly unless backend/ingress policy is separately restricted. Do not announce full VITO owner-only production enforcement on the strength of this candidate.

## Tests

`node --experimental-strip-types --test apps/control-center/tests/owner-only.test.ts`

16 synthetic isolated checks cover:
- exact account/organization pin;
- a second organization OWNER denied;
- ADMIN/MEMBER/VIEWER denied;
- mismatched organization/tenant denied;
- malformed/missing environment denied;
- no session denied;
- backend user/tenant cross-check;
- forged JWT payload selectors cannot override verified backend result;
- backend failure denies access;
- no automatic allowance from email, role or tier.

**Initial local harness:** 16/16 passed with synthetic fixtures and a modeled backend; a full repository test/build/E2E has not yet been established by this document. Do not replace verified staging proof with fixture-level QA.

## Review and release gates

1. Owner verifies the actual deployed VITO Control Center source/revision and API ingress policy; align before deployment.
2. Identify the existing active VITO local **user UUID + organization UUID** by trusted backend administrative evidence. Configure both server-side (never check personal IDs, passwords, tokens or OIDC subjects into GitHub).
3. Confirm emergency recovery/break-glass process in case of IdP or phone/MFA loss, with human approval and audit. No alternate public login.
4. Run full VITO Control Center tests/build and browser E2E using the approved owner, a different VITO OWNER user, an ADMIN, expired/revoked JWT, and direct backend API negative tests.
5. Security review of API human/machine traffic segregation, reverse proxy restrictions, role changes, session revocation, MFA/step-up, operations availability, audit retention.
6. SSO integration later: reuse LA VOLPE ID provider through a dedicated VITO OIDC client; no cross-domain cookie sharing, no parallel identity platform and no implicit BRIDGE/ADOREN/URTALI access to VITO.
7. Owner explicitly approves rollout and matching rollback plan. Without this, keep draft and leave all live sessions untouched.

**NO-GO:** no merge, production config, deployment, DNS, provider registration, real user enrollment, credential rotation, database migration or API tenant policy mutation in this increment.

## Governance

Control Tower `lavolpeofficial/orientation-systems` issue #8 currently declares OSSERVATORE-LIVE as the active mission while historical `ops/control-tower-v0.1` notes are inconsistent. Treat this as an isolated Owner-GO development candidate requiring central priority alignment, not an autonomous mission switch. The VITO implementation repository owns its Control Center code; the central SSO product architecture is a separate cross-repository contract for LA VOLPE ID.
