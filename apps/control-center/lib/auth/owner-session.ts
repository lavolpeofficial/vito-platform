import type { VitoApiClient } from '../api/client.ts';
import { parseJwtIdentifiers, parseOrganization, parseUser, type AuthenticatedSession } from './contracts.ts';
import { isVitoInteractiveOwner, type VitoOwnerPolicy } from './owner-access.ts';

/**
 * Resolve the single permitted interactive account through the existing
 * VITO backend. JWT parsing only selects lookup IDs, never proves identity.
 * The backend validates JWT and current user+tenant status on each read.
 * This is NOT a shared OIDC/SSO implementation.
 */
export async function resolveVitoSession(
  token: string,
  client: Pick<VitoApiClient, 'get'>,
  ownerOnly: boolean,
  policy?: VitoOwnerPolicy,
): Promise<AuthenticatedSession | null> {
  const ids = parseJwtIdentifiers(token);
  if (!ids) return null;
  const [user, organization] = await Promise.all([
    client.get(`/users/${encodeURIComponent(ids.userId)}`, parseUser),
    client.get(`/organizations/${encodeURIComponent(ids.organizationId)}`, parseOrganization),
  ]);
  if (user.id !== ids.userId || user.organizationId !== ids.organizationId || organization.id !== ids.organizationId) return null;
  const session: AuthenticatedSession = { user, organization };
  return !ownerOnly || isVitoInteractiveOwner(session, policy) ? session : null;
}

/** Explicit fail-closed owner resolver, retained for isolated security tests and callers that always require owner access. */
export async function resolveVitoOwnerSession(
  token: string,
  client: Pick<VitoApiClient, 'get'>,
  policy?: VitoOwnerPolicy,
): Promise<AuthenticatedSession | null> {
  return resolveVitoSession(token, client, true, policy);
}
