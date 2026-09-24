import { Injectable } from '@nestjs/common';

const CANCELLATION_TOMBSTONE_TTL_MS = 60 * 60 * 1000;
const MAX_CANCELLATION_TOMBSTONES = 1_000;

export interface ExecutionCancellationRegistration {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly executionId: string;
  readonly cancel: () => void;
}

export interface WorkflowCancellationSignalResult {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly matchedExecutionCount: number;
  readonly signalAttemptCount: number;
  readonly signalFailureCount: number;
  readonly signalledExecutionIds: readonly string[];
  readonly deferredCancellationArmed: true;
}

interface ActiveExecution extends ExecutionCancellationRegistration {
  cancelRequested: boolean;
}

@Injectable()
export class ExecutionCancellationRegistry {
  private readonly active = new Map<string, ActiveExecution>();
  private readonly cancelledWorkflows = new Map<string, number>();

  register(input: ExecutionCancellationRegistration): () => void {
    this.assertRegistration(input);
    this.pruneExpiredTombstones();

    const key = this.executionKey(input);
    if (this.active.has(key)) {
      throw new Error('EXECUTION_CANCELLATION_DUPLICATE_REGISTRATION');
    }

    const entry: ActiveExecution = { ...input, cancelRequested: false };
    this.active.set(key, entry);

    if (this.isWorkflowCancelled(input.organizationId, input.workflowRunId)) {
      this.signal(entry);
    }

    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      const current = this.active.get(key);
      if (current === entry) this.active.delete(key);
    };
  }

  cancelWorkflow(
    organizationId: string,
    workflowRunId: string,
  ): WorkflowCancellationSignalResult {
    this.assertIdentifier(organizationId, 'organizationId');
    this.assertIdentifier(workflowRunId, 'workflowRunId');
    this.pruneExpiredTombstones();

    const workflowKey = this.workflowKey(organizationId, workflowRunId);
    this.cancelledWorkflows.delete(workflowKey);
    this.cancelledWorkflows.set(
      workflowKey,
      Date.now() + CANCELLATION_TOMBSTONE_TTL_MS,
    );
    this.enforceTombstoneBound();

    const matches = [...this.active.values()].filter(
      (entry) =>
        entry.organizationId === organizationId &&
        entry.workflowRunId === workflowRunId,
    );

    const signalledExecutionIds: string[] = [];
    let signalFailureCount = 0;

    for (const entry of matches) {
      const outcome = this.signal(entry);
      if (outcome === 'SIGNALLED') signalledExecutionIds.push(entry.executionId);
      if (outcome === 'FAILED') signalFailureCount += 1;
    }

    return Object.freeze({
      organizationId,
      workflowRunId,
      matchedExecutionCount: matches.length,
      signalAttemptCount: signalledExecutionIds.length + signalFailureCount,
      signalFailureCount,
      signalledExecutionIds: Object.freeze(signalledExecutionIds),
      deferredCancellationArmed: true as const,
    });
  }

  isWorkflowCancelled(organizationId: string, workflowRunId: string): boolean {
    this.pruneExpiredTombstones();
    const expiresAt = this.cancelledWorkflows.get(
      this.workflowKey(organizationId, workflowRunId),
    );
    return expiresAt !== undefined && expiresAt > Date.now();
  }

  private signal(entry: ActiveExecution): 'SIGNALLED' | 'ALREADY_SIGNALLED' | 'FAILED' {
    if (entry.cancelRequested) return 'ALREADY_SIGNALLED';
    entry.cancelRequested = true;
    try {
      entry.cancel();
      return 'SIGNALLED';
    } catch {
      return 'FAILED';
    }
  }

  private pruneExpiredTombstones(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.cancelledWorkflows) {
      if (expiresAt <= now) this.cancelledWorkflows.delete(key);
    }
  }

  private enforceTombstoneBound(): void {
    while (this.cancelledWorkflows.size > MAX_CANCELLATION_TOMBSTONES) {
      const oldest = this.cancelledWorkflows.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cancelledWorkflows.delete(oldest);
    }
  }

  private executionKey(input: ExecutionCancellationRegistration): string {
    return `${this.workflowKey(input.organizationId, input.workflowRunId)}:${input.workflowStepRunId}:${input.executionId}`;
  }

  private workflowKey(organizationId: string, workflowRunId: string): string {
    return `${organizationId}:${workflowRunId}`;
  }

  private assertRegistration(input: ExecutionCancellationRegistration): void {
    this.assertIdentifier(input.organizationId, 'organizationId');
    this.assertIdentifier(input.workflowRunId, 'workflowRunId');
    this.assertIdentifier(input.workflowStepRunId, 'workflowStepRunId');
    this.assertIdentifier(input.executionId, 'executionId');
    if (typeof input.cancel !== 'function') {
      throw new Error('EXECUTION_CANCELLATION_CALLBACK_REQUIRED');
    }
  }

  private assertIdentifier(value: string, name: string): void {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
      throw new Error(`EXECUTION_CANCELLATION_INVALID_${name.toUpperCase()}`);
    }
  }
}
