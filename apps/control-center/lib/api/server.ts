import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookie';
import { resolveVitoSession } from '@/lib/auth/owner-session';
import { isVitoControlOwnerOnlyEnabled } from '@/lib/auth/owner-access';
import { getVitoApiBaseUrl } from './config';
import { VitoApiClient } from './client';
import { VitoApiError } from './error';

export function createPublicVitoApiClient(): VitoApiClient {
  return new VitoApiClient({ baseUrl: getVitoApiBaseUrl() });
}

/**
 * No server component/server action can obtain an authenticated VITO API
 * client via this helper without fresh backend authentication.
 * When private mode is explicitly enabled, the single Owner pin is required. The backend
 * continues to verify the JWT on each endpoint independently.
 */
export async function createAuthenticatedVitoApiClient(): Promise<VitoApiClient> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new VitoApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.' });
  const client = createPublicVitoApiClient().withAccessToken(token);
  const owner = await resolveVitoSession(token, client, isVitoControlOwnerOnlyEnabled());
  if (!owner) throw new VitoApiError({ status: 403, code: 'FORBIDDEN', message: 'Authorized owner access required.' });
  return client;
}
