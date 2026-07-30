export type AgentRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_FOR_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface AgentRunContext {
  organizationId: string;
  workforceInstanceId: string;
  digitalEmployeeId: string;
  taskId?: string;
  sessionId?: string;
  correlationId: string;
}

export interface StartAgentRunCommand {
  context: AgentRunContext;
  objective: string;
  input: Readonly<Record<string, unknown>>;
  requestedCapabilities: readonly string[];
}

export interface AgentRunResult {
  runId: string;
  status: AgentRunStatus;
  output?: Readonly<Record<string, unknown>>;
  errorCode?: string;
  startedAt: Date;
  finishedAt?: Date;
}

/**
 * Stable control-plane contract for executing a Digital Employee.
 * Implementations may initially run in-process and later move to workers.
 */
export interface AgentRuntimePort {
  start(command: StartAgentRunCommand): Promise<AgentRunResult>;
  getRun(organizationId: string, runId: string): Promise<AgentRunResult | null>;
  cancel(organizationId: string, runId: string, reason: string): Promise<void>;
}
