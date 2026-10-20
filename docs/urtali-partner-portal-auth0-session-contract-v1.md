# URTALI Partner Portal — Auth0 / Session Contract V1

Status: DRAFT DESIGN ONLY
No tenant/configuration changes authorized.

## Purpose

Define the minimum identity/session contract for the Partner Portal without coupling commercial authorization directly to Auth0 roles.

## Core rule

Auth0 proves identity and session context.

The application database remains authoritative for:
- partner membership
- business role
- authorization
- portfolio permission
- market limits
- validity
- opportunity role
- policy acknowledgement

Do not encode the entire commercial permission model in Auth0.

## Identity subject

Primary stable identity:
`auth0_sub`

Application resolves:

`auth0_sub -> user -> partner_person -> membership(s)`

Do not use email as immutable identity key.

## Minimum identity claims

Expected:
- sub
- iss
- aud
- exp
- iat
- email where available
- email_verified where available

Optional presentation claims:
- name
- given_name
- family_name
- picture
- locale

No commercial permission may rely solely on presentation claims.

## Organization / membership selection

If one person can later belong to multiple partner organizations, active organization must be explicit.

Session context should resolve:
- active_user_id
- active_partner_person_id
- active_membership_id
- active_partner_organization_id

Switching active membership requires server validation.

## Effective permission lookup

For each governed action:

1. validate session
2. resolve active membership
3. verify membership active
4. verify policy acknowledgements required for action
5. resolve business role
6. resolve authorization
7. resolve portfolio permission
8. verify market / limits / validity
9. verify resource scope / opportunity assignment
10. allow or deny
11. audit critical result

## Session object exposed to UI

Safe UI session projection may include:

- displayName
- email
- partnerOrganizationDisplayName
- businessRole
- authorizationLevel
- academyProgressSummary
- locale
- non-sensitive feature flags

It must not include:
- provider secrets
- admin secrets
- raw authorization rules
- ADOREN personal evidence
- other organizations' identifiers unless needed
- internal compliance notes

## Cookie/session controls

Target:
- HttpOnly
- Secure in HTTPS environments
- SameSite=Lax by default unless architecture proves another mode necessary
- explicit expiry
- rolling session only if justified
- logout invalidates local session
- support server-side revocation / disabled membership checks

## Revalidation

Commercial authorization can change independently from identity.

Therefore governed requests must not trust a long-lived cached role.

Recommended:
- identity session can persist
- effective commercial permission is re-resolved server-side
- revocation/expiry must take effect without requiring user to clear browser data

## Policy acknowledgement gate

Session UI may indicate:
- policy current
- acknowledgement required

But enforcement occurs server-side.

Example:
`ACK_REQUIRED -> sales write denied until current policy version accepted`

## Admin separation

Partner portal user session does not imply internal admin session.

Internal roles such as:
- URTALI_ADMIN
- COMMERCIAL_OWNER
- COMPLIANCE_REVIEWER
- FINANCE_REVIEWER
- SUPPORT

must be separately granted and server-verified.

Admin routes should not rely only on hidden navigation.

## Failure behavior

Authentication failure:
- return login/session-required response

Authorization failure:
- return forbidden
- do not reveal existence of cross-scope sensitive resource where inappropriate

Expired commercial authorization:
- user may remain logged in
- governed action denied
- UI can explain authorization expired

Suspended/offboarded membership:
- portal access restricted according to policy
- sessions effectively revoked/denied on next validation

## Audit

Audit:
- login success/failure where available
- logout
- session revocation
- membership switch
- denied governed action
- admin impersonation if ever introduced (not planned for MVP)

Do not log tokens.

## MVP decision

Auth0 is identity/session infrastructure, not the commercial policy engine.

Final implementation requires:
- owner approval
- exact Auth0 EU tenant/application review
- redirect/logout URL review
- secret storage review
- staging-only test
- negative authorization tests

No Auth0 change is authorized by this document.
