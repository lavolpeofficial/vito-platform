import { cookies } from 'next/headers';
import { createPublicVitoApiClient } from '@/lib/api/server';
import { resolveVitoOwnerSession } from './owner-session';
import type { AuthenticatedSession } from './contracts';
import { SESSION_COOKIE_NAME } from './cookie';

export { SESSION_COOKIE_NAME } from './cookie';

/**
 * Private Control Center, not generic organization login.
 * Existing VITO JWT + current user/tenant are re-verified via backend,
 * then matched to the single server-configured owner account.
 */
export async function getAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const client = createPublicVitoApiClient().withAccessToken(token);
    return await resolveVitoOwnerSession(token, client);
  } catch {
    return null;
  }
}
