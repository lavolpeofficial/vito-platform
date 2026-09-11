import { NotFoundException } from '@nestjs/common';
import { EngineeringStepType } from '@vito/contracts';
import { WorkflowVerificationService } from './workflow-verification.service';

describe('WorkflowVerificationService', () => {
  const findRun = jest.fn();
  const findStep = jest.fn();
  const queryRaw = jest.fn();
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    workflowRun: { findFirst: findRun },
    workflowStepRun: { findFirst: findStep },
    $queryRaw: queryRaw,
  };
  const service = new WorkflowVerificationService(prisma as any, audit as any);

  beforeEach(() => {
    jest.clearAllMocks();
    findRun.mockResolvedValue({ id: 'run-1', status: 'RUNNING', currentStepType: EngineeringStepType.PACKAGE, blockReasonCode: null });
    queryRaw.mockImplementation(async () => [{
      id: 'ver-1', organizationId: 'org-1', workflowRunId: 'run-1', workflowStepRunId: 'step-1',
      stepType: 'TEST', ruleCode: 'TEST_EXECUTION_SUCCEEDED', status: 'VERIFIED', evidence: {}, createdAt: new Date(),
    }]);
  });

  it('verifies TEST only when governed TEST_EXECUTION evidence matches', async () => {
    findStep.mockResolvedValue({
      id: 'step-1', stepType: EngineeringStepType.TEST, status: 'SUCCEEDED', attemptNumber: 1,
      metadata: { executionStatus: 'SUCCEEDED', capabilityCode: 'TEST_EXECUTION', experienceId: 'exp-1' },
    });
    const result = await service.verifyStep('org-1', 'run-1', 'step-1');
    expect(result.status).toBe('VERIFIED');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'WORKFLOW_STEP_VERIFIED' }));
  });

  it('keeps BUILD success inconclusive until downstream verification exists', async () => {
    findStep.mockResolvedValue({
      id: 'step-1', stepType: EngineeringStepType.BUILD, status: 'SUCCEEDED', attemptNumber: 1,
      metadata: { executionStatus: 'SUCCEEDED', capabilityCode: 'CODE_BUILD', experienceId: 'exp-1' },
    });
    queryRaw.mockResolvedValueOnce([{ id: 'ver-2', status: 'INCONCLUSIVE', ruleCode: 'BUILD_REQUIRES_DOWNSTREAM_VERIFICATION' }]);
    const result = await service.verifyStep('org-1', 'run-1', 'step-1');
    expect(result.status).toBe('INCONCLUSIVE');
  });

  it('does not verify a successful TEST step when execution metadata is missing', async () => {
    findStep.mockResolvedValue({ id: 'step-1', stepType: EngineeringStepType.TEST, status: 'SUCCEEDED', attemptNumber: 1, metadata: {} });
    queryRaw.mockResolvedValueOnce([{ id: 'ver-3', status: 'INCONCLUSIVE', ruleCode: 'TEST_EVIDENCE_INCOMPLETE' }]);
    const result = await service.verifyStep('org-1', 'run-1', 'step-1');
    expect(result.status).toBe('INCONCLUSIVE');
  });

  it('classifies persisted failed steps as failed verification', async () => {
    findStep.mockResolvedValue({ id: 'step-1', stepType: EngineeringStepType.TEST, status: 'FAILED', attemptNumber: 1, metadata: { executionStatus: 'FAILED' } });
    queryRaw.mockResolvedValueOnce([{ id: 'ver-4', status: 'FAILED', ruleCode: 'STEP_TERMINAL_STATUS' }]);
    const result = await service.verifyStep('org-1', 'run-1', 'step-1');
    expect(result.status).toBe('FAILED');
  });

  it('classifies provider-blocked waiting state without calling it a failure', async () => {
    findRun.mockResolvedValueOnce({ id: 'run-1', status: 'BLOCKED', currentStepType: EngineeringStepType.TEST, blockReasonCode: 'PROVIDER_BLOCKED' });
    findStep.mockResolvedValue({ id: 'step-1', stepType: EngineeringStepType.TEST, status: 'WAITING', attemptNumber: 1, metadata: { executionStatus: 'POLICY_BLOCKED' } });
    queryRaw.mockResolvedValueOnce([{ id: 'ver-5', status: 'BLOCKED', ruleCode: 'PROVIDER_BLOCK_STATE' }]);
    const result = await service.verifyStep('org-1', 'run-1', 'step-1');
    expect(result.status).toBe('BLOCKED');
  });

  it('fails tenant-scoped lookup closed when the workflow run is absent', async () => {
    findRun.mockResolvedValueOnce(null);
    await expect(service.verifyStep('other-org', 'run-1', 'step-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(findStep).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
