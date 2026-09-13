import { ConflictException, NotFoundException } from '@nestjs/common';
import { WorkflowReviewEvidenceService } from './workflow-review-evidence.service';

function makeService() {
  const prisma = {
    workflowRun: { findFirst: jest.fn() },
    workflowStepRun: { findFirst: jest.fn() },
    governedExecutionRecord: { findFirst: jest.fn() },
  };
  return { prisma, service: new WorkflowReviewEvidenceService(prisma as any) };
}

describe('WorkflowReviewEvidenceService', () => {
  it('resolves only authoritative governed RED_TEAM evidence for the same tenant/run/step', async () => {
    const { prisma, service } = makeService();
    prisma.workflowRun.findFirst.mockResolvedValue({ id: 'run-1', correlationId: 'corr-1' });
    prisma.workflowStepRun.findFirst.mockResolvedValue({
      id: 'step-red',
      finishedAt: new Date('2026-09-13T01:00:00Z'),
      metadata: {
        executionEvidence: {
          invocationId: 'inv-1',
          outputReference: 'gov://execution/inv-1',
          artifactReferences: ['gov://artifacts/review-1'],
        },
      },
    });
    prisma.governedExecutionRecord.findFirst.mockResolvedValue({
      id: 'inv-1',
      providerId: 'provider-1',
      capabilityCode: 'RED_TEAM',
      outputReference: 'gov://execution/inv-1',
      artifactReferences: ['gov://artifacts/review-1', 'gov://artifacts/review-2'],
      policyDecisionReference: 'policy-v1',
      completedAt: new Date('2026-09-13T01:00:00Z'),
    });

    const result = await service.resolve('org-1', 'run-1');

    expect(prisma.governedExecutionRecord.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'inv-1',
        organizationId: 'org-1',
        workflowRunId: 'run-1',
        workflowStepRunId: 'step-red',
        capabilityCode: 'RED_TEAM',
        status: 'SUCCEEDED',
      },
      select: expect.any(Object),
    });
    expect(result).toMatchObject({
      workflowRunId: 'run-1',
      reviewStepRunId: 'step-red',
      invocationId: 'inv-1',
      authority: 'GOVERNED_EXECUTION_RECORD',
      verdictInterpretation: 'NOT_PERFORMED',
    });
    expect(result.artifactReferences).toEqual([
      'gov://artifacts/review-1',
      'gov://artifacts/review-2',
    ]);
  });

  it('fails closed when the run does not belong to the tenant', async () => {
    const { prisma, service } = makeService();
    prisma.workflowRun.findFirst.mockResolvedValue(null);
    await expect(service.resolve('org-foreign', 'run-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.workflowStepRun.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed when RED_TEAM has no governed invocation binding', async () => {
    const { prisma, service } = makeService();
    prisma.workflowRun.findFirst.mockResolvedValue({ id: 'run-1', correlationId: 'corr-1' });
    prisma.workflowStepRun.findFirst.mockResolvedValue({ id: 'step-red', metadata: {}, finishedAt: new Date() });
    await expect(service.resolve('org-1', 'run-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.governedExecutionRecord.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed when step-bound references disagree with the governed record', async () => {
    const { prisma, service } = makeService();
    prisma.workflowRun.findFirst.mockResolvedValue({ id: 'run-1', correlationId: 'corr-1' });
    prisma.workflowStepRun.findFirst.mockResolvedValue({
      id: 'step-red',
      finishedAt: new Date(),
      metadata: { executionEvidence: { invocationId: 'inv-1', outputReference: 'gov://execution/other' } },
    });
    prisma.governedExecutionRecord.findFirst.mockResolvedValue({
      id: 'inv-1', providerId: 'provider-1', capabilityCode: 'RED_TEAM',
      outputReference: 'gov://execution/inv-1', artifactReferences: [], policyDecisionReference: 'policy-v1', completedAt: new Date(),
    });
    await expect(service.resolve('org-1', 'run-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
