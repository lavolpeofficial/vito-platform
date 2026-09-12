import { cookies } from 'next/headers';
import { createPublicVitoApiClient } from '@/lib/api/server';
import { parseJwtIdentifiers, parseOrganization, parseUser, type AuthenticatedSession } from './contracts';
import { SESSION_COOKIE_NAME } from './cookie';

export { SESSION_COOKIE_NAME } from './cookie';

export async function getAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const identifiers = parseJwtIdentifiers(token);
  if (!identifiers) return null;

  try {
    const client = createPublicVitoApiClient().withAccessToken(token);
    const [user, organization] = await Promise.all([
      client.get(`/users/${encodeURIComponent(identifiers.userId)}`, parseUser),
      client.get(`/organizations/${encodeURIComponent(identifiers.organizationId)}`, parseOrganization),
    ]);
    if (user.id !== identifiers.userId || user.organizationId !== organization.id) return null;
    return { user, organization };
  } catch {
    return null;
  }
}
