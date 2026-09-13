import { BadRequestException } from '@nestjs/common';
import { WorkflowWorkforceAssignmentRequiredException } from '../agent-workforce/workflow-execution-identity.service';
import { WorkflowAgentRunnerService } from './workflow-agent-runner.service';

describe('WorkflowAgentRunnerService', () => {
  const executeCurrentStep = jest.fn();
  const service = new WorkflowAgentRunnerService({ executeCurrentStep } as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs sequential agent steps until the next non-agent boundary', async () => {
    executeCurrentStep
      .mockResolvedValueOnce({
        disposition: 'TRANSITIONED',
        transition: { outcome: { kind: 'NEXT_STEP' } },
      })
      .mockResolvedValueOnce({
        disposition: 'TRANSITIONED',
        transition: { outcome: { kind: 'NEXT_STEP' } },
      })
      .mockResolvedValueOnce({ disposition: 'NON_AGENT_STEP' });

    const result = await service.executeUntilBoundary('org-1', 'run-1');

    expect(result.disposition).toBe('BOUNDARY_REACHED');
    expect(result.boundary).toBe('NON_AGENT_STEP');
    expect(result.stepsExecuted).toBe(3);
    expect(executeCurrentStep).toHaveBeenCalledTimes(3);
  });

  it('surfaces missing governed workforce assignment as a bounded boundary', async () => {
    executeCurrentStep.mockRejectedValueOnce(new WorkflowWorkforceAssignmentRequiredException());

    const result = await service.executeUntilBoundary('org-1', 'run-1');

    expect(result.disposition).toBe('BOUNDARY_REACHED');
    expect(result.boundary).toBe('WORKFORCE_ASSIGNMENT_REQUIRED');
    expect(result.stepsExecuted).toBe(0);
    expect(result.executions).toEqual([]);
    expect(executeCurrentStep).toHaveBeenCalledTimes(1);
  });

  it('does not swallow unrelated bad-request failures', async () => {
    executeCurrentStep.mockRejectedValueOnce(new BadRequestException('unrelated invariant failure'));

    await expect(service.executeUntilBoundary('org-1', 'run-1')).rejects.toThrow('unrelated invariant failure');
  });

  it('stops immediately when execution is provider-blocked', async () => {
    executeCurrentStep.mockResolvedValueOnce({ disposition: 'EXECUTION_BLOCKED' });

    const result = await service.executeUntilBoundary('org-1', 'run-1');

    expect(result.disposition).toBe('BOUNDARY_REACHED');
    expect(result.boundary).toBe('EXECUTION_BLOCKED');
    expect(result.stepsExecuted).toBe(1);
    expect(executeCurrentStep).toHaveBeenCalledTimes(1);
  });

  it('stops after a terminal workflow transition', async () => {
    executeCurrentStep.mockResolvedValueOnce({
      disposition: 'TRANSITIONED',
      transition: { outcome: { kind: 'COMPLETED' } },
    });

    const result = await service.executeUntilBoundary('org-1', 'run-1');

    expect(result.disposition).toBe('BOUNDARY_REACHED');
    expect(result.boundary).toBe('WORKFLOW_COMPLETED');
    expect(result.stepsExecuted).toBe(1);
  });

  it('hard-stops after eight transitions even if every step keeps advancing', async () => {
    executeCurrentStep.mockResolvedValue({
      disposition: 'TRANSITIONED',
      transition: { outcome: { kind: 'NEXT_STEP' } },
    });

    const result = await service.executeUntilBoundary('org-1', 'run-1');

    expect(result.disposition).toBe('MAX_STEPS_REACHED');
    expect(result.boundary).toBe('AUTONOMY_BUDGET_EXHAUSTED');
    expect(result.stepsExecuted).toBe(8);
    expect(executeCurrentStep).toHaveBeenCalledTimes(8);
  });
});
