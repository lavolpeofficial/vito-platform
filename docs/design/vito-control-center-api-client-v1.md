# VITO Control Center API Client v1

## Scope

The client in `apps/control-center/lib/api` is the single server-side JSON transport from the internal Control Center to the existing NestJS API. It adds no backend endpoint and does not alter any API contract.

## Security invariants

- Authentication uses only the backend-issued Bearer JWT stored in the Control Center's HttpOnly cookie.
- The client never accepts or emits `X-Organization-Id`; tenant authority remains derived by the NestJS API from the verified JWT.
- Request paths must be origin-relative. Absolute and protocol-relative destinations fail before transport.
- Redirect following is disabled so credentials cannot cross an unexpected redirect boundary.
- Every request uses `cache: no-store` and a bounded timeout.
- JSON success responses are size-bounded and must pass an endpoint-specific parser.
- HTTP and transport failures become stable `VitoApiError` codes; bounded backend validation issues remain available only to trusted server-side callers.

## Usage

Server-side modules obtain either:

- `createPublicVitoApiClient()` for the login operation; or
- `createAuthenticatedVitoApiClient()` for protected VITO operations.

Client Components must use narrow same-origin Route Handlers or Server Actions owned by their feature. They must never receive the backend JWT or instantiate an authenticated VITO client in the browser.

Binary SOURCE VAULT content and upload transport are intentionally deferred to the SOURCE VAULT block, where byte limits and media semantics can be implemented against its existing endpoints.
