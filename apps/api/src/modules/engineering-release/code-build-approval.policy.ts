/** Pure policy only. Approval evidence must be loaded from authoritative server-side persistence. */
export interface CodeBuildApprovalEvidence {
  approvalId: string;
  organizationId: string;
  executionOrganizationId: string;
  missionId: string;
  executionMissionId: string;
  repository: string;
  executionRepository: string;
  branch: string;
  executionBranch: string;
  approvedByHuman: boolean;
  approverIsMachine: boolean;
  revokedAt: Date | null;
  expiresAt: Date;
  approvedAt: Date;
  evaluatedAt: Date;
}

/** This check does not grant approval or authorize merge, deploy, or activation. */
export function hasValidCodeBuildApproval(e: CodeBuildApprovalEvidence): boolean {
  if (!e.approvalId.trim() || !e.organizationId.trim() || e.organizationId !== e.executionOrganizationId) return false;
  if (!e.missionId.trim() || e.missionId !== e.executionMissionId) return false;
  if (e.repository !== 'lavolpeofficial/vito-platform' || e.repository !== e.executionRepository) return false;
  if (!/^feat\/[a-z0-9][a-z0-9-]*$/.test(e.branch) || e.branch !== e.executionBranch) return false;
  if (e.approvedByHuman !== true || e.approverIsMachine !== false || e.revokedAt !== null) return false;
  if (!(e.approvedAt instanceof Date) || !(e.expiresAt instanceof Date) || !(e.evaluatedAt instanceof Date)) return false;
  const approved = e.approvedAt.getTime();
  const expires = e.expiresAt.getTime();
  const now = e.evaluatedAt.getTime();
  if (![approved, expires, now].every(Number.isFinite)) return false;
  return approved <= now && now < expires && approved < expires;
}
