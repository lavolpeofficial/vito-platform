import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookie';
import { getVitoApiBaseUrl } from './config';
import { VitoApiClient } from './client';
import { VitoApiError } from './error';

export function createPublicVitoApiClient(): VitoApiClient {
  return new VitoApiClient({ baseUrl: getVitoApiBaseUrl() });
}

export async function createAuthenticatedVitoApiClient(): Promise<VitoApiClient> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new VitoApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.' });
  return createPublicVitoApiClient().withAccessToken(token);
}
