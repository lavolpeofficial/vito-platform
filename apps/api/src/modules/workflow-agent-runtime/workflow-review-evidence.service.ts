import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentExecutionStatus, EngineeringCapability, EngineeringStepType } from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_REFERENCES = 32;
const MAX_REFERENCE_CHARS = 2_048;
const MAX_INVOCATION_ID_CHARS = 256;

@Injectable()
export class WorkflowReviewEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(organizationId: string, workflowRunId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: workflowRunId, organizationId },
      select: { id: true, correlationId: true },
    });
    if (!run) throw new NotFoundException('WorkflowRun not found.');

    const reviewStep = await this.prisma.workflowStepRun.findFirst({
      where: {
        organizationId,
        workflowRunId,
        stepType: EngineeringStepType.RED_TEAM,
        status: 'SUCCEEDED',
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, metadata: true, finishedAt: true },
    });
    if (!reviewStep) {
      throw new ConflictException('No succeeded RED_TEAM workflow step is available for verdict evidence resolution.');
    }

    const executionEvidence = this.objectValue(this.objectValue(reviewStep.metadata)?.executionEvidence);
    const invocationId = this.boundedString(executionEvidence?.invocationId, MAX_INVOCATION_ID_CHARS);
    if (!invocationId) {
      throw new ConflictException('RED_TEAM step has no valid governed invocation evidence binding.');
    }

    const record = await this.prisma.governedExecutionRecord.findFirst({
      where: {
        id: invocationId,
        organizationId,
        workflowRunId,
        workflowStepRunId: reviewStep.id,
        capabilityCode: EngineeringCapability.RED_TEAM,
        status: AgentExecutionStatus.SUCCEEDED,
      },
      select: {
        id: true,
        providerId: true,
        capabilityCode: true,
        outputReference: true,
        artifactReferences: true,
        policyDecisionReference: true,
        completedAt: true,
      },
    });
    if (!record) {
      throw new ConflictException('Governed RED_TEAM execution record does not match the persisted workflow evidence lineage.');
    }

    const boundOutputReference = this.boundedString(executionEvidence?.outputReference, MAX_REFERENCE_CHARS);
    if (boundOutputReference && record.outputReference !== boundOutputReference) {
      throw new ConflictException('RED_TEAM output reference does not match the authoritative governed execution record.');
    }

    const boundArtifacts = this.referenceList(executionEvidence?.artifactReferences);
    const authoritativeArtifacts = this.referenceList(record.artifactReferences);
    if (boundArtifacts.some((reference) => !authoritativeArtifacts.includes(reference))) {
      throw new ConflictException('RED_TEAM artifact references do not match the authoritative governed execution record.');
    }

    return Object.freeze({
      organizationId,
      workflowRunId,
      correlationId: run.correlationId,
      reviewStepRunId: reviewStep.id,
      invocationId: record.id,
      providerId: record.providerId,
      capabilityCode: record.capabilityCode,
      outputReference: record.outputReference,
      artifactReferences: Object.freeze(authoritativeArtifacts),
      policyDecisionReference: record.policyDecisionReference,
      executionCompletedAt: record.completedAt,
      reviewStepFinishedAt: reviewStep.finishedAt,
      authority: 'GOVERNED_EXECUTION_RECORD' as const,
      verdictInterpretation: 'NOT_PERFORMED' as const,
    });
  }

  private objectValue(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private boundedString(value: unknown, maxChars: number): string | null {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxChars) return null;
    return value;
  }

  private referenceList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is string =>
          typeof item === 'string' && item.length > 0 && item.length <= MAX_REFERENCE_CHARS,
      )
      .slice(0, MAX_REFERENCES);
  }
}
