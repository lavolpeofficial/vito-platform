import { ConflictException } from '@nestjs/common';
import { AgentExecutionStatus, EngineeringCapability, EngineeringStepType } from '@vito/contracts';
import { WorkflowRedTeamEvidenceHandoffService } from './workflow-red-team-evidence-handoff.service';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const TEST_HASH = '1'.repeat(64);
const PACKAGE_HASH = '2'.repeat(64);

function step(id: string, stepType: EngineeringStepType, causationId: string | null, metadata: unknown = {}) {
  return { id, stepType, causationId, metadata, status: stepType === EngineeringStepType.RED_TEAM ? 'READY' : 'SUCCEEDED', startedAt: new Date(), finishedAt: new Date() };
}

function metadata(capabilityCode: EngineeringCapability, invocationId: string, hash: string | null, revisionSha = SHA) {
  return {
    source: 'WORKFLOW_AGENT_RUNTIME',
    executionStatus: AgentExecutionStatus.SUCCEEDED,
    capabilityCode,
    selectedProviderId: 'provider-1',
    executionEvidence: {
      invocationId,
      outputReference: `gov://execution/${invocationId}`,
      revision: { baseSha: revisionSha, changedFiles: [] },
      ...(hash ? { resultSummary: { sha256: hash, content: `${capabilityCode} evidence`, truncated: false, charLength: 20 } } : {}),
    },
  };
}

function record(invocationId: string, hash: string | null, revisionSha = SHA) {
  return {
    id: invocationId,
    outputReference: `gov://execution/${invocationId}`,
    policyDecisionReference: 'policy-v1',
    sideEffectSummary: { filesCreated: [], filesModified: [], filesDeleted: [], commandsExecuted: ['opencode run'], networkCalls: [], artifactsCreated: [] },
    usageMetadata: { durationMs: 10, governedEvidenceBinding: { revisionReference: `gov://revision/${revisionSha}`, ...(hash ? { stdoutSha256Reference: `gov://evidence/stdout-sha256/${hash}` } : {}), exitCode: 0 } },
  };
}

describe('WorkflowRedTeamEvidenceHandoffService', () => {
  const findStep = jest.fn();
  const findRecord = jest.fn();
  const service = new WorkflowRedTeamEvidenceHandoffService({
    workflowStepRun: { findFirst: findStep },
    governedExecutionRecord: { findFirst: findRecord },
  } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    findStep
      .mockResolvedValueOnce(step('red', EngineeringStepType.RED_TEAM, 'pkg'))
      .mockResolvedValueOnce(step('pkg', EngineeringStepType.PACKAGE, 'test', metadata(EngineeringCapability.REVIEW_PACKAGE, 'inv-pkg', PACKAGE_HASH)))
      .mockResolvedValueOnce(step('test', EngineeringStepType.TEST, 'build', metadata(EngineeringCapability.TEST_EXECUTION, 'inv-test', TEST_HASH)))
      .mockResolvedValueOnce(step('build', EngineeringStepType.BUILD, 'plan', metadata(EngineeringCapability.CODE_BUILD, 'inv-build', null)));
    findRecord
      .mockResolvedValueOnce(record('inv-build', null))
      .mockResolvedValueOnce(record('inv-test', TEST_HASH))
      .mockResolvedValueOnce(record('inv-pkg', PACKAGE_HASH));
  });

  it('builds a revision-bound manifest only from the current persisted causation chain', async () => {
    const result = await service.resolve('org-1', 'run-1', 'red');
    expect(result.schemaVersion).toBe('RED_TEAM_EVIDENCE_V1');
    expect(result.testedRevisionSha).toBe(SHA);
    expect(result.entries.map((entry) => entry.stepType)).toEqual(['BUILD', 'TEST', 'PACKAGE']);
    expect(result.entries[1].resultSummary).toEqual(expect.objectContaining({ sha256: TEST_HASH }));
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(findStep.mock.calls[1][0].where).toEqual(expect.objectContaining({ id: 'pkg', organizationId: 'org-1', workflowRunId: 'run-1' }));
  });

  it('fails closed when the causation chain points at a stale or unexpected predecessor', async () => {
    findStep.mockReset();
    findRecord.mockReset();
    findStep
      .mockResolvedValueOnce(step('red', EngineeringStepType.RED_TEAM, 'old-test'))
      .mockResolvedValueOnce(step('old-test', EngineeringStepType.TEST, 'build'));
    await expect(service.resolve('org-1', 'run-1', 'red')).rejects.toThrow('RED_TEAM_EVIDENCE_LINEAGE_STALE');
    expect(findRecord).not.toHaveBeenCalled();
  });

  it('fails closed when TEST and PACKAGE are bound to different revisions', async () => {
    findStep.mockReset();
    findRecord.mockReset();
    findStep
      .mockResolvedValueOnce(step('red', EngineeringStepType.RED_TEAM, 'pkg'))
      .mockResolvedValueOnce(step('pkg', EngineeringStepType.PACKAGE, 'test', metadata(EngineeringCapability.REVIEW_PACKAGE, 'inv-pkg', PACKAGE_HASH, OTHER_SHA)))
      .mockResolvedValueOnce(step('test', EngineeringStepType.TEST, 'build', metadata(EngineeringCapability.TEST_EXECUTION, 'inv-test', TEST_HASH)))
      .mockResolvedValueOnce(step('build', EngineeringStepType.BUILD, 'plan', metadata(EngineeringCapability.CODE_BUILD, 'inv-build', null)));
    findRecord
      .mockResolvedValueOnce(record('inv-build', null))
      .mockResolvedValueOnce(record('inv-test', TEST_HASH))
      .mockResolvedValueOnce(record('inv-pkg', PACKAGE_HASH, OTHER_SHA));
    await expect(service.resolve('org-1', 'run-1', 'red')).rejects.toThrow('RED_TEAM_EVIDENCE_REVISION_MISMATCH');
  });

  it('fails closed when persisted step summary is tampered relative to the execution ledger', async () => {
    findRecord.mockReset();
    findRecord
      .mockResolvedValueOnce(record('inv-build', null))
      .mockResolvedValueOnce(record('inv-test', '9'.repeat(64)))
      .mockResolvedValueOnce(record('inv-pkg', PACKAGE_HASH));
    await expect(service.resolve('org-1', 'run-1', 'red')).rejects.toThrow('RED_TEAM_EVIDENCE_RESULT_BINDING_MISMATCH');
  });

  it('fails closed when authoritative revision binding is missing', async () => {
    findRecord.mockReset();
    findRecord
      .mockResolvedValueOnce({ ...record('inv-build', null), usageMetadata: { durationMs: 10 } })
      .mockResolvedValueOnce(record('inv-test', TEST_HASH))
      .mockResolvedValueOnce(record('inv-pkg', PACKAGE_HASH));
    await expect(service.resolve('org-1', 'run-1', 'red')).rejects.toBeInstanceOf(ConflictException);
  });
});
