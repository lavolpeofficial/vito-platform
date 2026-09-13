import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  nextEngineeringStep,
  DEFAULT_RETRY_POLICY,
  type StateMachineInput,
  type TransitionOutcome,
  type BlockReason,
  type ReviewResult,
  type IndependenceContext,
} from '@vito/contracts';
import {
  WorkflowRunStatus,
  WorkflowStepStatus,
  EngineeringStepType,
  AgentExecutionStatus,
} from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { randomUUID } from 'crypto';

export interface CreateWorkflowRunInput {
  organizationId: string;
  taskId?: string;
  workflowDefinitionCode: string;
  workflowDefinitionVersion: string;
  assuranceLevel: string;
  correlationId?: string;
  maxCorrectionLoops?: number;
}

export interface CompleteStepInput {
  organizationId: string;
  workflowRunId: string;
  workflowStepRunId: string;
  stepStatus: 'SUCCEEDED' | 'FAILED';
  providerStatus?: AgentExecutionStatus;
  verdict?: string;
  reviewResults?: readonly ReviewResult[];
  independenceContext?: IndependenceContext;
  humanApproved?: boolean;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class WorkflowRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createRun(input: CreateWorkflowRunInput) {
    const correlationId = input.correlationId ?? randomUUID();
    const maxCorrectionLoops = input.maxCorrectionLoops ?? DEFAULT_RETRY_POLICY.maxCorrectionLoops;

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.workflowRun.create({
        data: {
          organizationId: input.organizationId,
          taskId: input.taskId ?? null,
          workflowDefinitionCode: input.workflowDefinitionCode,
          workflowDefinitionVersion: input.workflowDefinitionVersion,
          assuranceLevel: input.assuranceLevel,
          status: 'CREATED',
          correctionLoopCount: 0,
          maxCorrectionLoops,
          correlationId,
        },
      });

      await this.auditService.record(
        {
          organizationId: input.organizationId,
          actorType: 'SYSTEM',
          action: 'WORKFLOW_RUN_CREATED',
          entityType: 'WorkflowRun',
          entityId: run.id,
          metadata: {
            workflowDefinitionCode: run.workflowDefinitionCode,
            workflowDefinitionVersion: run.workflowDefinitionVersion,
            assuranceLevel: run.assuranceLevel,
            correlationId: run.correlationId,
            ...(run.taskId ? { taskId: run.taskId } : {}),
          },
        },
        tx,
      );

      return run;
    });
  }

  async startRun(organizationId: string, workflowRunId: string) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.workflowRun.findFirst({
        where: { id: workflowRunId, organizationId },
      });
      if (!run) throw new NotFoundException('WorkflowRun nicht gefunden.');
      if (run.status !== 'CREATED') {
        throw new ConflictException(`WorkflowRun ist nicht im CREATED-Status (aktuell: ${run.status}).`);
      }

      const now = new Date();
      const updated = await tx.workflowRun.update({
        where: { id: workflowRunId },
        data: {
          status: 'RUNNING',
          currentStepType: 'PLAN',
          startedAt: now,
        },
      });

      const firstStep = await tx.workflowStepRun.create({
        data: {
          organizationId,
          workflowRunId,
          stepType: 'PLAN',
          status: 'READY',
          attemptNumber: 1,
          startedAt: now,
        },
      });

      await this.auditService.record(
        {
          organizationId,
          actorType: 'SYSTEM',
          action: 'WORKFLOW_RUN_STARTED',
          entityType: 'WorkflowRun',
          entityId: workflowRunId,
          metadata: {
            firstStepType: 'PLAN',
            firstStepRunId: firstStep.id,
          },
        },
        tx,
      );

      await this.auditService.record(
        {
          organizationId,
          actorType: 'SYSTEM',
          action: 'WORKFLOW_STEP_ACTIVATED',
          entityType: 'WorkflowStepRun',
          entityId: firstStep.id,
          metadata: {
            organizationId,
            workflowRunId,
            workflowStepRunId: firstStep.id,
            stepType: 'PLAN',
            correlationId: updated.correlationId,
          },
        },
        tx,
      );

      return { run: updated, firstStep };
    });
  }

  async completeStep(input: CompleteStepInput) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: input.workflowRunId, organizationId: input.organizationId },
    });
    if (!run) throw new NotFoundException('WorkflowRun nicht gefunden.');

    if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
      await this.auditService.record({
        organizationId: input.organizationId,
        actorType: 'SYSTEM',
        action: 'WORKFLOW_STEP_TRANSITION_REJECTED',
        entityType: 'WorkflowRun',
        entityId: input.workflowRunId,
        metadata: {
          reason: 'TERMINAL_RUN',
          currentStatus: run.status,
          workflowStepRunId: input.workflowStepRunId,
          correlationId: run.correlationId,
        },
      });
      throw new ConflictException(`WorkflowRun ist terminal (Status: ${run.status}).`);
    }

    const stepRun = await this.prisma.workflowStepRun.findFirst({
      where: {
        id: input.workflowStepRunId,
        organizationId: input.organizationId,
        workflowRunId: input.workflowRunId,
      },
    });
    if (!stepRun) throw new NotFoundException('WorkflowStepRun nicht gefunden.');

    if (stepRun.status === 'SUCCEEDED' || stepRun.status === 'FAILED' || stepRun.status === 'SKIPPED' || stepRun.status === 'CANCELLED') {
      return { run, stepRun, outcome: null, idempotent: true };
    }

    if (run.currentStepType && run.currentStepType !== stepRun.stepType) {
      await this.auditService.record({
        organizationId: input.organizationId,
        actorType: 'SYSTEM',
        action: 'WORKFLOW_STEP_TRANSITION_REJECTED',
        entityType: 'WorkflowRun',
        entityId: input.workflowRunId,
        metadata: {
          reason: 'STALE_STEP',
          expectedStepType: run.currentStepType,
          attemptedStepType: stepRun.stepType,
          workflowStepRunId: input.workflowStepRunId,
          correlationId: run.correlationId,
        },
      });
      throw new ConflictException(
        `Step-Typ ${stepRun.stepType} entspricht nicht dem aktuellen Schritt ${run.currentStepType} des Runs.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const freshRun = await tx.workflowRun.findFirst({
        where: { id: input.workflowRunId, organizationId: input.organizationId },
      });
      if (!freshRun) throw new NotFoundException('WorkflowRun nicht gefunden.');

      if (freshRun.status === 'COMPLETED' || freshRun.status === 'FAILED' || freshRun.status === 'CANCELLED') {
        return { run: freshRun, stepRun, outcome: null, idempotent: true };
      }

      const freshStep = await tx.workflowStepRun.findFirst({
        where: {
          id: input.workflowStepRunId,
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
        },
      });
      if (!freshStep) throw new NotFoundException('WorkflowStepRun nicht gefunden.');

      if (freshStep.status === 'SUCCEEDED' || freshStep.status === 'FAILED' || freshStep.status === 'SKIPPED' || freshStep.status === 'CANCELLED') {
        return { run: freshRun, stepRun: freshStep, outcome: null, idempotent: true };
      }

      if (freshRun.currentStepType && freshRun.currentStepType !== freshStep.stepType) {
        return { run: freshRun, stepRun: freshStep, outcome: null, idempotent: true };
      }

      const now = new Date();
      const providerBlocked =
        input.providerStatus === AgentExecutionStatus.QUOTA_BLOCKED ||
        input.providerStatus === AgentExecutionStatus.POLICY_BLOCKED;
      const targetStatus = providerBlocked
        ? 'WAITING'
        : input.stepStatus === 'SUCCEEDED'
          ? 'SUCCEEDED'
          : 'FAILED';

      const claimResult = await tx.workflowStepRun.updateMany({
        where: {
          id: freshStep.id,
          status: 'READY',
        },
        data: {
          status: targetStatus,
          finishedAt: providerBlocked ? null : now,
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
        },
      });

      if (claimResult.count === 0) {
        return { run: freshRun, stepRun: freshStep, outcome: null, idempotent: true };
      }

      const completedStep = freshStep.stepType as EngineeringStepType;
      const stateMachineInput: StateMachineInput = {
        completedStep,
        stepStatus: input.stepStatus,
        providerStatus: input.providerStatus,
        correctionLoopCount: freshRun.correctionLoopCount,
        retryPolicy: {
          maxCorrectionLoops: freshRun.maxCorrectionLoops,
          maxProviderRetriesPerStep: DEFAULT_RETRY_POLICY.maxProviderRetriesPerStep,
        },
        humanApproved: input.humanApproved,
        verdict: input.verdict as any,
        reviewResults: input.reviewResults,
        independenceContext: input.independenceContext,
        assuranceLevel: freshRun.assuranceLevel as any,
      };

      const outcome = nextEngineeringStep(stateMachineInput);

      let runUpdate: Prisma.WorkflowRunUpdateInput = {};
      let newStep: any = null;
      let auditAction = '';
      let auditMetadata: Record<string, unknown> = {};

      switch (outcome.kind) {
        case 'NEXT_STEP': {
          const nextStepType = outcome.nextStep;
          const isCorrectionEntry = nextStepType === 'CORRECTION';

          runUpdate = {
            status: 'RUNNING',
            currentStepType: nextStepType,
            correctionLoopCount: isCorrectionEntry
              ? { increment: 1 }
              : freshRun.correctionLoopCount,
          };

          newStep = await tx.workflowStepRun.create({
            data: {
              organizationId: input.organizationId,
              workflowRunId: input.workflowRunId,
              stepType: nextStepType,
              status: 'READY',
              attemptNumber: 1,
              causationId: freshStep.id,
              startedAt: now,
            },
          });

          auditAction = 'WORKFLOW_STEP_TRANSITION_PERSISTED';
          auditMetadata = {
            fromStep: completedStep,
            toStep: nextStepType,
            stepRunId: newStep.id,
            correctionLoopCount: isCorrectionEntry
              ? freshRun.correctionLoopCount + 1
              : freshRun.correctionLoopCount,
          };

          await this.auditService.record(
            {
              organizationId: input.organizationId,
              actorType: 'SYSTEM',
              action: 'WORKFLOW_STEP_ACTIVATED',
              entityType: 'WorkflowStepRun',
              entityId: newStep.id,
              metadata: {
                organizationId: input.organizationId,
                workflowRunId: input.workflowRunId,
                workflowStepRunId: newStep.id,
                stepType: nextStepType,
                correlationId: freshRun.correlationId,
              },
            },
            tx,
          );
          break;
        }

        case 'BLOCKED': {
          const blockReason = outcome.reason as BlockReason;
          const providerBlock = blockReason.type === 'PROVIDER_BLOCKED';
          runUpdate = {
            status: 'BLOCKED',
            currentStepType: providerBlock ? completedStep : null,
            blockReasonCode: blockReason.type,
          };

          auditAction = 'WORKFLOW_RUN_BLOCKED';
          auditMetadata = {
            blockedAtStep: completedStep,
            blockReason: blockReason.type,
            blockDetail: blockReason,
          };
          break;
        }

        case 'FAILED': {
          runUpdate = {
            status: 'FAILED',
            currentStepType: null,
            failureReasonCode: outcome.reason,
          };

          auditAction = 'WORKFLOW_RUN_FAILED';
          auditMetadata = {
            failedAtStep: completedStep,
            failureReason: outcome.reason,
          };
          break;
        }

        case 'COMPLETED': {
          runUpdate = {
            status: 'COMPLETED',
            currentStepType: null,
            completedAt: now,
          };

          auditAction = 'WORKFLOW_RUN_COMPLETED';
          auditMetadata = {
            completedAtStep: completedStep,
          };
          break;
        }
      }

      const updatedRun = await tx.workflowRun.update({
        where: { id: input.workflowRunId },
        data: runUpdate,
      });

      await this.auditService.record(
        {
          organizationId: input.organizationId,
          actorType: 'SYSTEM',
          action: auditAction,
          entityType: 'WorkflowRun',
          entityId: input.workflowRunId,
          metadata: {
            ...auditMetadata,
            correlationId: freshRun.correlationId,
            completedStepRunId: freshStep.id,
          },
        },
        tx,
      );

      return { run: updatedRun, stepRun: freshStep, outcome, newStep, idempotent: false };
    });
  }

  async reloadRun(organizationId: string, workflowRunId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: workflowRunId, organizationId },
      include: {
        stepRuns: {
          orderBy: { startedAt: 'asc' },
        },
      },
    });
    if (!run) throw new NotFoundException('WorkflowRun nicht gefunden.');
    return run;
  }

  async resumeRun(organizationId: string, workflowRunId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: workflowRunId, organizationId },
    });
    if (!run) throw new NotFoundException('WorkflowRun nicht gefunden.');

    if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
      throw new ConflictException(`WorkflowRun ist terminal (Status: ${run.status}) und kann nicht fortgesetzt werden.`);
    }

    if (run.status === 'RUNNING') {
      await this.prisma.$transaction(async (tx) => {
        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'WORKFLOW_RUN_RESUMED',
            entityType: 'WorkflowRun',
            entityId: workflowRunId,
            metadata: {
              currentStepType: run.currentStepType,
              correctionLoopCount: run.correctionLoopCount,
              note: 'Already RUNNING, resume is no-op.',
            },
          },
          tx,
        );
      });
      return run;
    }

    if (run.status === 'BLOCKED') {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.workflowRun.update({
          where: { id: workflowRunId },
          data: {
            status: 'RUNNING',
            blockReasonCode: null,
          },
        });

        if (run.blockReasonCode === 'PROVIDER_BLOCKED' && run.currentStepType) {
          await tx.workflowStepRun.updateMany({
            where: {
              organizationId,
              workflowRunId,
              stepType: run.currentStepType,
              status: 'WAITING',
            },
            data: {
              status: 'READY',
              finishedAt: null,
            },
          });
        }

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'WORKFLOW_RUN_RESUMED',
            entityType: 'WorkflowRun',
            entityId: workflowRunId,
            metadata: {
              previousStatus: 'BLOCKED',
              currentStepType: run.currentStepType,
              correctionLoopCount: run.correctionLoopCount,
            },
          },
          tx,
        );

        return updated;
      });
    }

    if (run.status === 'WAITING_FOR_HUMAN') {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.workflowRun.update({
          where: { id: workflowRunId },
          data: { status: 'RUNNING' },
        });

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'WORKFLOW_RUN_RESUMED',
            entityType: 'WorkflowRun',
            entityId: workflowRunId,
            metadata: {
              previousStatus: 'WAITING_FOR_HUMAN',
              currentStepType: run.currentStepType,
              correctionLoopCount: run.correctionLoopCount,
            },
          },
          tx,
        );

        return updated;
      });
    }

    throw new ConflictException(`WorkflowRun kann nicht fortgesetzt werden (Status: ${run.status}).`);
  }

  async findRunById(organizationId: string, workflowRunId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: workflowRunId, organizationId },
    });
    if (!run) throw new NotFoundException('WorkflowRun nicht gefunden.');
    return run;
  }

  async findAllRuns(organizationId: string) {
    return this.prisma.workflowRun.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findStepRuns(organizationId: string, workflowRunId: string) {
    return this.prisma.workflowStepRun.findMany({
      where: { organizationId, workflowRunId },
      orderBy: { startedAt: 'asc' },
    });
  }
}
