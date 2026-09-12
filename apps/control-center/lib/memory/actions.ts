'use server';

import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import { parseMemoryEntries, type MemoryEntry, type MemoryScope } from './contracts';

export type MemorySearchState = Readonly<{ entries: readonly MemoryEntry[]; error: string | null; query: string }>;

const allowedScopes = new Set<MemoryScope>(['GLOBAL', 'ORGANIZATION', 'PROJECT', 'CUSTOMER', 'AGENT', 'WORKFLOW']);

export async function searchMemory(_previous: MemorySearchState, formData: FormData): Promise<MemorySearchState> {
  const query = String(formData.get('query') ?? '').trim();
  const scopeRaw = String(formData.get('scope') ?? '').trim();
  const scopeId = String(formData.get('scopeId') ?? '').trim();
  if (!query || query.length > 512) return { entries: [], error: 'QUERY_INVALID', query };
  const scope = scopeRaw ? scopeRaw as MemoryScope : null;
  if (scope && !allowedScopes.has(scope)) return { entries: [], error: 'SCOPE_INVALID', query };
  const unscoped = scope === 'GLOBAL' || scope === 'ORGANIZATION';
  if (scope && !unscoped && !scopeId) return { entries: [], error: 'SCOPE_ID_REQUIRED', query };

  const params = new URLSearchParams({ q: query, limit: '20' });
  if (scope) params.set('scope', scope);
  if (scope && !unscoped) params.set('scopeId', scopeId);
  try {
    const client = await createAuthenticatedVitoApiClient();
    const entries = await client.get(`/memory/search?${params.toString()}`, parseMemoryEntries);
    return { entries, error: null, query };
  } catch (caught) {
    return { entries: [], error: caught instanceof VitoApiError ? caught.code : 'UNEXPECTED_ERROR', query };
  }
}
