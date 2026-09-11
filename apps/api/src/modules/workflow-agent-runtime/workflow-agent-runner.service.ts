import { Injectable } from '@nestjs/common';
import { WorkflowVerificationService } from '../workflow-verification/workflow-verification.service';
import { WorkflowAgentRuntimeService } from './workflow-agent-runtime.service';

const MAX_AUTONOMOUS_STEPS = 8;

type StepExecution = Awaited<ReturnType<WorkflowAgentRuntimeService['executeCurrentStep']>>;

@Injectable()
export class WorkflowAgentRunnerService {
  constructor(
    private readonly runtime: WorkflowAgentRuntimeService,
    private readonly verification?: WorkflowVerificationService,
  ) {}

  async executeUntilBoundary(organizationId: string, workflowRunId: string) {
    const executions: StepExecution[] = [];

    for (let index = 0; index < MAX_AUTONOMOUS_STEPS; index += 1) {
      const execution = await this.runtime.executeCurrentStep(organizationId, workflowRunId);
      executions.push(execution);

      if (
        this.verification &&
        (execution.disposition === 'TRANSITIONED' || execution.disposition === 'EXECUTION_BLOCKED')
      ) {
        await this.verification.tryVerifyStep(organizationId, workflowRunId, execution.workflowStepRunId);
      }

      if (execution.disposition !== 'TRANSITIONED') {
        return Object.freeze({
          disposition: 'BOUNDARY_REACHED' as const,
          boundary: execution.disposition,
          workflowRunId,
          stepsExecuted: executions.length,
          executions: Object.freeze([...executions]),
        });
      }

      const transitionKind = execution.transition.outcome?.kind ?? null;
      if (transitionKind !== 'NEXT_STEP') {
        return Object.freeze({
          disposition: 'BOUNDARY_REACHED' as const,
          boundary: transitionKind ? `WORKFLOW_${transitionKind}` : 'WORKFLOW_INDETERMINATE',
          workflowRunId,
          stepsExecuted: executions.length,
          executions: Object.freeze([...executions]),
        });
      }
    }

    return Object.freeze({
      disposition: 'MAX_STEPS_REACHED' as const,
      boundary: 'AUTONOMY_BUDGET_EXHAUSTED' as const,
      workflowRunId,
      stepsExecuted: executions.length,
      executions: Object.freeze([...executions]),
    });
  }
}
