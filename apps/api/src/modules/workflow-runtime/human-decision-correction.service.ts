import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_RETRY_POLICY,
  EngineeringStepType,
  ReviewVerdict,
  nextEngineeringHumanDecision,
} from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const HUMAN_DECISION_REQUIRED = 'HUMAN_DECISION_REQUIRED';
const ALLOWED_PARSE_SOURCES = new Set([
  'WORKFLOW_REVIEW_VERDICT_RUNTIME',
  'WORKFLOW_AL4_REVIEW_VERDICT_RUNTIME',
]);

@Injectable()
export class HumanDecisionCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async requestCorrection(input: {
    organizationId: string;
    workflowRunId: string;
    decidedByUserId: string;
    isMachineIdentity: boolean;
  }) {
    if (input.isMachineIdentity) {
      throw new ForbiddenException('Human correction decision requires an authenticated human user.');
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
        run.blockReasonCode !== HUMAN_DECISION_REQUIRED ||
        run.currentStepType !== null
      ) {
        throw new ConflictException(
          `WorkflowRun is not awaiting a human correction decision (status=${run.status}, blockReason=${run.blockReasonCode ?? 'none'}, currentStepType=${run.currentStepType ?? 'none'}).`,
        );
      }

      const parseStep = await tx.workflowStepRun.findFirst({
        where: {
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          stepType: EngineeringStepType.PARSE_VERDICT,
          status: 'SUCCEEDED',
        },
        orderBy: { finishedAt: 'desc' },
        select: { id: true, metadata: true },
      });
      if (!parseStep) {
        throw new ConflictException('No succeeded PARSE_VERDICT step exists for this human decision.');
      }

      const parseMetadata = objectValue(parseStep.metadata);
      const source = typeof parseMetadata?.source === 'string' ? parseMetadata.source : null;
      if (!source || !ALLOWED_PARSE_SOURCES.has(source)) {
        throw new ConflictException('PARSE_VERDICT evidence is not authoritative for a human correction decision.');
      }
      if (parseMetadata?.verdict !== undefined && parseMetadata.verdict !== ReviewVerdict.D) {
        throw new ConflictException('PARSE_VERDICT does not carry verdict D.');
      }

      const decision = nextEngineeringHumanDecision({
        blockReason: { type: 'HUMAN_DECISION_REQUIRED', verdict: ReviewVerdict.D },
        decision: 'CORRECTION',
        correctionLoopCount: run.correctionLoopCount,
        retryPolicy: {
          maxCorrectionLoops: run.maxCorrectionLoops,
          maxProviderRetriesPerStep: DEFAULT_RETRY_POLICY.maxProviderRetriesPerStep,
        },
      });
      if (decision.kind !== 'NEXT_STEP' || decision.nextStep !== EngineeringStepType.CORRECTION) {
        const reason = decision.kind === 'BLOCKED' ? decision.reason.type : decision.kind;
        throw new ConflictException(`Human correction decision was not accepted by the state machine (${reason}).`);
      }

      const claim = await tx.workflowRun.updateMany({
        where: {
          id: input.workflowRunId,
          organizationId: input.organizationId,
          status: 'BLOCKED',
          currentStepType: null,
          blockReasonCode: HUMAN_DECISION_REQUIRED,
          correctionLoopCount: run.correctionLoopCount,
        },
        data: {
          status: 'RUNNING',
          currentStepType: EngineeringStepType.CORRECTION,
          blockReasonCode: null,
          correctionLoopCount: { increment: 1 },
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Human correction decision lost an atomic state claim.');
      }

      const now = new Date();
      const correctionStep = await tx.workflowStepRun.create({
        data: {
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          stepType: EngineeringStepType.CORRECTION,
          status: 'READY',
          attemptNumber: 1,
          causationId: parseStep.id,
          startedAt: now,
          metadata: {
            source: 'HUMAN_DECISION_CORRECTION',
            decidedByUserId: input.decidedByUserId,
            parseVerdictStepRunId: parseStep.id,
          },
        },
      });

      const nextCorrectionLoopCount = run.correctionLoopCount + 1;
      await this.auditService.record(
        {
          organizationId: input.organizationId,
          actorType: 'USER',
          actorId: input.decidedByUserId,
          action: 'HUMAN_DECISION_CORRECTION_REQUESTED',
          entityType: 'WorkflowRun',
          entityId: input.workflowRunId,
          metadata: {
            previousBlockReason: HUMAN_DECISION_REQUIRED,
            parseVerdictStepRunId: parseStep.id,
            correctionStepRunId: correctionStep.id,
            correctionLoopCount: nextCorrectionLoopCount,
            correlationId: run.correlationId,
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
          entityId: correctionStep.id,
          metadata: {
            workflowRunId: input.workflowRunId,
            workflowStepRunId: correctionStep.id,
            stepType: EngineeringStepType.CORRECTION,
            causationId: parseStep.id,
            correlationId: run.correlationId,
          },
        },
        tx,
      );

      return Object.freeze({
        disposition: 'HUMAN_DECISION_CORRECTION_CREATED' as const,
        workflowRunId: input.workflowRunId,
        workflowStepRunId: correctionStep.id,
        causationId: parseStep.id,
        decidedByUserId: input.decidedByUserId,
        nextStep: EngineeringStepType.CORRECTION,
        correctionLoopCount: nextCorrectionLoopCount,
        executionTriggered: false as const,
        authority: 'HUMAN_EXPLICIT' as const,
      });
    });
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
