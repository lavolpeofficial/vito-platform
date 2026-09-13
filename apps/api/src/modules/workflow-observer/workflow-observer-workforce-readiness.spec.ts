import { EngineeringCapability, EngineeringStepType } from '@vito/contracts';
import { WorkflowObserverService } from './workflow-observer.service';

function runFixture(overrides: Record<string, unknown> = {}) {
  const startedAt = new Date('2026-09-13T08:00:00.000Z');
  return {
    id: 'run-1', organizationId: 'org-1', taskId: 'task-1', correlationId: 'corr-1',
    status: 'RUNNING', currentStepType: EngineeringStepType.PLAN, assuranceLevel: 'AL4',
    blockReasonCode: null, failureReasonCode: null, correctionLoopCount: 0, maxCorrectionLoops: 3,
    startedAt, completedAt: null,
    stepRuns: [{ id: 'step-1', stepType: EngineeringStepType.PLAN, status: 'READY', attemptNumber: 1, causationId: null, startedAt, finishedAt: null }],
    ...overrides,
  };
}

describe('WorkflowObserverService workforce readiness', () => {
  const workflowRun = { findFirst: jest.fn() };
  const auditEvent = { findMany: jest.fn() };
  const task = { findFirst: jest.fn() };
  const capabilityForStep = jest.fn();
  const resolveApproved = jest.fn();
  const service = new WorkflowObserverService(
    { workflowRun, auditEvent, task } as any,
    { capabilityForStep } as any,
    { resolveApproved } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    auditEvent.findMany.mockResolvedValue([]);
    capabilityForStep.mockReturnValue(EngineeringCapability.CODE_PLAN);
  });

  it('fails closed when an agent-capable step has no approved assignment or task DigitalEmployee', async () => {
    workflowRun.findFirst.mockResolvedValue(runFixture());
    resolveApproved.mockResolvedValue(null);
    task.findFirst.mockResolvedValue({ assignedDigitalEmployeeId: null });

    const result = await service.observe('org-1', 'run-1');

    expect(result.nextAction).toBe('HUMAN_REVIEW_REQUIRED');
    expect(resolveApproved).toHaveBeenCalledWith('org-1', 'run-1', EngineeringStepType.PLAN);
  });

  it('keeps execution actionable when a human-approved step assignment exists', async () => {
    workflowRun.findFirst.mockResolvedValue(runFixture());
    resolveApproved.mockResolvedValue({ digitalEmployeeId: 'agent-approved' });

    const result = await service.observe('org-1', 'run-1');

    expect(result.nextAction).toBe('EXECUTE_CURRENT_STEP');
    expect(task.findFirst).not.toHaveBeenCalled();
  });

  it('accepts the persisted task DigitalEmployee fallback without inventing an assignment', async () => {
    workflowRun.findFirst.mockResolvedValue(runFixture());
    resolveApproved.mockResolvedValue(null);
    task.findFirst.mockResolvedValue({ assignedDigitalEmployeeId: 'agent-task' });

    const result = await service.observe('org-1', 'run-1');

    expect(result.nextAction).toBe('EXECUTE_CURRENT_STEP');
  });

  it('fails closed for AL4 RED_TEAM before coordinator routing when workforce is absent', async () => {
    workflowRun.findFirst.mockResolvedValue(runFixture({
      currentStepType: EngineeringStepType.RED_TEAM,
      stepRuns: [{ id: 'step-red', stepType: EngineeringStepType.RED_TEAM, status: 'READY', attemptNumber: 1, causationId: null, startedAt: new Date(), finishedAt: null }],
    }));
    capabilityForStep.mockReturnValue(EngineeringCapability.RED_TEAM);
    resolveApproved.mockResolvedValue(null);
    task.findFirst.mockResolvedValue({ assignedDigitalEmployeeId: null });

    const result = await service.observe('org-1', 'run-1');

    expect(result.nextAction).toBe('HUMAN_REVIEW_REQUIRED');
  });

  it('does not apply workforce readiness to server-owned governance steps', async () => {
    workflowRun.findFirst.mockResolvedValue(runFixture({
      currentStepType: EngineeringStepType.PARSE_VERDICT,
      stepRuns: [{ id: 'step-verdict', stepType: EngineeringStepType.PARSE_VERDICT, status: 'READY', attemptNumber: 1, causationId: null, startedAt: new Date(), finishedAt: null }],
    }));
    capabilityForStep.mockReturnValue(null);

    const result = await service.observe('org-1', 'run-1');

    expect(result.nextAction).toBe('PROCESS_REVIEW_VERDICT');
    expect(resolveApproved).not.toHaveBeenCalled();
  });
});
