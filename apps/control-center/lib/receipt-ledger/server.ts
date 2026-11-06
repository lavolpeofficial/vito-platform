import 'server-only';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { parseReceiptOverview, type ReceiptOverview } from './contracts';

/**
 * Existing VITO API + HttpOnly JWT only. No browser Neon client, no token in HTML.
 * The endpoint MUST reject access until a separately approved owner-only,
 * per-tenant read credential/source binding has been implemented and verified.
 * A missing endpoint is deliberately surfaced as SOURCE_UNAVAILABLE, not empty data.
 */
export async function getReceiptOverview(): Promise<ReceiptOverview> {
  const client = await createAuthenticatedVitoApiClient();
  return client.get('/executive/receipts', parseReceiptOverview);
}
