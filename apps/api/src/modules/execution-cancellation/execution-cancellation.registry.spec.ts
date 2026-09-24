import { ExecutionCancellationRegistry } from './execution-cancellation.registry';

describe('ExecutionCancellationRegistry', () => {
  it('signals all active executions for one tenant-scoped workflow exactly once', () => {
    const registry = new ExecutionCancellationRegistry();
    const cancelA = jest.fn();
    const cancelB = jest.fn();

    registry.register({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-a',
      executionId: 'exec-a',
      cancel: cancelA,
    });
    registry.register({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-b',
      executionId: 'exec-b',
      cancel: cancelB,
    });

    const first = registry.cancelWorkflow('org-1', 'run-1');
    const replay = registry.cancelWorkflow('org-1', 'run-1');

    expect(first.matchedExecutionCount).toBe(2);
    expect(first.signalAttemptCount).toBe(2);
    expect(first.signalFailureCount).toBe(0);
    expect(first.signalledExecutionIds).toEqual(['exec-a', 'exec-b']);
    expect(first.deferredCancellationArmed).toBe(true);
    expect(replay.matchedExecutionCount).toBe(2);
    expect(replay.signalAttemptCount).toBe(0);
    expect(cancelA).toHaveBeenCalledTimes(1);
    expect(cancelB).toHaveBeenCalledTimes(1);
  });

  it('arms a tombstone so an execution registering after workflow cancellation is immediately cancelled', () => {
    const registry = new ExecutionCancellationRegistry();
    const first = registry.cancelWorkflow('org-1', 'run-late');
    const cancel = jest.fn();

    registry.register({
      organizationId: 'org-1',
      workflowRunId: 'run-late',
      workflowStepRunId: 'step-1',
      executionId: 'exec-late',
      cancel,
    });

    expect(first.matchedExecutionCount).toBe(0);
    expect(first.deferredCancellationArmed).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(registry.isWorkflowCancelled('org-1', 'run-late')).toBe(true);
  });

  it('never crosses tenant or workflow boundaries', () => {
    const registry = new ExecutionCancellationRegistry();
    const sameRunOtherTenant = jest.fn();
    const sameTenantOtherRun = jest.fn();

    registry.register({
      organizationId: 'org-2',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      executionId: 'exec-2',
      cancel: sameRunOtherTenant,
    });
    registry.register({
      organizationId: 'org-1',
      workflowRunId: 'run-2',
      workflowStepRunId: 'step-1',
      executionId: 'exec-3',
      cancel: sameTenantOtherRun,
    });

    const result = registry.cancelWorkflow('org-1', 'run-1');

    expect(result.matchedExecutionCount).toBe(0);
    expect(sameRunOtherTenant).not.toHaveBeenCalled();
    expect(sameTenantOtherRun).not.toHaveBeenCalled();
  });

  it('unregisters terminal executions and reports callback failures without throwing', () => {
    const registry = new ExecutionCancellationRegistry();
    const unregister = registry.register({
      organizationId: 'org-1',
      workflowRunId: 'run-1',
      workflowStepRunId: 'step-1',
      executionId: 'exec-1',
      cancel: () => { throw new Error('signal failed'); },
    });

    const failed = registry.cancelWorkflow('org-1', 'run-1');
    unregister();
    const replay = registry.cancelWorkflow('org-1', 'run-1');

    expect(failed.signalFailureCount).toBe(1);
    expect(replay.matchedExecutionCount).toBe(0);
  });
});
