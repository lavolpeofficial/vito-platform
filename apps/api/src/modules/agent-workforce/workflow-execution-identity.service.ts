import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface PersistedWorkflowExecutionIdentity {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly stepType: string;
  readonly attemptNumber: number;
  readonly assuranceLevel: string;
  readonly correlationId: string;
}

@Injectable()
export class WorkflowExecutionIdentityService {
  constructor(private readonly prisma: PrismaService) {}

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

    const task = await this.prisma.task.findFirst({
      where: { id: step.workflowRun.taskId, organizationId },
      select: { id: true, assignedDigitalEmployeeId: true },
    });
    if (!task) throw new NotFoundException('Workflow task not found.');
    if (!task.assignedDigitalEmployeeId) {
      throw new BadRequestException(
        'Persisted workflow agent execution requires a task assigned to a DigitalEmployee.',
      );
    }

    const agent = await this.prisma.digitalEmployee.findFirst({
      where: { id: task.assignedDigitalEmployeeId, organizationId },
      select: { id: true },
    });
    if (!agent) throw new NotFoundException('Assigned DigitalEmployee not found.');

    return Object.freeze({
      organizationId,
      workflowRunId,
      workflowStepRunId,
      taskId: task.id,
      agentId: agent.id,
      stepType: step.stepType,
      attemptNumber: step.attemptNumber,
      assuranceLevel: step.workflowRun.assuranceLevel,
      correlationId: step.workflowRun.correlationId,
    });
  }
}
