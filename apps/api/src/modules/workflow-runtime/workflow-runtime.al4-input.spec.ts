import { WorkflowRuntimeService } from './workflow-runtime.service';

describe('WorkflowRuntimeService AL4 state-machine input wiring', () => {
  function buildHarness() {
    const run = {
      id: 'run-1',
      organizationId: 'org-1',
      status: 'RUNNING',
      currentStepType: 'PARSE_VERDICT',
      assuranceLevel: 'AL4',
      correctionLoopCount: 0,
      maxCorrectionLoops: 3,
      correlationId: 'corr-1',
    };
    const step = {
      id: 'step-1',
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      stepType: 'PARSE_VERDICT',
      status: 'READY',
    };
    const tx: any = {
      workflowRun: {
        findFirst: jest.fn().mockResolvedValue(run),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...run, ...data })),
      },
      workflowStepRun: {
        findFirst: jest.fn().mockResolvedValue(step),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'next-step', ...data })),
      },
    };
    const prisma: any = {
      workflowRun: { findFirst: jest.fn().mockResolvedValue(run) },
      workflowStepRun: { findFirst: jest.fn().mockResolvedValue(step) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const auditService: any = { record: jest.fn().mockResolvedValue(undefined) };
    return { service: new WorkflowRuntimeService(prisma, auditService) };
  }

  it('forwards authoritative multi-reviewer evidence so AL4 can advance to VERIFY', async () => {
    const { service } = buildHarness();

    const result = await service.completeStep({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      stepStatus: 'SUCCEEDED',
      reviewResults: [
        { verdict: 'A', findings: [], reviewerExecutionId: 'review-1', assuranceLevel: 'AL4', artifactRefs: [] },
        { verdict: 'A', findings: [], reviewerExecutionId: 'review-2', assuranceLevel: 'AL4', artifactRefs: [] },
      ] as any,
      independenceContext: {
        builderProviderId: 'builder-provider',
        builderModelFamily: 'builder-family',
        previousReviewerProviderIds: ['review-provider-1', 'review-provider-2'],
        previousReviewerModelFamilies: ['review-family-1', 'review-family-2'],
      },
    });

    expect(result.outcome).toEqual({ kind: 'NEXT_STEP', nextStep: 'VERIFY' });
  });

  it('keeps AL4 fail-closed when only the single-verdict shortcut is supplied', async () => {
    const { service } = buildHarness();

    const result = await service.completeStep({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      stepStatus: 'SUCCEEDED',
      verdict: 'A',
    });

    expect(result.outcome).toEqual({
      kind: 'BLOCKED',
      reason: { type: 'ASSURANCE_UNSATISFIED', reason: 'REVIEW_EVIDENCE_INSUFFICIENT' },
    });
  });
});
