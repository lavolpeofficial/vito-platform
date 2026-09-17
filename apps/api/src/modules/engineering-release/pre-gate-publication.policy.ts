/** Pure policy boundary. Not wired to a GitHub mutation adapter. */
export type PreGateAction = 'COMMIT' | 'PUSH' | 'DRAFT_PR' | 'CI_READ' | 'MERGE' | 'DEPLOY' | 'ACTIVATE_PROVIDER' | 'ACTIVATE_CAPABILITY' | 'APPROVE_HUMAN_GATE';
export interface PreGatePublicationRequest {
  action: PreGateAction;
  organizationId: string;
  missionOrganizationId: string;
  missionId: string;
  approvedMissionId: string;
  codeBuildApprovedByHuman: boolean;
  codeBuildApprovalActive: boolean;
  repository: string;
  approvedRepository: string;
  branch: string;
  approvedBranch: string;
  actorIsMachine: boolean;
  draft?: boolean;
  ciHeadSha?: string;
  expectedHeadSha?: string;
  ciMatches?: number;
}
export function authorizePreGatePublication(request: PreGatePublicationRequest): boolean {
  if (!['COMMIT', 'PUSH', 'DRAFT_PR', 'CI_READ'].includes(request.action)) return false;
  if (request.actorIsMachine !== true) return false;
  if (!request.organizationId || request.organizationId !== request.missionOrganizationId) return false;
  if (!request.missionId || request.missionId !== request.approvedMissionId) return false;
  if (!request.codeBuildApprovedByHuman || !request.codeBuildApprovalActive) return false;
  if (request.repository !== 'lavolpeofficial/vito-platform' || request.repository !== request.approvedRepository) return false;
  if (!/^feat\/[a-z0-9][a-z0-9-]*$/.test(request.branch) || request.branch !== request.approvedBranch) return false;
  if (request.action === 'DRAFT_PR' && request.draft !== true) return false;
  if (request.action === 'CI_READ' && (!/^[0-9a-f]{40}$/.test(request.expectedHeadSha ?? '') || request.expectedHeadSha !== request.ciHeadSha || request.ciMatches !== 1)) return false;
  return true;
}
