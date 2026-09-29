import { ConflictException } from '@nestjs/common';
import { AgentExecutionStatus, EngineeringCapability, EngineeringStepType, ReviewVerdict } from '@vito/contracts';
import { WorkflowCorrectionContextHandoffService } from './workflow-correction-context-handoff.service';

const FINDING = Object.freeze({
  id: 'RT-001', severity: 'HIGH', category: 'TESTING', summary: 'Persisted evidence is unavailable.',
  evidenceRefs: ['gov://workspace/test'], blocking: true,
});

function steps(overrides: Record<string, any> = {}) {
  return {
    correction: { id: 'correction', stepType: EngineeringStepType.CORRECTION, status: 'READY', causationId: 'parse', metadata: {} },
    parse: {
      id: 'parse', stepType: EngineeringStepType.PARSE_VERDICT, status: 'SUCCEEDED', causationId: 'red',
      metadata: { source: 'WORKFLOW_REVIEW_VERDICT_RUNTIME', authority: 'GOVERNED_EXECUTION_RECORD', verdict: ReviewVerdict.D, reviewStepRunId: 'red', reviewerExecutionId: 'inv-red' },
    },
    red: {
      id: 'red', stepType: EngineeringStepType.RED_TEAM, status: 'SUCCEEDED', causationId: 'pkg',
      metadata: {
        source: 'WORKFLOW_AGENT_RUNTIME', reviewProjectionStatus: 'VALID', executionStatus: AgentExecutionStatus.SUCCEEDED,
        capabilityCode: EngineeringCapability.RED_TEAM, selectedProviderId: 'provider-1',
        executionEvidence: { invocationId: 'inv-red', outputReference: 'gov://execution/inv-red' },
        reviewResult: { verdict: ReviewVerdict.D, reviewerExecutionId: 'inv-red', assuranceLevel: 'AL3', artifactRefs: [], findings: [FINDING] },
      },
    },
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const state = steps(overrides);
  const findStep = jest.fn(async ({ where }: any) => ({ correction: state.correction, parse: state.parse, red: state.red } as any)[where.id] ?? null);
  const findRecord = jest.fn().mockResolvedValue({ id: 'inv-red', outputReference: 'gov://execution/inv-red', policyDecisionReference: 'policy-red' });
  const service = new WorkflowCorrectionContextHandoffService({ workflowStepRun: { findFirst: findStep }, governedExecutionRecord: { findFirst: findRecord } } as any);
  return { service, findStep, findRecord };
}

describe('WorkflowCorrectionContextHandoffService', () => {
  it('builds a bounded manifest from the exact CORRECTION -> PARSE_VERDICT -> RED_TEAM causation chain', async () => {
    const { service, findRecord } = build();
    const result = await service.resolve('org-1', 'run-1', 'correction');
    expect(result).toEqual(expect.objectContaining({
      schemaVersion: 'CORRECTION_CONTEXT_V1', correctionStepRunId: 'correction', parseVerdictStepRunId: 'parse',
      redTeamStepRunId: 'red', reviewerExecutionId: 'inv-red', verdict: ReviewVerdict.D,
      governedExecutionReference: 'gov://execution/inv-red', policyDecisionReference: 'policy-red',
    }));
    expect(result.blockingFindings).toEqual([FINDING]);
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(findRecord).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'inv-red', workflowStepRunId: 'red', capabilityCode: EngineeringCapability.RED_TEAM }) }));
  });

  it('fails closed when PARSE_VERDICT does not causally reference its authoritative RED_TEAM step', async () => {
    const state = steps();
    const { service } = build({ parse: { ...state.parse, causationId: 'old-red' } });
    await expect(service.resolve('org-1', 'run-1', 'correction')).rejects.toThrow('CORRECTION_CONTEXT_VERDICT_AUTHORITY_INVALID');
  });

  it('fails closed when the typed ReviewResult identity is changed after verdict parsing', async () => {
    const state = steps();
    const { service, findRecord } = build({ red: { ...state.red, metadata: { ...state.red.metadata, reviewResult: { ...state.red.metadata.reviewResult, reviewerExecutionId: 'forged' } } } });
    await expect(service.resolve('org-1', 'run-1', 'correction')).rejects.toThrow('CORRECTION_CONTEXT_REVIEW_PROJECTION_INVALID');
    expect(findRecord).not.toHaveBeenCalled();
  });

  it('fails closed on malformed or missing blocking findings', async () => {
    const state = steps();
    const { service } = build({ red: { ...state.red, metadata: { ...state.red.metadata, reviewResult: { ...state.red.metadata.reviewResult, findings: [{ ...FINDING, evidenceRefs: [42] }] } } } });
    await expect(service.resolve('org-1', 'run-1', 'correction')).rejects.toBeInstanceOf(ConflictException);
  });

  it('fails closed when the governed RED_TEAM ledger no longer matches the projected output reference', async () => {
    const { service, findRecord } = build();
    findRecord.mockResolvedValueOnce({ id: 'inv-red', outputReference: 'gov://execution/other', policyDecisionReference: 'policy-red' });
    await expect(service.resolve('org-1', 'run-1', 'correction')).rejects.toThrow('CORRECTION_CONTEXT_EXECUTION_LEDGER_MISMATCH');
  });
});
