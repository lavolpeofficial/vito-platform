import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentExecutionStatus,
  EngineeringCapability,
  EngineeringStepType,
} from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const NONTERMINAL_STEP_STATUSES = ['PENDING', 'READY', 'RUNNING', 'WAITING'] as const;
const MAX_INVOCATION_ID_CHARS = 256;

@Injectable()
export class ReleaseVerificationRecoveryService {
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
      throw new ForbiddenException('Release-verification recovery requires an authenticated human user.');
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
        run.status !== 'RUNNING' ||
        run.currentStepType !== EngineeringStepType.HUMAN_RELEASE_GATE
      ) {
        throw new ConflictException(
          `WorkflowRun is not eligible for release-verification recovery (status=${run.status}, currentStepType=${run.currentStepType ?? 'none'}).`,
        );
      }

      const humanReleaseStep = await tx.workflowStepRun.findFirst({
        where: {
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          stepType: EngineeringStepType.HUMAN_RELEASE_GATE,
          status: 'READY',
        },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          causationId: true,
          attemptNumber: true,
        },
      });
      if (!humanReleaseStep?.causationId) {
        throw new ConflictException('No READY HUMAN_RELEASE_GATE with VERIFY causation exists for recovery.');
      }

      const verifyStep = await tx.workflowStepRun.findFirst({
        where: {
          id: humanReleaseStep.causationId,
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          stepType: EngineeringStepType.VERIFY,
          status: 'SUCCEEDED',
        },
        select: {
          id: true,
          causationId: true,
          attemptNumber: true,
          metadata: true,
        },
      });
      if (!verifyStep?.causationId) {
        throw new ConflictException('The HUMAN_RELEASE_GATE causation is not a succeeded VERIFY step with an upstream lineage.');
      }

      const metadata = this.objectValue(verifyStep.metadata);
      const executionStatus = this.stringValue(metadata?.executionStatus);
      const capabilityCode = this.stringValue(metadata?.capabilityCode);
      const projectionStatus = this.stringValue(metadata?.verificationResultProjectionStatus);
      const verificationStatus = this.stringValue(metadata?.verificationResultStatus);

      if (
        executionStatus !== AgentExecutionStatus.SUCCEEDED ||
        capabilityCode !== EngineeringCapability.RELEASE_VERIFICATION
      ) {
        throw new ConflictException('The succeeded VERIFY step lacks matching RELEASE_VERIFICATION execution metadata.');
      }

      if (projectionStatus === 'VALID' && verificationStatus === 'PASS') {
        throw new ConflictException('A structured PASS release verification cannot be reopened through false-positive recovery.');
      }

      const executionEvidence = this.objectValue(metadata?.executionEvidence);
      const invocationId = this.boundedString(executionEvidence?.invocationId, MAX_INVOCATION_ID_CHARS);
      if (!invocationId) {
        throw new ConflictException('The VERIFY step has no governed execution evidence binding.');
      }

      const executionRecord = await tx.governedExecutionRecord.findFirst({
        where: {
          id: invocationId,
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          workflowStepRunId: verifyStep.id,
          capabilityCode: EngineeringCapability.RELEASE_VERIFICATION,
          status: AgentExecutionStatus.SUCCEEDED,
        },
        select: { id: true },
      });
      if (!executionRecord) {
        throw new ConflictException('The VERIFY step does not match an authoritative governed RELEASE_VERIFICATION execution record.');
      }

      const nonterminalSteps = await tx.workflowStepRun.findMany({
        where: {
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          status: { in: [...NONTERMINAL_STEP_STATUSES] },
        },
        select: { id: true, stepType: true, status: true },
        orderBy: { startedAt: 'asc' },
      });
      if (
        nonterminalSteps.length !== 1 ||
        nonterminalSteps[0]?.id !== humanReleaseStep.id ||
        nonterminalSteps[0]?.stepType !== EngineeringStepType.HUMAN_RELEASE_GATE ||
        nonterminalSteps[0]?.status !== 'READY'
      ) {
        throw new ConflictException('Release-verification recovery requires exactly one READY HUMAN_RELEASE_GATE and no other nonterminal workflow step.');
      }

      const claim = await tx.workflowRun.updateMany({
        where: {
          id: input.workflowRunId,
          organizationId: input.organizationId,
          status: 'RUNNING',
          currentStepType: EngineeringStepType.HUMAN_RELEASE_GATE,
          correctionLoopCount: run.correctionLoopCount,
        },
        data: {
          currentStepType: EngineeringStepType.VERIFY,
          blockReasonCode: null,
          failureReasonCode: null,
        },
      });
      if (claim.count !== 1) {
        throw new ConflictException('Release-verification recovery lost an atomic workflow claim.');
      }

      const cancelled = await tx.workflowStepRun.updateMany({
        where: {
          id: humanReleaseStep.id,
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          stepType: EngineeringStepType.HUMAN_RELEASE_GATE,
          status: 'READY',
        },
        data: {
          status: 'CANCELLED',
          finishedAt: new Date(),
        },
      });
      if (cancelled.count !== 1) {
        throw new ConflictException('Release-verification recovery could not atomically cancel the stale HUMAN_RELEASE_GATE.');
      }

      const verifyRecoveryStep = await tx.workflowStepRun.create({
        data: {
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          stepType: EngineeringStepType.VERIFY,
          status: 'READY',
          attemptNumber: verifyStep.attemptNumber + 1,
          causationId: verifyStep.causationId,
          startedAt: new Date(),
          metadata: {
            source: 'HUMAN_RELEASE_FALSE_POSITIVE_RECOVERY',
            approvalRef,
            supersededVerifyStepRunId: verifyStep.id,
            supersededHumanReleaseGateStepRunId: humanReleaseStep.id,
            governedExecutionRecordId: executionRecord.id,
            preservedCorrectionLoopCount: run.correctionLoopCount,
            maxCorrectionLoops: run.maxCorrectionLoops,
            executionLimit: 1,
            executionTriggered: false,
            authorizedExecutionStep: EngineeringStepType.VERIFY,
            forbiddenExecutionSteps: [
              EngineeringStepType.REMOTE_VERIFY,
              EngineeringStepType.HUMAN_RELEASE_GATE,
              EngineeringStepType.RELEASE_EXECUTION,
            ],
            recoveryReason: 'LEGACY_RELEASE_VERIFICATION_WITHOUT_STRUCTURED_PASS',
          },
        },
      });

      await this.auditService.record(
        {
          organizationId: input.organizationId,
          actorType: 'USER',
          actorId: input.approvedByUserId,
          action: 'HUMAN_RELEASE_FALSE_POSITIVE_VERIFY_RECOVERY_REQUESTED',
          entityType: 'WorkflowRun',
          entityId: input.workflowRunId,
          metadata: {
            approvalRef,
            supersededVerifyStepRunId: verifyStep.id,
            supersededHumanReleaseGateStepRunId: humanReleaseStep.id,
            governedExecutionRecordId: executionRecord.id,
            verifyRecoveryStepRunId: verifyRecoveryStep.id,
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
          entityId: verifyRecoveryStep.id,
          metadata: {
            workflowRunId: input.workflowRunId,
            workflowStepRunId: verifyRecoveryStep.id,
            stepType: EngineeringStepType.VERIFY,
            causationId: verifyStep.causationId,
            correlationId: run.correlationId,
            recovery: 'HUMAN_RELEASE_FALSE_POSITIVE_RECOVERY',
          },
        },
        tx,
      );

      return Object.freeze({
        disposition: 'HUMAN_RELEASE_FALSE_POSITIVE_VERIFY_RECOVERY_CREATED' as const,
        workflowRunId: input.workflowRunId,
        workflowStepRunId: verifyRecoveryStep.id,
        causationId: verifyStep.causationId,
        supersededVerifyStepRunId: verifyStep.id,
        supersededHumanReleaseGateStepRunId: humanReleaseStep.id,
        governedExecutionRecordId: executionRecord.id,
        correctionLoopCount: run.correctionLoopCount,
        maxCorrectionLoops: run.maxCorrectionLoops,
        executionTriggered: false as const,
        authority: 'HUMAN_EXPLICIT' as const,
      });
    });
  }

  private objectValue(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private boundedString(value: unknown, maxChars: number): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= maxChars ? value : null;
  }
}
