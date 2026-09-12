'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import { parseMutationResult, type WorkflowNextAction } from './contracts';

const WORKFLOWS_PATH = '/workflows';

export async function workflowAction(formData: FormData): Promise<void> {
  const workflowRunId = field(formData, 'workflowRunId');
  const action = field(formData, 'action') as WorkflowNextAction | null;
  if (!workflowRunId || !action) redirectWorkflow(null, 'INVALID_REQUEST');

  const path = mutationPath(workflowRunId, action);
  if (!path) redirectWorkflow(workflowRunId, 'GOVERNANCE_BOUNDARY');

  try {
    const client = await createAuthenticatedVitoApiClient();
    await client.post(path, {}, parseMutationResult);
    revalidatePath(WORKFLOWS_PATH);
    redirectWorkflow(workflowRunId, action === 'START_RUN' ? 'STARTED' : action === 'RESUME_RUN' ? 'RESUMED' : 'EXECUTED', false);
  } catch (error) {
    const code = error instanceof VitoApiError ? error.code : 'UNEXPECTED_ERROR';
    redirectWorkflow(workflowRunId, code);
  }
}

function mutationPath(workflowRunId: string, action: WorkflowNextAction): `/${string}` | null {
  const id = encodeURIComponent(workflowRunId);
  if (action === 'START_RUN') return `/workflow-runtime/${id}/start`;
  if (action === 'RESUME_RUN') return `/workflow-runtime/${id}/resume`;
  if (action === 'EXECUTE_CURRENT_STEP') return `/workflow-agent-runtime/${id}/execute-current`;
  return null;
}

function field(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

function redirectWorkflow(workflowRunId: string | null, value: string, error = true): never {
  const params = new URLSearchParams();
  if (workflowRunId) params.set('run', workflowRunId);
  params.set(error ? 'error' : 'notice', value);
  redirect(`${WORKFLOWS_PATH}?${params.toString()}` as Parameters<typeof redirect>[0]);
}
