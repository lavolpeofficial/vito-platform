import { ConflictException, NotFoundException } from '@nestjs/common';
import { EngineeringStepType, ReviewVerdict } from '@vito/contracts';
import { WorkflowReviewVerdictService } from './workflow-review-verdict.service';

function makeService() {
  const prisma = {
    workflowRun: { findFirst: jest.fn() },
    workflowStepRun: { findFirst: jest.fn() },
  };
  const reviewEvidence = { resolve: jest.fn() };
  const workflowRuntime = { completeStep: jest.fn() };
  return {
    prisma,
    reviewEvidence,
    workflowRuntime,
    service: new WorkflowReviewVerdictService(
      prisma as any,
      reviewEvidence as any,
      workflowRuntime as any,
    ),
  };
}

const evidence = {
  reviewStepRunId: 'step-red',
  invocationId: 'inv-1',
  artifactReferences: ['gov://artifact/review-1'],
  authority: 'GOVERNED_EXECUTION_RECORD',
};

const reviewMetadata = {
  reviewResult: {
    verdict: ReviewVerdict.A,
    findings: [],
    reviewerExecutionId: 'inv-1',
    assuranceLevel: 'AL3',
    artifactRefs: ['gov://artifact/review-1'],
  },
};

describe('WorkflowReviewVerdictService', () => {
  it('transitions PARSE_VERDICT only from governed matching RED_TEAM lineage', async () => {
    const { prisma, reviewEvidence, workflowRuntime, service } = makeService();
    prisma.workflowRun.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'RUNNING',
      currentStepType: EngineeringStepType.PARSE_VERDICT,
      assuranceLevel: 'AL3',
    });
    prisma.workflowStepRun.findFirst
      .mockResolvedValueOnce({ id: 'step-parse' })
      .mockResolvedValueOnce({ id: 'step-red', metadata: reviewMetadata });
    reviewEvidence.resolve.mockResolvedValue(evidence);
    workflowRuntime.completeStep.mockResolvedValue({
      outcome: { kind: 'NEXT_STEP', nextStep: EngineeringStepType.VERIFY },
    });

    const result = await service.parseAndTransition('org-1', 'run-1');

    expect(workflowRuntime.completeStep).toHaveBeenCalledWith({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-parse',
      stepStatus: 'SUCCEEDED',
      verdict: ReviewVerdict.A,
      metadata: {
        source: 'WORKFLOW_REVIEW_VERDICT_RUNTIME',
        reviewStepRunId: 'step-red',
        reviewerExecutionId: 'inv-1',
        assuranceLevel: 'AL3',
        verdict: ReviewVerdict.A,
        authority: 'GOVERNED_EXECUTION_RECORD',
      },
    });
    expect(result).toMatchObject({
      disposition: 'VERDICT_TRANSITIONED',
      verdict: ReviewVerdict.A,
      reviewerExecutionId: 'inv-1',
    });
  });

  it('fails closed for AL4 until multi-reviewer independence evidence exists', async () => {
    const { prisma, reviewEvidence, workflowRuntime, service } = makeService();
    prisma.workflowRun.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'RUNNING',
      currentStepType: EngineeringStepType.PARSE_VERDICT,
      assuranceLevel: 'AL4',
    });

    await expect(service.parseAndTransition('org-1', 'run-1')).rejects.toBeInstanceOf(ConflictException);
    expect(reviewEvidence.resolve).not.toHaveBeenCalled();
    expect(workflowRuntime.completeStep).not.toHaveBeenCalled();
  });

  it('fails closed when persisted ReviewResult lineage does not match governed evidence', async () => {
    const { prisma, reviewEvidence, workflowRuntime, service } = makeService();
    prisma.workflowRun.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'RUNNING',
      currentStepType: EngineeringStepType.PARSE_VERDICT,
      assuranceLevel: 'AL3',
    });
    prisma.workflowStepRun.findFirst
      .mockResolvedValueOnce({ id: 'step-parse' })
      .mockResolvedValueOnce({
        id: 'step-red',
        metadata: {
          reviewResult: {
            ...reviewMetadata.reviewResult,
            reviewerExecutionId: 'inv-forged',
          },
        },
      });
    reviewEvidence.resolve.mockResolvedValue(evidence);

    await expect(service.parseAndTransition('org-1', 'run-1')).rejects.toBeInstanceOf(ConflictException);
    expect(workflowRuntime.completeStep).not.toHaveBeenCalled();
  });

  it('fails closed when the run is outside the tenant', async () => {
    const { prisma, service } = makeService();
    prisma.workflowRun.findFirst.mockResolvedValue(null);
    await expect(service.parseAndTransition('org-foreign', 'run-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
