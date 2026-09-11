import { Injectable, NotFoundException } from '@nestjs/common';
import { EngineeringStepType } from '@vito/contracts';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export type WorkflowVerificationStatus = 'VERIFIED' | 'FAILED' | 'INCONCLUSIVE' | 'BLOCKED';

type VerificationDecision = Readonly<{
  status: WorkflowVerificationStatus;
  ruleCode: string;
  reason: string;
}>;

type VerificationRow = {
  id: string;
  organizationId: string;
  workflowRunId: string;
  workflowStepRunId: string;
  stepType: string;
  ruleCode: string;
  status: WorkflowVerificationStatus;
  evidence: unknown;
  createdAt: Date;
};

@Injectable()
export class WorkflowVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async verifyStep(organizationId: string, workflowRunId: string, workflowStepRunId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: workflowRunId, organizationId },
      select: { id: true, status: true, currentStepType: true, blockReasonCode: true },
    });
    if (!run) throw new NotFoundException('WorkflowRun not found.');

    const step = await this.prisma.workflowStepRun.findFirst({
      where: { id: workflowStepRunId, workflowRunId, organizationId },
      select: { id: true, stepType: true, status: true, attemptNumber: true, metadata: true },
    });
    if (!step) throw new NotFoundException('WorkflowStepRun not found.');

    const metadata = this.objectMetadata(step.metadata);
    const executionStatus = typeof metadata.executionStatus === 'string' ? metadata.executionStatus : null;
    const capabilityCode = typeof metadata.capabilityCode === 'string' ? metadata.capabilityCode : null;
    const experienceId = typeof metadata.experienceId === 'string' ? metadata.experienceId : null;
    const decision = this.decide({
      stepType: step.stepType as EngineeringStepType,
      stepStatus: step.status,
      runStatus: run.status,
      blockReasonCode: run.blockReasonCode,
      executionStatus,
      capabilityCode,
    });

    const evidence = {
      source: 'WORKFLOW_VERIFICATION_V1',
      workflowRunId,
      workflowStepRunId,
      stepType: step.stepType,
      stepStatus: step.status,
      attemptNumber: step.attemptNumber,
      runStatus: run.status,
      blockReasonCode: run.blockReasonCode,
      executionStatus,
      capabilityCode,
      experienceId,
      reason: decision.reason,
    };

    const rows = await this.prisma.$queryRaw<VerificationRow[]>(Prisma.sql`
      INSERT INTO "workflow_verifications" (
        "id", "organizationId", "workflowRunId", "workflowStepRunId", "stepType", "ruleCode", "status", "evidence"
      ) VALUES (
        ${randomUUID()}, ${organizationId}, ${workflowRunId}, ${workflowStepRunId}, ${step.stepType},
        ${decision.ruleCode}, ${decision.status}, ${JSON.stringify(evidence)}::jsonb
      )
      ON CONFLICT ("organizationId", "workflowStepRunId", "ruleCode") DO UPDATE SET
        "status" = EXCLUDED."status",
        "evidence" = EXCLUDED."evidence"
      RETURNING *
    `);
    const verification = rows[0];

    await this.audit.record({
      organizationId,
      actorType: 'SYSTEM',
      action: decision.status === 'VERIFIED' ? 'WORKFLOW_STEP_VERIFIED' : 'WORKFLOW_STEP_VERIFICATION_RECORDED',
      entityType: 'WorkflowStepRun',
      entityId: workflowStepRunId,
      metadata: {
        verificationId: verification.id,
        status: decision.status,
        ruleCode: decision.ruleCode,
        stepType: step.stepType,
      },
    });

    return Object.freeze(verification);
  }

  async tryVerifyStep(organizationId: string, workflowRunId: string, workflowStepRunId: string) {
    try {
      return await this.verifyStep(organizationId, workflowRunId, workflowStepRunId);
    } catch (error) {
      try {
        await this.audit.record({
          organizationId,
          actorType: 'SYSTEM',
          action: 'WORKFLOW_STEP_VERIFICATION_FAILED',
          entityType: 'WorkflowStepRun',
          entityId: workflowStepRunId,
          metadata: { message: error instanceof Error ? error.message : 'unknown error' },
        });
      } catch {}
      return null;
    }
  }

  private decide(input: {
    stepType: EngineeringStepType;
    stepStatus: string;
    runStatus: string;
    blockReasonCode: string | null;
    executionStatus: string | null;
    capabilityCode: string | null;
  }): VerificationDecision {
    if (input.runStatus === 'BLOCKED' && input.stepStatus === 'WAITING' && input.blockReasonCode === 'PROVIDER_BLOCKED') {
      return Object.freeze({ status: 'BLOCKED', ruleCode: 'PROVIDER_BLOCK_STATE', reason: 'Provider policy or quota blocked execution.' });
    }
    if (input.stepStatus === 'FAILED') {
      return Object.freeze({ status: 'FAILED', ruleCode: 'STEP_TERMINAL_STATUS', reason: 'Persisted workflow step failed.' });
    }
    if (input.stepStatus !== 'SUCCEEDED') {
      return Object.freeze({ status: 'INCONCLUSIVE', ruleCode: 'STEP_NOT_TERMINAL', reason: 'Step has not produced successful terminal evidence.' });
    }

    if (input.stepType === EngineeringStepType.TEST) {
      return input.executionStatus === 'SUCCEEDED' && input.capabilityCode === 'TEST_EXECUTION'
        ? Object.freeze({ status: 'VERIFIED', ruleCode: 'TEST_EXECUTION_SUCCEEDED', reason: 'Governed TEST_EXECUTION completed successfully.' })
        : Object.freeze({ status: 'INCONCLUSIVE', ruleCode: 'TEST_EVIDENCE_INCOMPLETE', reason: 'Successful TEST step lacks matching governed TEST_EXECUTION evidence.' });
    }

    if (input.stepType === EngineeringStepType.VERIFY || input.stepType === EngineeringStepType.REMOTE_VERIFY) {
      return input.executionStatus === 'SUCCEEDED' && input.capabilityCode === 'RELEASE_VERIFICATION'
        ? Object.freeze({ status: 'VERIFIED', ruleCode: 'RELEASE_VERIFICATION_SUCCEEDED', reason: 'Governed RELEASE_VERIFICATION completed successfully.' })
        : Object.freeze({ status: 'INCONCLUSIVE', ruleCode: 'VERIFICATION_EVIDENCE_INCOMPLETE', reason: 'Verification step lacks matching governed RELEASE_VERIFICATION evidence.' });
    }

    if (input.stepType === EngineeringStepType.BUILD || input.stepType === EngineeringStepType.CORRECTION) {
      return Object.freeze({ status: 'INCONCLUSIVE', ruleCode: 'BUILD_REQUIRES_DOWNSTREAM_VERIFICATION', reason: 'Build completion alone does not establish correctness; downstream TEST is required.' });
    }

    if (input.stepType === EngineeringStepType.PARSE_VERDICT || input.stepType === EngineeringStepType.HUMAN_RELEASE_GATE || input.stepType === EngineeringStepType.RELEASE_EXECUTION) {
      return Object.freeze({ status: 'INCONCLUSIVE', ruleCode: 'GOVERNANCE_EVIDENCE_REQUIRED', reason: 'Non-agent governance or release evidence must be evaluated by its authoritative gate.' });
    }

    return Object.freeze({ status: 'INCONCLUSIVE', ruleCode: 'DOWNSTREAM_VERIFICATION_REQUIRED', reason: 'Execution success alone is insufficient to establish objective correctness.' });
  }

  private objectMetadata(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }
}
