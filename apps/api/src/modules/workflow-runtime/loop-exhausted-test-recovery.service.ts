import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EngineeringStepType } from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const LOOP_EXHAUSTED = 'LOOP_EXHAUSTED';
const NONTERMINAL_STEP_STATUSES = ['PENDING', 'READY', 'RUNNING', 'WAITING'] as const;

@Injectable()
export class LoopExhaustedTestRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async recover(input: {
    organizationId: string;
    workflowRunId: string;
    approvedByUserId: string;
    isMachineIdentity: boolean;
    approvalRef: string;
  }) {
    if (input.isMachineIdentity) {
      throw new ForbiddenException('Loop-exhausted TEST recovery requires an authenticated human user.');
    }
    const approvalRef = input.approvalRef?.trim();
    if (!approvalRef || approvalRef.length > 512) {
      throw new BadRequestException('approvalRef must contain between 1 and 512 characters.');
    }

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.workflowRun.findFirst({
        where: { id: input.workflowRunId, organizationId: input.organizationId },
        select: {
          id: true,
          status: true,
          currentStepType: true,
          correctionLoopCount: true,
          maxCorrectionLoops: true,
          correlationId: true,
          blockReasonCode: true,
        },
      });
      if (!run) throw new NotFoundException('WorkflowRun not found.');
      if (
        run.status !== 'BLOCKED' ||
        run.blockReasonCode !== LOOP_EXHAUSTED ||
        run.currentStepType !== null ||
        run.correctionLoopCount !== run.maxCorrectionLoops
      ) {
        throw new ConflictException(
          `WorkflowRun is not eligible for loop-exhausted TEST recovery (status=${run.status}, blockReason=${run.blockReasonCode ?? 'none'}, currentStepType=${run.currentStepType ?? 'none'}, correctionLoopCount=${run.correctionLoopCount}/${run.maxCorrectionLoops}).`,
        );
      }

      const correctionStep = await tx.workflowStepRun.findFirst({
        where: {
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          stepType: EngineeringStepType.CORRECTION,
          status: 'SUCCEEDED',
        },
        orderBy: { finishedAt: 'desc' },
        select: { id: true },
      });
      if (!correctionStep) {
        throw new ConflictException('No succeeded CORRECTION step exists for loop-exhausted TEST recovery.');
      }

      const staleSteps = await tx.workflowStepRun.findMany({
        where: {
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          status: { in: [...NONTERMINAL_STEP_STATUSES] },
        },
        select: { id: true, stepType: true, status: true },
        orderBy: { startedAt: 'asc' },
      });

      const claim = await tx.workflowRun.updateMany({
        where: {
          id: input.workflowRunId,
          organizationId: input.organizationId,
          status: 'BLOCKED',
          currentStepType: null,
          blockReasonCode: LOOP_EXHAUSTED,
          correctionLoopCount: run.correctionLoopCount,
        },
        data: {
          status: 'RUNNING',
          currentStepType: EngineeringStepType.TEST,
          blockReasonCode: null,
          failureReasonCode: null,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Loop-exhausted TEST recovery lost an atomic workflow claim.');
      }

      if (staleSteps.length > 0) {
        const cancelled = await tx.workflowStepRun.updateMany({
          where: {
            organizationId: input.organizationId,
            workflowRunId: input.workflowRunId,
            id: { in: staleSteps.map((step) => step.id) },
            status: { in: [...NONTERMINAL_STEP_STATUSES] },
          },
          data: { status: 'CANCELLED', finishedAt: new Date() },
        });
        if (cancelled.count !== staleSteps.length) {
          throw new ConflictException('Loop-exhausted TEST recovery could not atomically cancel all stale nonterminal steps.');
        }
      }

      const now = new Date();
      const testStep = await tx.workflowStepRun.create({
        data: {
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          stepType: EngineeringStepType.TEST,
          status: 'READY',
          attemptNumber: 1,
          causationId: correctionStep.id,
          startedAt: now,
          metadata: {
            source: 'LOOP_EXHAUSTED_HUMAN_RECOVERY',
            approvalRef,
            preservedCorrectionLoopCount: run.correctionLoopCount,
            executionLimit: 1,
            authorizedExecutionStep: EngineeringStepType.TEST,
            forbiddenExecutionSteps: ['PACKAGE', 'CORRECTION', 'RED_TEAM', 'PARSE_VERDICT'],
          },
        },
      });

      await this.auditService.record(
        {
          organizationId: input.organizationId,
          actorType: 'USER',
          actorId: input.approvedByUserId,
          action: 'LOOP_EXHAUSTED_TEST_RECOVERY_REQUESTED',
          entityType: 'WorkflowRun',
          entityId: input.workflowRunId,
          metadata: {
            approvalRef,
            previousBlockReason: LOOP_EXHAUSTED,
            correctionStepRunId: correctionStep.id,
            testStepRunId: testStep.id,
            cancelledStaleStepIds: staleSteps.map((step) => step.id),
            correctionLoopCount: run.correctionLoopCount,
            maxCorrectionLoops: run.maxCorrectionLoops,
            executionLimit: 1,
            executionTriggered: false,
            authority: 'HUMAN_EXPLICIT',
          },
        },
        tx,
      );

      await this.auditService.record(
        {
          organizationId: input.organizationId,
          actorType: 'SYSTEM',
          action: 'WORKFLOW_STEP_ACTIVATED',
          entityType: 'WorkflowStepRun',
          entityId: testStep.id,
          metadata: {
            workflowRunId: input.workflowRunId,
            workflowStepRunId: testStep.id,
            stepType: EngineeringStepType.TEST,
            causationId: correctionStep.id,
            correlationId: run.correlationId,
            recovery: 'LOOP_EXHAUSTED_HUMAN_RECOVERY',
          },
        },
        tx,
      );

      return Object.freeze({
        disposition: 'LOOP_EXHAUSTED_TEST_RECOVERY_CREATED' as const,
        workflowRunId: input.workflowRunId,
        workflowStepRunId: testStep.id,
        causationId: correctionStep.id,
        cancelledStaleStepIds: Object.freeze(staleSteps.map((step) => step.id)),
        correctionLoopCount: run.correctionLoopCount,
        maxCorrectionLoops: run.maxCorrectionLoops,
        executionTriggered: false as const,
        authority: 'HUMAN_EXPLICIT' as const,
      });
    });
  }
}
