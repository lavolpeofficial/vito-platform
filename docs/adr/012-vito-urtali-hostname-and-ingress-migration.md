# ADR-012 — VITO OS under URTALI SYSTEMS: hostname and controlled ingress migration

**Decision date:** 2026-10-28  
**Owner decision:** Approved target architecture  
**Documentation status:** Review branch only; not merged or deployed  
**Implementation status:** NOT IMPLEMENTED; H22 RELEASE = NO-GO

## Context and authority

LA VOLPE is the overarching enterprise/brand environment. URTALI SYSTEMS owns the technology-facing presentation, system architecture, governance, and intended licensing platform. VITO OS is the protected Execution Intelligence/Control Center product operated under URTALI.

The prior target `vito.la-volpe.it` must not be treated as the final product hostname. The owner selected `vito.urtali.com` as the future canonical VITO Control Center address on 2026-10-28.

The existing GitHub Canon assigns VITO execution/runtime responsibility to `vito-platform`; this hostname decision does not move repository ownership, AOE/OSSERVATORE domain authority, tenant responsibility, or product logic.

## Decision

- **Canonical future UI hostname:** `https://vito.urtali.com`.
- **URTALI primary website:** `https://urtali.com` remains the corporate/technology front door; it is not itself the VITO application.
- VITO remains a protected, tenant-aware application requiring application authentication and authorization. A public DNS name must not expose internal API, PostgreSQL, agent executors, control interfaces, or staging endpoints.
- **Existing/legacy hostname:** `vito.la-volpe.it` may remain as-is during development; any later redirect, alias, or retirement requires a separate reviewed migration/cutover approval. Do not share authenticated cookies between `la-volpe.it` and `urtali.com`.
- No changes to VITO API/agent boundaries, human approval gates, owner roles, token revocation, tenant isolation, provider calls, data residency, or release authority are authorized by this decision.

## Observed repository constraints (main branch at decision time)

- `deploy/staging/README.md` specifies loopback-only API and Control Center, an internal Docker network, and no automatic ingress activation.
- `deploy/staging/Caddyfile.preview` is intentionally inert until a separate infrastructure decision; it adds HTTPS, security headers and Basic Auth to the existing application login.
- The Control Center documents an HttpOnly, SameSite=Strict backend-token cookie and server-side API client. Migration must preserve this boundary.
- The project has both existing JWT application authentication and other authentication integration workstreams; the **actual active identity provider/callback configuration must be inventoried and proved before any domain migration**.
- R35 passed 43 full-app PostgreSQL/HTTP assertions in a synthetic isolated environment (owner-supplied evidence); R36 Next.js actual runtime/browser proof remains incomplete. No claim of a completed browser E2E is made.
- Existing R36 worktrees/candidates, H22 release controls, and GitHub Actions governance must not be altered as a side effect of this ADR.

## Rollout gates (separate approvals, not automatic)

1. **Inventory, read-only:** verify authoritative DNS ownership, actual current ingress/Caddy routing, TLS certificate automation, target FSN1/HEL1 boundaries, staging/prod hostnames, deployed identity mode, Auth0/custom callback, logout and allowed-origin settings where applicable. Identify the owner of each configuration. No secrets exported.
2. **R36 functional gate:** pass the real Next.js ⇄ NestJS ⇄ PostgreSQL 16 owner-login and browser acceptance tests in isolated QA; validate logout, token revocation, role/tenant isolation and denied cross-tenant access. Do not substitute static checks.
3. **Protected-domain preview, separately approved:** provision DNS and TLS only after infrastructure approval. Keep preview gated (e.g. ingress Basic Auth plus application authentication), ingress to Control Center only, API on private network, explicit host/HTTPS validation, secure headers, request-body limits, logging/redaction and rate limits.
4. **Identity and web security:** verify explicit Auth0 allowed callback/logout/web origins *if Auth0 is used*; otherwise verify actual local-JWT session flow. Require Secure, HttpOnly, appropriate SameSite and host-only cookies; do not widen cookie Domain. Verify CSRF/Origin rules, CORS allowlist, secure redirects, state/nonce/PKCE where applicable, cross-origin failure cases, and HSTS/TLS against observed configuration.
5. **End-to-end/browser QA:** owner login, protected page navigation, session expiry, revoke+relogin, logout, role-based access, denied viewer mutations, two-tenant isolation, negative host/origin tests and regression of original VITO flows. Capture sanitized evidence across supported browsers and preserve required checks.
6. **Cutover approval:** only after explicit Owner approval and H22 release gates; use a documented rollback plan. Avoid cross-domain cookie forwarding. Prefer keeping `vito.la-volpe.it` inert until deliberate redirect/retirement decision, with no redirect to a broken or unapproved host.
7. **Post-cutover verification:** validate certificate renewal, DNS resolution, logs/privacy, edge security, availability, login/callback/logout and role/tenant policies. Roll back on any security regression.

## Forbidden by this decision

- No DNS, TLS, Caddy, reverse-proxy, Auth0, secrets, hosting, or production/staging configuration mutations now.
- No merge or pull request automatically; no deploy, public launch, provider/agent execution, database migration or changes to existing VITO/BOB/RICCARDO worktrees.
- No bypass of security tests, GitHub Actions cost/approval governance, owner gate, or H22 RELEASE = NO-GO.

## Tracking

An implementation/backlog issue in `lavolpeofficial/vito-platform` tracks the review and distinct approval gates. This ADR becomes an adopted repository record only after a separate review/merge decision; it records the approved target immediately but does **not** prove actual DNS/identity/runtime deployment.
