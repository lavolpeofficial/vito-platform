import { cookies } from 'next/headers';
import { createPublicVitoApiClient } from '@/lib/api/server';
import { resolveVitoSession } from './owner-session';
import { isVitoControlOwnerOnlyEnabled } from './owner-access';
import type { AuthenticatedSession } from './contracts';
import { SESSION_COOKIE_NAME } from './cookie';

export { SESSION_COOKIE_NAME } from './cookie';

/**
 * Existing VITO JWT + current user/tenant are re-verified via backend.
 * After an explicit private rollout switch, require a pinned human Owner.
 */
export async function getAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const client = createPublicVitoApiClient().withAccessToken(token);
    return await resolveVitoSession(token, client, isVitoControlOwnerOnlyEnabled());
  } catch {
    return null;
  }
}
