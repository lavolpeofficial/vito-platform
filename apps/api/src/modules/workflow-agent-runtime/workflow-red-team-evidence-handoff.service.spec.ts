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
    usageMetadata: {
      durationMs: 10,
      governedEvidenceBinding: { revisionReference: `gov://revision/${revisionSha}`, ...(hash ? { stdoutSha256Reference: `gov://evidence/stdout-sha256/${hash}` } : {}), exitCode: 0 },
      ...(hash ? { governedRuntimeEvidence: {
        workspaceDisposition: 'CLEANED',
        ephemeralMaterialDisposition: 'REMOVED',
        settling: { executionId: `worker-${invocationId}`, revisionReference: `gov://revision/${revisionSha}`, changedFiles: [], empty: true, patchSha256Reference: `gov://evidence/patch-sha256/${'3'.repeat(64)}` },
        providerIdentityPostcondition: { enforced: true, passed: true, observedProviderId: 'openai', observedModelId: 'gpt-5.6-sol' },
        flight001Acceptance: { checked: true, passed: invocationId === 'inv-test' },
      } } : {}),
    },
  };
}

describe('WorkflowRedTeamEvidenceHandoffService', () => {
  const findStep = jest.fn();
  const findRecord = jest.fn();
  const capabilityForStep = jest.fn();
  const service = new WorkflowRedTeamEvidenceHandoffService({
    workflowStepRun: { findFirst: findStep },
    governedExecutionRecord: { findFirst: findRecord },
  } as any, { capabilityForStep } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    findStep.mockReset();
    findRecord.mockReset();
    capabilityForStep.mockReset();
    capabilityForStep.mockReturnValue(null);
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
    expect(result.schemaVersion).toBe('RED_TEAM_EVIDENCE_V2');
    expect(result.testedRevisionSha).toBe(SHA);
    expect(result.entries.map((entry) => entry.stepType)).toEqual(['BUILD', 'TEST', 'PACKAGE']);
    expect(result.entries[1].resultSummary).toEqual(expect.objectContaining({ sha256: TEST_HASH }));
    expect(result.entries[1].runtimeEvidence).toEqual(expect.objectContaining({
      workspaceDisposition: 'CLEANED', ephemeralMaterialDisposition: 'REMOVED', ledgerStatus: 'SUCCEEDED',
      providerIdentityPostcondition: expect.objectContaining({ passed: true, observedProviderId: 'openai' }),
    }));
    expect(result.humanReleaseBoundary).toEqual({
      authority: 'HUMAN_EXPLICIT_ONLY',
      agentRuntimeDisposition: 'NON_AGENT_STEP',
      humanReleaseGate: { agentExecutable: false, capabilityCode: null },
      releaseExecution: { agentExecutable: false, capabilityCode: null },
    });
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
  it('fails closed when TEST runtime cleanup/change-set evidence is missing from the execution ledger', async () => {
    findRecord.mockReset();
    findRecord
      .mockResolvedValueOnce(record('inv-build', null))
      .mockResolvedValueOnce({ ...record('inv-test', TEST_HASH), usageMetadata: { governedEvidenceBinding: { revisionReference: `gov://revision/${SHA}`, stdoutSha256Reference: `gov://evidence/stdout-sha256/${TEST_HASH}`, exitCode: 0 } } })
      .mockResolvedValueOnce(record('inv-pkg', PACKAGE_HASH));
    await expect(service.resolve('org-1', 'run-1', 'red')).rejects.toThrow('RED_TEAM_EVIDENCE_RUNTIME_POSTCONDITIONS_INVALID');
  });

  it('fails closed when TEST lacks a passed authoritative Flight-001 acceptance postcondition', async () => {
    findRecord.mockReset();
    const bad = record('inv-test', TEST_HASH);
    (bad.usageMetadata as any).governedRuntimeEvidence.flight001Acceptance = { checked: true, passed: false };
    findRecord
      .mockResolvedValueOnce(record('inv-build', null))
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(record('inv-pkg', PACKAGE_HASH));
    await expect(service.resolve('org-1', 'run-1', 'red')).rejects.toThrow('RED_TEAM_EVIDENCE_FLIGHT_001_ACCEPTANCE_INVALID');
  });

  it('fails closed if HUMAN_RELEASE_GATE or RELEASE_EXECUTION ever becomes agent-executable', async () => {
    capabilityForStep.mockImplementation((stepType: EngineeringStepType) =>
      stepType === EngineeringStepType.HUMAN_RELEASE_GATE ? EngineeringCapability.CODE_BUILD : null,
    );
    await expect(service.resolve('org-1', 'run-1', 'red')).rejects.toThrow('RED_TEAM_EVIDENCE_HUMAN_RELEASE_BOUNDARY_INVALID');
  });

});
