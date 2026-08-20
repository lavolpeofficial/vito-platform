import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  nextEngineeringStep,
  DEFAULT_RETRY_POLICY,
  type StateMachineInput,
  type TransitionOutcome,
  type BlockReason,
} from '@vito/contracts';
import {
  WorkflowRunStatus,
  WorkflowStepStatus,
  EngineeringStepType,
} from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Input / Result types
// ---------------------------------------------------------------------------

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
  verdict?: string;
  humanApproved?: boolean;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Workflow Runtime Service (EO-01.2).
 *
 * Durable, resumable, tenant-scoped and auditable orchestration of the
 * engineering workflow. Uses the EO-01.1 pure state machine as the sole
 * transition authority.
 */
@Injectable()
export class WorkflowRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Complete Step (the core transition)
  // -------------------------------------------------------------------------

  async completeStep(input: CompleteStepInput) {
    // ── Pre-validation reads (outside transaction) ───────────────────────
    // Rejection audits must be durable. Writing them inside $transaction
    // and then throwing causes a rollback that deletes the audit row.
    // Therefore terminal/stale rejections happen before $transaction.

    const run = await this.prisma.workflowRun.findFirst({
      where: { id: input.workflowRunId, organizationId: input.organizationId },
    });
    if (!run) throw new NotFoundException('WorkflowRun nicht gefunden.');

    // Terminal runs cannot accept completions
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

    // Idempotency: if step already terminal, return current state without re-processing.
    // This must precede the stale check: a completed step is idempotent regardless
    // of whether the run's currentStepType has since advanced.
    if (stepRun.status === 'SUCCEEDED' || stepRun.status === 'FAILED' || stepRun.status === 'SKIPPED' || stepRun.status === 'CANCELLED') {
      return { run, stepRun, outcome: null, idempotent: true };
    }

    // Stale check (pre-validation fast path with durable audit)
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

    // ── Transactional mutation path ──────────────────────────────────────
    // Re-validates inside the transaction to close the TOCTOU window.
    // Uses a conditional updateMany (status='READY' guard) as the atomic
    // concurrency lock: only one concurrent completion can win.
    return this.prisma.$transaction(async (tx) => {
      // Re-read run inside transaction for fresh state
      const freshRun = await tx.workflowRun.findFirst({
        where: { id: input.workflowRunId, organizationId: input.organizationId },
      });
      if (!freshRun) throw new NotFoundException('WorkflowRun nicht gefunden.');

      // If run became terminal between pre-validation and transaction
      if (freshRun.status === 'COMPLETED' || freshRun.status === 'FAILED' || freshRun.status === 'CANCELLED') {
        return { run: freshRun, stepRun, outcome: null, idempotent: true };
      }

      // Re-read step inside transaction for fresh state
      const freshStep = await tx.workflowStepRun.findFirst({
        where: {
          id: input.workflowStepRunId,
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
        },
      });
      if (!freshStep) throw new NotFoundException('WorkflowStepRun nicht gefunden.');

      // Idempotency: if step already terminal, no-op
      if (freshStep.status === 'SUCCEEDED' || freshStep.status === 'FAILED' || freshStep.status === 'SKIPPED' || freshStep.status === 'CANCELLED') {
        return { run: freshRun, stepRun: freshStep, outcome: null, idempotent: true };
      }

      // Stale check inside transaction (step may have been advanced by concurrent winner)
      if (freshRun.currentStepType && freshRun.currentStepType !== freshStep.stepType) {
        return { run: freshRun, stepRun: freshStep, outcome: null, idempotent: true };
      }

      // ── Atomic concurrency guard ───────────────────────────────────────
      // updateMany with status='READY' in WHERE: at the DB level only one
      // concurrent transaction can transition this row from READY.
      const now = new Date();
      const targetStatus = input.stepStatus === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED';

      const claimResult = await tx.workflowStepRun.updateMany({
        where: {
          id: freshStep.id,
          status: 'READY',
        },
        data: {
          status: targetStatus,
          finishedAt: now,
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
        },
      });

      if (claimResult.count === 0) {
        // Another concurrent request already completed this step
        return { run: freshRun, stepRun: freshStep, outcome: null, idempotent: true };
      }

      // ── State machine + persistence ────────────────────────────────────
      const completedStep = freshStep.stepType as EngineeringStepType;
      const stateMachineInput: StateMachineInput = {
        completedStep,
        stepStatus: input.stepStatus,
        correctionLoopCount: freshRun.correctionLoopCount,
        retryPolicy: {
          maxCorrectionLoops: freshRun.maxCorrectionLoops,
          maxProviderRetriesPerStep: DEFAULT_RETRY_POLICY.maxProviderRetriesPerStep,
        },
        humanApproved: input.humanApproved,
        verdict: input.verdict as any,
      };

      const outcome = nextEngineeringStep(stateMachineInput);

      // Determine new run state and correction loop increment
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
          runUpdate = {
            status: 'BLOCKED',
            currentStepType: null,
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

  // -------------------------------------------------------------------------
  // Reload (resume after restart)
  // -------------------------------------------------------------------------

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

    // Only non-terminal runs can be resumed
    if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
      throw new ConflictException(`WorkflowRun ist terminal (Status: ${run.status}) und kann nicht fortgesetzt werden.`);
    }

    // Already running — no-op but audit
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

    // BLOCKED: set back to RUNNING, preserving step and loop state
    if (run.status === 'BLOCKED') {
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

    // WAITING_FOR_HUMAN: set back to RUNNING, preserving step and loop state
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

  // -------------------------------------------------------------------------
  // Queries (tenant-scoped)
  // -------------------------------------------------------------------------

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
