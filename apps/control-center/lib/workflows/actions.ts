'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import { parseHumanReleaseApprovalResult, parseMutationResult, type WorkflowControlAction } from './contracts';

const WORKFLOWS_PATH = '/workflows';

export async function grantCodeBuildApprovalAction(formData: FormData): Promise<void> {
  const workflowRunId = field(formData, 'workflowRunId');
  const workflowStepRunId = field(formData, 'workflowStepRunId');
  const rawBranch = field(formData, 'branch');
  if (!workflowRunId || !workflowStepRunId || !rawBranch || !/^feat\/[a-z0-9][a-z0-9-]*$/.test(rawBranch)) {
    redirectWorkflow(workflowRunId, 'INVALID_CODE_BUILD_APPROVAL');
  }

  const bucketMs = 15 * 60 * 1000;
  const bucket = Math.floor(Date.now() / bucketMs);
  const expiresAt = new Date((bucket + 2) * bucketMs).toISOString();
  const requestKey = `workflow-step:${workflowStepRunId}:${bucket}`;

  try {
    const client = await createAuthenticatedVitoApiClient();
    await client.post('/engineering-release/code-build-approvals', {
      missionId: workflowRunId,
      repository: 'lavolpeofficial/vito-platform',
      branch: rawBranch,
      expiresAt,
      requestKey,
    }, parseMutationResult);
  } catch (error) {
    const code = error instanceof VitoApiError ? error.code : 'UNEXPECTED_ERROR';
    redirectWorkflow(workflowRunId, code);
  }

  revalidatePath(WORKFLOWS_PATH);
  redirectWorkflow(workflowRunId, 'BUILD_APPROVED', false);
}

export async function revokeCodeBuildApprovalAction(formData: FormData): Promise<void> {
  const workflowRunId = field(formData, 'workflowRunId');
  const approvalId = field(formData, 'approvalId');
  if (!workflowRunId || !approvalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(approvalId)) {
    redirectWorkflow(workflowRunId, 'INVALID_CODE_BUILD_APPROVAL');
  }

  try {
    const client = await createAuthenticatedVitoApiClient();
    await client.post(`/engineering-release/code-build-approvals/${encodeURIComponent(approvalId)}/revoke`, {}, parseMutationResult);
  } catch (error) {
    const code = error instanceof VitoApiError ? error.code : 'UNEXPECTED_ERROR';
    redirectWorkflow(workflowRunId, code);
  }

  revalidatePath(WORKFLOWS_PATH);
  redirectWorkflow(workflowRunId, 'BUILD_APPROVAL_REVOKED', false);
}

export async function workflowAction(formData: FormData): Promise<void> {
  const workflowRunId = field(formData, 'workflowRunId');
  const action = field(formData, 'action') as WorkflowControlAction | null;
  if (!workflowRunId || !action) redirectWorkflow(null, 'INVALID_REQUEST');
  if (action === 'CANCEL_RUN' && field(formData, 'confirmCancel') !== 'YES') redirectWorkflow(workflowRunId, 'CANCEL_CONFIRMATION_REQUIRED');

  const path = mutationPath(workflowRunId, action);
  if (!path) redirectWorkflow(workflowRunId, 'GOVERNANCE_BOUNDARY');

  try {
    const client = await createAuthenticatedVitoApiClient();
    if (action === 'APPROVE_HUMAN_RELEASE') {
      await client.post(path, {}, parseHumanReleaseApprovalResult);
    } else {
      await client.post(path, {}, parseMutationResult);
    }
  } catch (error) {
    const code = error instanceof VitoApiError ? error.code : 'UNEXPECTED_ERROR';
    redirectWorkflow(workflowRunId, code);
  }

  revalidatePath(WORKFLOWS_PATH);
  const notice =
    action === 'CANCEL_RUN' ? 'CANCELLED'
      : action === 'START_RUN' ? 'STARTED'
      : action === 'RESUME_RUN' ? 'RESUMED'
        : action === 'APPROVE_HUMAN_RELEASE' ? 'RELEASE_APPROVED'
          : action === 'COORDINATE_AL4_REVIEWS' ? 'AL4_REVIEWS_COORDINATED'
            : action === 'PROCESS_REVIEW_VERDICT' ? 'VERDICT_PROCESSED'
              : 'EXECUTED';
  redirectWorkflow(workflowRunId, notice, false);
}

function mutationPath(workflowRunId: string, action: WorkflowControlAction): `/${string}` | null {
  const id = encodeURIComponent(workflowRunId);
  if (action === 'CANCEL_RUN') return `/workflow-runtime/${id}/cancel`;
  if (action === 'START_RUN') return `/workflow-runtime/${id}/start`;
  if (action === 'RESUME_RUN') return `/workflow-runtime/${id}/resume`;
  if (action === 'EXECUTE_CURRENT_STEP') return `/workflow-agent-runtime/${id}/execute-current`;
  if (action === 'COORDINATE_AL4_REVIEWS') return `/workflow-agent-runtime/${id}/al4-reviews`;
  if (action === 'PROCESS_REVIEW_VERDICT') return `/workflow-agent-runtime/${id}/parse-verdict`;
  if (action === 'APPROVE_HUMAN_RELEASE') return `/workflow-runtime/${id}/human-release-approval`;
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
