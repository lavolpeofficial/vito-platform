import 'server-only';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { parseSpecialistReportsOverview, type SpecialistReportsOverview } from './contracts';

/** Existing JWT/HttpOnly VITO API. No browser Neon secrets or raw messages. */
export async function getSpecialistReportsOverview():Promise<SpecialistReportsOverview> {
  const client=await createAuthenticatedVitoApiClient();
  return client.get('/executive/reports',parseSpecialistReportsOverview);
}
