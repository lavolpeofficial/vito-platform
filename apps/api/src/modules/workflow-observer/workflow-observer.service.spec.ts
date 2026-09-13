import { NotFoundException } from '@nestjs/common';
import { WorkflowObserverService } from './workflow-observer.service';

describe('WorkflowObserverService', () => {
  const workflowRun = { findFirst: jest.fn() };
  const auditEvent = { findMany: jest.fn() };
  const prisma = { workflowRun, auditEvent } as any;
  const service = new WorkflowObserverService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('returns a tenant-scoped read-only snapshot and bounded timeline', async () => {
    const startedAt = new Date('2026-09-12T05:00:00.000Z');
    workflowRun.findFirst.mockResolvedValue({
      id: 'run-1', organizationId: 'org-1', correlationId: 'corr-1', status: 'RUNNING', currentStepType: 'TEST', assuranceLevel: 'AL2',
      blockReasonCode: null, failureReasonCode: null, correctionLoopCount: 0, maxCorrectionLoops: 3, startedAt, completedAt: null,
      stepRuns: [{ id: 'step-1', stepType: 'TEST', status: 'READY', attemptNumber: 1, causationId: null, startedAt, finishedAt: null }],
    });
    auditEvent.findMany.mockResolvedValue([{ id: 'event-1', actorType: 'SYSTEM', actorId: null, action: 'WORKFLOW_STEP_ACTIVATED', entityType: 'WorkflowStepRun', entityId: 'step-1', metadata: {}, createdAt: startedAt }]);
    const result = await service.observe('org-1', 'run-1');
    expect(workflowRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'run-1', organizationId: 'org-1' } }));
    expect(auditEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1', entityId: { in: ['run-1', 'step-1'] } }, take: 200 }));
    expect(result).toEqual(expect.objectContaining({ workflowRunId: 'run-1', organizationId: 'org-1', boundary: 'ACTIVE', nextAction: 'EXECUTE_CURRENT_STEP', authority: 'READ_ONLY', timelineTruncated: false }));
  });

  it('classifies HUMAN_RELEASE_GATE as explicit human approval rather than an agent step', async () => {
    workflowRun.findFirst.mockResolvedValue({
      id: 'run-gate', organizationId: 'org-1', correlationId: 'corr-gate', status: 'RUNNING', currentStepType: 'HUMAN_RELEASE_GATE', assuranceLevel: 'AL3',
      blockReasonCode: null, failureReasonCode: null, correctionLoopCount: 0, maxCorrectionLoops: 3, startedAt: new Date(), completedAt: null,
      stepRuns: [{ id: 'step-gate', stepType: 'HUMAN_RELEASE_GATE', status: 'READY', attemptNumber: 1, causationId: null, startedAt: new Date(), finishedAt: null }],
    });
    auditEvent.findMany.mockResolvedValue([]);
    const result = await service.observe('org-1', 'run-gate');
    expect(result.boundary).toBe('ACTIVE');
    expect(result.nextAction).toBe('APPROVE_HUMAN_RELEASE');
  });

  it('offers server-owned verdict processing for PARSE_VERDICT at AL1-AL3', async () => {
    workflowRun.findFirst.mockResolvedValue({
      id: 'run-verdict', organizationId: 'org-1', correlationId: 'corr-verdict', status: 'RUNNING', currentStepType: 'PARSE_VERDICT', assuranceLevel: 'AL3',
      blockReasonCode: null, failureReasonCode: null, correctionLoopCount: 0, maxCorrectionLoops: 3, startedAt: new Date(), completedAt: null,
      stepRuns: [{ id: 'step-verdict', stepType: 'PARSE_VERDICT', status: 'READY', attemptNumber: 1, causationId: null, startedAt: new Date(), finishedAt: null }],
    });
    auditEvent.findMany.mockResolvedValue([]);
    const result = await service.observe('org-1', 'run-verdict');
    expect(result.boundary).toBe('ACTIVE');
    expect(result.nextAction).toBe('PROCESS_REVIEW_VERDICT');
  });

  it('keeps PARSE_VERDICT fail-closed at AL4', async () => {
    workflowRun.findFirst.mockResolvedValue({
      id: 'run-verdict-al4', organizationId: 'org-1', correlationId: 'corr-verdict-al4', status: 'RUNNING', currentStepType: 'PARSE_VERDICT', assuranceLevel: 'AL4',
      blockReasonCode: null, failureReasonCode: null, correctionLoopCount: 0, maxCorrectionLoops: 3, startedAt: new Date(), completedAt: null,
      stepRuns: [{ id: 'step-verdict-al4', stepType: 'PARSE_VERDICT', status: 'READY', attemptNumber: 1, causationId: null, startedAt: new Date(), finishedAt: null }],
    });
    auditEvent.findMany.mockResolvedValue([]);
    const result = await service.observe('org-1', 'run-verdict-al4');
    expect(result.boundary).toBe('ACTIVE');
    expect(result.nextAction).toBe('HUMAN_REVIEW_REQUIRED');
  });

  it('fails closed at PARSE_VERDICT when assurance is unavailable', async () => {
    workflowRun.findFirst.mockResolvedValue({
      id: 'run-verdict-unknown', organizationId: 'org-1', correlationId: 'corr-verdict-unknown', status: 'RUNNING', currentStepType: 'PARSE_VERDICT', assuranceLevel: null,
      blockReasonCode: null, failureReasonCode: null, correctionLoopCount: 0, maxCorrectionLoops: 3, startedAt: new Date(), completedAt: null,
      stepRuns: [{ id: 'step-verdict-unknown', stepType: 'PARSE_VERDICT', status: 'READY', attemptNumber: 1, causationId: null, startedAt: new Date(), finishedAt: null }],
    });
    auditEvent.findMany.mockResolvedValue([]);
    const result = await service.observe('org-1', 'run-verdict-unknown');
    expect(result.nextAction).toBe('HUMAN_REVIEW_REQUIRED');
  });

  it('fails closed at RELEASE_EXECUTION because no agent capability owns that step', async () => {
    workflowRun.findFirst.mockResolvedValue({
      id: 'run-release', organizationId: 'org-1', correlationId: 'corr-release', status: 'RUNNING', currentStepType: 'RELEASE_EXECUTION', assuranceLevel: 'AL3',
      blockReasonCode: null, failureReasonCode: null, correctionLoopCount: 0, maxCorrectionLoops: 3, startedAt: new Date(), completedAt: null,
      stepRuns: [{ id: 'step-release', stepType: 'RELEASE_EXECUTION', status: 'READY', attemptNumber: 1, causationId: null, startedAt: new Date(), finishedAt: null }],
    });
    auditEvent.findMany.mockResolvedValue([]);
    const result = await service.observe('org-1', 'run-release');
    expect(result.boundary).toBe('ACTIVE');
    expect(result.nextAction).toBe('HUMAN_REVIEW_REQUIRED');
  });

  it('classifies provider blocks as an explicit resume boundary without mutating the run', async () => {
    workflowRun.findFirst.mockResolvedValue({ id: 'run-2', organizationId: 'org-1', correlationId: 'corr-2', status: 'BLOCKED', currentStepType: 'BUILD', assuranceLevel: 'AL2', blockReasonCode: 'PROVIDER_BLOCKED', failureReasonCode: null, correctionLoopCount: 0, maxCorrectionLoops: 3, startedAt: new Date(), completedAt: null, stepRuns: [] });
    auditEvent.findMany.mockResolvedValue([]);
    const result = await service.observe('org-1', 'run-2');
    expect(result.boundary).toBe('BLOCKED');
    expect(result.nextAction).toBe('RESUME_RUN');
  });

  it('fails closed when the workflow is not visible in the tenant', async () => {
    workflowRun.findFirst.mockResolvedValue(null);
    await expect(service.observe('org-2', 'run-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(auditEvent.findMany).not.toHaveBeenCalled();
  });
});
