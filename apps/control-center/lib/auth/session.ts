import { cookies } from 'next/headers';
import { getVitoApiBaseUrl } from './config';
import { parseJwtIdentifiers, parseOrganization, parseUser, type AuthenticatedSession } from './contracts';

export const SESSION_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-vito_session' : 'vito_session';

export async function getAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const identifiers = parseJwtIdentifiers(token);
  if (!identifiers) return null;

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const baseUrl = getVitoApiBaseUrl();

  try {
    const [userResponse, organizationResponse] = await Promise.all([
      fetch(`${baseUrl}/users/${encodeURIComponent(identifiers.userId)}`, { headers, cache: 'no-store' }),
      fetch(`${baseUrl}/organizations/${encodeURIComponent(identifiers.organizationId)}`, { headers, cache: 'no-store' }),
    ]);
    if (!userResponse.ok || !organizationResponse.ok) return null;

    const user = parseUser(await userResponse.json());
    const organization = parseOrganization(await organizationResponse.json());
    if (!user || !organization || user.id !== identifiers.userId || user.organizationId !== organization.id) return null;
    return { user, organization };
  } catch {
    return null;
  }
}
