'use server';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import { parseVerificationRecords, type VerificationRecord, type VerificationStatus } from './contracts';
export type VerificationState = Readonly<{ records: readonly VerificationRecord[]; workflowRunId: string; error: string | null }>;
const statuses = new Set<VerificationStatus>(['VERIFIED','FAILED','INCONCLUSIVE','BLOCKED']);
export async function loadVerification(_previous: VerificationState, formData: FormData): Promise<VerificationState> {
  const workflowRunId = String(formData.get('workflowRunId') ?? '').trim();
  const statusRaw = String(formData.get('status') ?? '').trim();
  if (!workflowRunId) return { records: [], workflowRunId, error: 'WORKFLOW_RUN_ID_REQUIRED' };
  if (statusRaw && !statuses.has(statusRaw as VerificationStatus)) return { records: [], workflowRunId, error: 'STATUS_INVALID' };
  const params = new URLSearchParams({ limit: '200' }); if (statusRaw) params.set('status', statusRaw);
  try { const client = await createAuthenticatedVitoApiClient(); const records = await client.get(`/workflow-verification/${encodeURIComponent(workflowRunId)}?${params.toString()}`, parseVerificationRecords); return { records, workflowRunId, error: null }; }
  catch (caught) { return { records: [], workflowRunId, error: caught instanceof VitoApiError ? caught.code : 'UNEXPECTED_ERROR' }; }
}
