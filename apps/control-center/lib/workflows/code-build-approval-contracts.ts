export type CodeBuildApprovalState =
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_AMBIGUOUS'
  | 'MACHINE_IDENTITY_REQUIRED'
  | 'MACHINE_IDENTITY_AMBIGUOUS'
  | 'READY';

export type CodeBuildApprovalStatus = Readonly<{
  missionId: string;
  repository: 'lavolpeofficial/vito-platform';
  state: CodeBuildApprovalState;
  machineIdentityCount: number;
  approvals: readonly Readonly<{
    id: string;
    branch: string;
    approvedAt: string;
    expiresAt: string;
    approvedByUserId: string;
  }>[];
  authority: 'READ_ONLY';
}>;

const STATES = new Set<CodeBuildApprovalState>([
  'APPROVAL_REQUIRED',
  'APPROVAL_AMBIGUOUS',
  'MACHINE_IDENTITY_REQUIRED',
  'MACHINE_IDENTITY_AMBIGUOUS',
  'READY',
]);

export function parseCodeBuildApprovalStatus(input: unknown): CodeBuildApprovalStatus | null {
  const root = record(input);
  if (!root || !text(root.missionId) || root.repository !== 'lavolpeofficial/vito-platform') return null;
  if (!STATES.has(root.state as CodeBuildApprovalState) || !integer(root.machineIdentityCount) || root.authority !== 'READ_ONLY') return null;
  if (!Array.isArray(root.approvals) || root.approvals.length > 10) return null;
  const approvals: Array<{ id: string; branch: string; approvedAt: string; expiresAt: string; approvedByUserId: string }> = [];
  for (const item of root.approvals) {
    const row = record(item);
    if (!row || !uuid(row.id) || !branch(row.branch) || !date(row.approvedAt) || !date(row.expiresAt) || !text(row.approvedByUserId)) return null;
    approvals.push({
      id: row.id,
      branch: row.branch,
      approvedAt: row.approvedAt,
      expiresAt: row.expiresAt,
      approvedByUserId: row.approvedByUserId,
    });
  }
  return {
    missionId: root.missionId,
    repository: 'lavolpeofficial/vito-platform',
    state: root.state as CodeBuildApprovalState,
    machineIdentityCount: root.machineIdentityCount,
    approvals,
    authority: 'READ_ONLY',
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 1024; }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function date(value: unknown): value is string { return text(value) && !Number.isNaN(Date.parse(value)); }
function uuid(value: unknown): value is string { return text(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function branch(value: unknown): value is string { return text(value) && /^feat\/[a-z0-9][a-z0-9-]*$/.test(value); }
