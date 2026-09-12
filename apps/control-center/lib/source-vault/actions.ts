'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import { getAuthenticatedSession } from '@/lib/auth/session';
import { inferSourceType, parseHarvestResult, parseSourceUpload } from './contracts';

const SOURCE_VAULT_PATH = '/source-vault';
const MAX_BROWSER_UPLOAD_BYTES = 25 * 1024 * 1024;
type RedirectTarget = Parameters<typeof redirect>[0];

export async function uploadSourceAction(formData: FormData): Promise<void> {
  const session = await getAuthenticatedSession();
  if (!session) redirect('/login');

  const file = formData.get('file');
  if (!(file instanceof File) || file.size <= 0) redirectWith('error', 'EMPTY_FILE');
  if (file.size > MAX_BROWSER_UPLOAD_BYTES) redirectWith('error', 'FILE_TOO_LARGE');

  const payload = new FormData();
  payload.set('file', file, file.name);
  payload.set('sourceType', inferSourceType(file.name, file.type));
  payload.set('ingestedBy', `user:${session.user.id}`);
  copyOptionalString(formData, payload, 'projectKey', 200);
  copyOptionalString(formData, payload, 'domain', 200);
  copyOptionalString(formData, payload, 'language', 32);
  copyOptionalString(formData, payload, 'title', 500);

  let destination = sourceVaultTarget('notice=UPLOAD_FAILED');
  try {
    const client = await createAuthenticatedVitoApiClient();
    const uploaded = await client.postFormData('/source-vault/upload', payload, parseSourceUpload);
    try {
      const harvested = await client.post(
        `/knowledge/sources/${encodeURIComponent(uploaded.source.id)}/harvest`,
        {},
        parseHarvestResult,
      );
      destination = sourceVaultTarget(`notice=${uploaded.duplicate ? 'DUPLICATE_HARVESTED' : 'UPLOADED_HARVESTED'}&units=${harvested.knowledgeUnits}`);
    } catch (error) {
      const code = error instanceof VitoApiError && error.status === 400 ? 'UPLOADED_UNSUPPORTED_FOR_HARVEST' : 'UPLOADED_HARVEST_FAILED';
      destination = sourceVaultTarget(`notice=${code}`);
    }
    revalidatePath(SOURCE_VAULT_PATH);
  } catch (error) {
    destination = sourceVaultTarget(`error=${encodeURIComponent(stableErrorCode(error))}`);
  }
  redirect(destination);
}

export async function harvestSourceAction(formData: FormData): Promise<void> {
  const sourceId = stringField(formData, 'sourceId', 256);
  if (!sourceId) redirectWith('error', 'INVALID_SOURCE');

  let destination = sourceVaultTarget('notice=HARVEST_FAILED');
  try {
    const client = await createAuthenticatedVitoApiClient();
    const result = await client.post(
      `/knowledge/sources/${encodeURIComponent(sourceId)}/harvest`,
      {},
      parseHarvestResult,
    );
    revalidatePath(SOURCE_VAULT_PATH);
    destination = sourceVaultTarget(`notice=HARVESTED&units=${result.knowledgeUnits}`);
  } catch (error) {
    destination = sourceVaultTarget(`error=${encodeURIComponent(stableErrorCode(error))}`);
  }
  redirect(destination);
}

function copyOptionalString(source: FormData, target: FormData, key: string, maxLength: number): void {
  const value = stringField(source, key, maxLength);
  if (value) target.set(key, value);
}

function stringField(formData: FormData, key: string, maxLength: number): string | null {
  const value = formData.get(key);
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function stableErrorCode(error: unknown): string {
  if (error instanceof VitoApiError) return error.code;
  return 'UNEXPECTED_ERROR';
}

function sourceVaultTarget(query: string): RedirectTarget {
  return `${SOURCE_VAULT_PATH}?${query}` as RedirectTarget;
}

function redirectWith(key: 'error' | 'notice', value: string): never {
  redirect(sourceVaultTarget(`${key}=${encodeURIComponent(value)}`));
}
