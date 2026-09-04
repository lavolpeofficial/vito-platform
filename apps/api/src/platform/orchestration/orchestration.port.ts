export interface WorkRequest {
  organizationId: string;
  workforceInstanceId: string;
  objective: string;
  input: Readonly<Record<string, unknown>>;
  requiredCapabilities: readonly string[];
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  correlationId: string;
}

export interface DelegationDecision {
  digitalEmployeeId: string;
  reason: string;
  confidence?: number;
  requiresHumanApproval: boolean;
  selectedCapabilities: readonly string[];
}

export interface EscalationDecision {
  required: boolean;
  reason?: string;
  targetRole?: string;
}

/**
 * Chooses a Digital Employee and execution policy without performing the run.
 * Runtime execution remains the responsibility of AgentRuntimePort.
 */
export interface OrchestrationPort {
  delegate(request: WorkRequest): Promise<DelegationDecision>;
  evaluateEscalation(
    organizationId: string,
    runId: string,
    result: Readonly<Record<string, unknown>>,
  ): Promise<EscalationDecision>;
}
