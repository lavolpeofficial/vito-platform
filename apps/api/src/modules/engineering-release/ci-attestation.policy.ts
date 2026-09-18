/**
 * Pure, inactive CI promotion boundary. The caller MUST resolve these values from
 * server-owned GitHub and persistence records, never from an agent request.
 * A passing result authorizes review progression only, never release or merge.
 */
export interface CiPromotionEvidence {
  organizationId: string;
  executionOrganizationId: string;
  repository: string;
  executionRepository: string;
  expectedBranch: string;
  observedBranch: string;
  expectedHeadSha: string;
  observedHeadSha: string;
  workflowPath: string;
  expectedWorkflowPath: string;
  event: string;
  status: string;
  conclusion: string | null;
  matchingRunCount: number;
  runId: number;
  pullRequestDraft: boolean;
  pullRequestHeadSha: string;
  pullRequestBranch: string;
}

/** Reject absent, stale, cross-tenant, ambiguous or unsuccessful CI evidence. */
export function authorizeCiReviewProgression(evidence: CiPromotionEvidence): boolean {
  if (!evidence.organizationId || evidence.organizationId !== evidence.executionOrganizationId) return false;
  if (evidence.repository !== 'lavolpeofficial/vito-platform' || evidence.repository !== evidence.executionRepository) return false;
  if (!/^feat\/[a-z0-9][a-z0-9-]*$/.test(evidence.expectedBranch)) return false;
  if (evidence.expectedBranch !== evidence.observedBranch || evidence.expectedBranch !== evidence.pullRequestBranch) return false;
  if (!/^[0-9a-f]{40}$/.test(evidence.expectedHeadSha)) return false;
  if (evidence.expectedHeadSha !== evidence.observedHeadSha || evidence.expectedHeadSha !== evidence.pullRequestHeadSha) return false;
  if (!evidence.expectedWorkflowPath || evidence.workflowPath !== evidence.expectedWorkflowPath) return false;
  if (evidence.event !== 'pull_request' || evidence.status !== 'completed' || evidence.conclusion !== 'success') return false;
  if (evidence.matchingRunCount !== 1 || !Number.isSafeInteger(evidence.runId) || evidence.runId <= 0) return false;
  if (evidence.pullRequestDraft !== true) return false;
  return true;
}
