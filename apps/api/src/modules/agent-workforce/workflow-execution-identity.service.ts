import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EngineeringStepType } from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowAgentAssignmentService } from './workflow-agent-assignment.service';
import { WorkflowExecutionPlanService } from './workflow-execution-plan.service';

export interface PersistedWorkflowExecutionIdentity {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly stepType: string;
  readonly capabilityCode: string;
  readonly attemptNumber: number;
  readonly assuranceLevel: string;
  readonly correlationId: string;
}

@Injectable()
export class WorkflowExecutionIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executionPlan: WorkflowExecutionPlanService,
    @Optional() private readonly agentAssignments?: WorkflowAgentAssignmentService,
  ) {}

  async resolve(
    organizationId: string,
    workflowRunId: string,
    workflowStepRunId: string,
  ): Promise<PersistedWorkflowExecutionIdentity | null> {
    const step = await this.prisma.workflowStepRun.findUnique({
      where: { id: workflowStepRunId },
      include: { workflowRun: true },
    });

    // Operator Bridge and other internal governed operations intentionally use
    // synthetic correlation IDs. Absence from workflow_step_runs is therefore
    // not itself an error and must preserve those compatibility paths.
    if (!step) return null;

    if (step.organizationId !== organizationId || step.workflowRun.organizationId !== organizationId) {
      throw new NotFoundException('Workflow step not found.');
    }
    if (step.workflowRunId !== workflowRunId || step.workflowRun.id !== workflowRunId) {
      throw new BadRequestException('workflowRunId does not match workflowStepRunId.');
    }
    if (!step.workflowRun.taskId) {
      throw new BadRequestException('Persisted workflow execution requires a task identity.');
    }

    const planEntry = await this.executionPlan.resolveAndBind(
      organizationId,
      workflowRunId,
      step.stepType as EngineeringStepType,
    );

    const assignment = this.agentAssignments
      ? await this.agentAssignments.resolveApproved(organizationId, workflowRunId, step.stepType)
      : null;
    if (assignment && assignment.capabilityCode !== planEntry.capabilityCode) {
      throw new BadRequestException('Approved workflow agent assignment capability does not match server-owned execution plan.');
    }

    const task = await this.prisma.task.findFirst({
      where: { id: step.workflowRun.taskId, organizationId },
      select: { id: true, assignedDigitalEmployeeId: true },
    });
    if (!task) throw new NotFoundException('Workflow task not found.');

    const agentId = assignment?.digitalEmployeeId ?? task.assignedDigitalEmployeeId;
    if (!agentId) {
      throw new BadRequestException(
        'Persisted workflow agent execution requires either an approved step assignment or a task assigned to a DigitalEmployee.',
      );
    }

    const agent = await this.prisma.digitalEmployee.findFirst({
      where: { id: agentId, organizationId },
      select: { id: true, status: true },
    });
    if (!agent) throw new NotFoundException('Assigned DigitalEmployee not found.');
    if (assignment && agent.status !== 'ACTIVE') {
      throw new BadRequestException('Approved workflow-step DigitalEmployee is no longer ACTIVE.');
    }

    return Object.freeze({
      organizationId,
      workflowRunId,
      workflowStepRunId,
      taskId: task.id,
      agentId: agent.id,
      stepType: step.stepType,
      capabilityCode: planEntry.capabilityCode,
      attemptNumber: step.attemptNumber,
      assuranceLevel: step.workflowRun.assuranceLevel,
      correlationId: step.workflowRun.correlationId,
    });
  }
}
