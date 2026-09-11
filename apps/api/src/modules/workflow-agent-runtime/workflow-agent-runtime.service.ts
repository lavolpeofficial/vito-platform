import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentExecutionStatus, EngineeringStepType } from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentWorkforceService } from '../agent-workforce/agent-workforce.service';
import { WorkflowExecutionPlanService } from '../agent-workforce/workflow-execution-plan.service';
import { RuntimeOutcomeEvaluationService } from '../learning/runtime-outcome-evaluation.service';
import { WorkflowRuntimeService } from '../workflow-runtime/workflow-runtime.service';

const MAX_TASK_CONTEXT_CHARS = 32_000;

@Injectable()
export class WorkflowAgentRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentWorkforce: AgentWorkforceService,
    private readonly executionPlan: WorkflowExecutionPlanService,
    private readonly workflowRuntime: WorkflowRuntimeService,
    private readonly runtimeOutcome?: RuntimeOutcomeEvaluationService,
  ) {}

  async executeCurrentStep(organizationId: string, workflowRunId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: workflowRunId, organizationId },
      select: {
        id: true,
        taskId: true,
        status: true,
        currentStepType: true,
        assuranceLevel: true,
        correlationId: true,
      },
    });
    if (!run) throw new NotFoundException('WorkflowRun not found.');
    if (run.status !== 'RUNNING') {
      throw new ConflictException(`WorkflowRun is not RUNNING (current: ${run.status}).`);
    }
    if (!run.currentStepType) {
      throw new ConflictException('WorkflowRun has no current step.');
    }

    const step = await this.prisma.workflowStepRun.findFirst({
      where: {
        organizationId,
        workflowRunId,
        stepType: run.currentStepType,
        status: 'READY',
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, stepType: true, attemptNumber: true },
    });
    if (!step) throw new ConflictException('No READY current workflow step found.');

    const capabilityCode = this.executionPlan.capabilityForStep(step.stepType as EngineeringStepType);
    if (!capabilityCode) {
      return Object.freeze({
        disposition: 'NON_AGENT_STEP' as const,
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode: null,
      });
    }

    if (!run.taskId) throw new ConflictException('Agent-executable workflow requires a task identity.');
    const task = await this.prisma.task.findFirst({
      where: { id: run.taskId, organizationId },
      select: { id: true, title: true, description: true, assignedDigitalEmployeeId: true },
    });
    if (!task) throw new NotFoundException('Workflow task not found.');
    if (!task.assignedDigitalEmployeeId) {
      throw new ConflictException('Workflow task is not assigned to a DigitalEmployee.');
    }

    const prompt = this.buildPrompt(step.stepType, task.title, task.description);
    const dispatch = await this.agentWorkforce.dispatch({
      organizationId,
      workflowRunId,
      workflowStepRunId: step.id,
      capabilityCode,
      prompt,
      assuranceLevel: run.assuranceLevel,
      correlationId: run.correlationId,
    });

    const executionStatus = dispatch.execution.status as AgentExecutionStatus;
    const completionStatus = this.toWorkflowCompletionStatus(executionStatus);
    if (!completionStatus) {
      const outcomeEvaluation = await this.recordOutcome({
        organizationId,
        experienceId: dispatch.experienceId,
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode,
        executionStatus,
        transitionKind: null,
      });
      return Object.freeze({
        disposition:
          executionStatus === AgentExecutionStatus.POLICY_BLOCKED ||
          executionStatus === AgentExecutionStatus.QUOTA_BLOCKED
            ? ('EXECUTION_BLOCKED' as const)
            : ('EXECUTION_INCOMPLETE' as const),
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode,
        executionStatus,
        dispatch,
        transition: null,
        outcomeEvaluation,
      });
    }

    const transition = await this.workflowRuntime.completeStep({
      organizationId,
      workflowRunId,
      workflowStepRunId: step.id,
      stepStatus: completionStatus,
      metadata: {
        source: 'WORKFLOW_AGENT_RUNTIME',
        capabilityCode,
        routingDecisionId: dispatch.routingDecisionId,
        selectedProviderId: dispatch.selectedProviderId,
        selectedProviderCode: dispatch.selectedProviderCode,
        experienceId: dispatch.experienceId,
        executionStatus,
      },
    });

    const outcomeEvaluation = await this.recordOutcome({
      organizationId,
      experienceId: dispatch.experienceId,
      workflowRunId,
      workflowStepRunId: step.id,
      stepType: step.stepType,
      capabilityCode,
      executionStatus,
      transitionKind: transition.outcome?.kind ?? null,
    });

    return Object.freeze({
      disposition: 'TRANSITIONED' as const,
      workflowRunId,
      workflowStepRunId: step.id,
      stepType: step.stepType,
      capabilityCode,
      executionStatus,
      dispatch,
      transition,
      outcomeEvaluation,
    });
  }

  private async recordOutcome(input: {
    organizationId: string;
    experienceId: string | null;
    workflowRunId: string;
    workflowStepRunId: string;
    stepType: string;
    capabilityCode: string;
    executionStatus: string;
    transitionKind: string | null;
  }) {
    if (!this.runtimeOutcome || !input.experienceId) return null;
    return this.runtimeOutcome.tryRecord({
      organizationId: input.organizationId,
      experienceId: input.experienceId,
      workflowRunId: input.workflowRunId,
      workflowStepRunId: input.workflowStepRunId,
      stepType: input.stepType,
      capabilityCode: input.capabilityCode,
      executionStatus: input.executionStatus,
      transitionKind: input.transitionKind,
    });
  }

  private buildPrompt(stepType: string, title: string, description: string | null): string {
    return [
      `Execute the persisted VITO engineering workflow step: ${stepType}.`,
      `Task title: ${title}`,
      description ? `Task description: ${description}` : null,
      'Operate only within this workflow step and return bounded execution evidence.',
    ].filter((value): value is string => Boolean(value)).join('\n').slice(0, MAX_TASK_CONTEXT_CHARS);
  }

  private toWorkflowCompletionStatus(status: AgentExecutionStatus): 'SUCCEEDED' | 'FAILED' | null {
    if (status === AgentExecutionStatus.SUCCEEDED) return 'SUCCEEDED';
    if (
      status === AgentExecutionStatus.FAILED ||
      status === AgentExecutionStatus.TIMED_OUT ||
      status === AgentExecutionStatus.CANCELLED
    ) return 'FAILED';
    return null;
  }
}
