import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowRuntimeService } from './workflow-runtime.service';

@Injectable()
export class HumanReleaseApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowRuntime: WorkflowRuntimeService,
    private readonly auditService: AuditService,
  ) {}

  async approve(input: {
    organizationId: string;
    workflowRunId: string;
    approvedByUserId: string;
    isMachineIdentity: boolean;
  }) {
    if (input.isMachineIdentity) {
      throw new ForbiddenException('Human release approval requires an authenticated human user.');
    }

    const run = await this.prisma.workflowRun.findFirst({
      where: {
        id: input.workflowRunId,
        organizationId: input.organizationId,
      },
      select: {
        id: true,
        status: true,
        currentStepType: true,
        correlationId: true,
      },
    });

    if (!run) {
      throw new NotFoundException('WorkflowRun not found.');
    }

    if (run.status !== 'RUNNING' || run.currentStepType !== 'HUMAN_RELEASE_GATE') {
      throw new ConflictException(
        `WorkflowRun is not awaiting HUMAN_RELEASE_GATE approval (status=${run.status}, currentStepType=${run.currentStepType ?? 'none'}).`,
      );
    }

    const step = await this.prisma.workflowStepRun.findFirst({
      where: {
        organizationId: input.organizationId,
        workflowRunId: input.workflowRunId,
        stepType: 'HUMAN_RELEASE_GATE',
        status: 'READY',
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
      },
    });

    if (!step) {
      throw new ConflictException('No READY HUMAN_RELEASE_GATE step exists for this workflow run.');
    }

    const transition = await this.workflowRuntime.completeStep({
      organizationId: input.organizationId,
      workflowRunId: input.workflowRunId,
      workflowStepRunId: step.id,
      stepStatus: 'SUCCEEDED',
      humanApproved: true,
      metadata: {
        source: 'HUMAN_RELEASE_APPROVAL',
        approvedByUserId: input.approvedByUserId,
      },
    });

    if (
      transition.idempotent ||
      transition.outcome?.kind !== 'NEXT_STEP' ||
      transition.outcome.nextStep !== 'RELEASE_EXECUTION'
    ) {
      throw new ConflictException('Human release approval did not produce RELEASE_EXECUTION.');
    }

    await this.auditService.record({
      organizationId: input.organizationId,
      actorType: 'USER',
      actorId: input.approvedByUserId,
      action: 'HUMAN_RELEASE_APPROVED',
      entityType: 'WorkflowRun',
      entityId: input.workflowRunId,
      metadata: {
        workflowStepRunId: step.id,
        correlationId: run.correlationId,
        nextStep: 'RELEASE_EXECUTION',
      },
    });

    return Object.freeze({
      disposition: 'HUMAN_RELEASE_APPROVED' as const,
      workflowRunId: input.workflowRunId,
      workflowStepRunId: step.id,
      approvedByUserId: input.approvedByUserId,
      nextStep: 'RELEASE_EXECUTION' as const,
      executionTriggered: false as const,
      authority: 'HUMAN_EXPLICIT' as const,
    });
  }
}
