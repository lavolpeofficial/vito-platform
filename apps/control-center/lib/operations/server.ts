import 'server-only';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { parseOperationsSummary, type OperationsSummary } from './contracts';

export async function getOperationsSummary(): Promise<OperationsSummary> {
  const client = await createAuthenticatedVitoApiClient();
  return client.get('/operations/summary', parseOperationsSummary);
}
