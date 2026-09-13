import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EngineeringStepType, ReviewVerdict } from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowRuntimeService } from '../workflow-runtime/workflow-runtime.service';
import { WorkflowReviewEvidenceService } from './workflow-review-evidence.service';

@Injectable()
export class WorkflowReviewVerdictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewEvidence: WorkflowReviewEvidenceService,
    private readonly workflowRuntime: WorkflowRuntimeService,
  ) {}

  async parseAndTransition(organizationId: string, workflowRunId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: workflowRunId, organizationId },
      select: {
        id: true,
        status: true,
        currentStepType: true,
        assuranceLevel: true,
      },
    });
    if (!run) throw new NotFoundException('WorkflowRun not found.');
    if (run.status !== 'RUNNING' || run.currentStepType !== EngineeringStepType.PARSE_VERDICT) {
      throw new ConflictException('WorkflowRun is not ready for PARSE_VERDICT.');
    }

    const assuranceLevel = this.normalizeAssuranceLevel(run.assuranceLevel);
    if (!assuranceLevel) {
      throw new ConflictException('WorkflowRun has an invalid assurance level.');
    }
    if (assuranceLevel === 'AL4') {
      throw new ConflictException(
        'AL4 verdict parsing remains blocked until authoritative multi-reviewer independence evidence is available.',
      );
    }

    const parseStep = await this.prisma.workflowStepRun.findFirst({
      where: {
        organizationId,
        workflowRunId,
        stepType: EngineeringStepType.PARSE_VERDICT,
        status: 'READY',
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (!parseStep) {
      throw new ConflictException('No READY PARSE_VERDICT workflow step found.');
    }

    const evidence = await this.reviewEvidence.resolve(organizationId, workflowRunId);
    const reviewStep = await this.prisma.workflowStepRun.findFirst({
      where: {
        id: evidence.reviewStepRunId,
        organizationId,
        workflowRunId,
        stepType: EngineeringStepType.RED_TEAM,
        status: 'SUCCEEDED',
      },
      select: { id: true, metadata: true },
    });
    if (!reviewStep) {
      throw new ConflictException('Authoritative RED_TEAM workflow step is unavailable.');
    }

    const reviewResult = this.objectValue(this.objectValue(reviewStep.metadata)?.reviewResult);
    if (!reviewResult) {
      throw new ConflictException('RED_TEAM step has no persisted typed ReviewResult projection.');
    }

    const verdict = this.reviewVerdict(reviewResult.verdict);
    if (!verdict) {
      throw new ConflictException('Persisted ReviewResult has an invalid verdict.');
    }
    if (reviewResult.reviewerExecutionId !== evidence.invocationId) {
      throw new ConflictException('ReviewResult reviewer execution does not match governed evidence lineage.');
    }
    if (this.normalizeAssuranceLevel(reviewResult.assuranceLevel) !== assuranceLevel) {
      throw new ConflictException('ReviewResult assurance level does not match the WorkflowRun.');
    }

    const artifactRefs = this.stringArray(reviewResult.artifactRefs);
    if (artifactRefs === null || artifactRefs.some((reference) => !evidence.artifactReferences.includes(reference))) {
      throw new ConflictException('ReviewResult artifact references do not match governed evidence lineage.');
    }

    const transition = await this.workflowRuntime.completeStep({
      organizationId,
      workflowRunId,
      workflowStepRunId: parseStep.id,
      stepStatus: 'SUCCEEDED',
      verdict,
      metadata: {
        source: 'WORKFLOW_REVIEW_VERDICT_RUNTIME',
        reviewStepRunId: reviewStep.id,
        reviewerExecutionId: evidence.invocationId,
        assuranceLevel,
        verdict,
        authority: evidence.authority,
      },
    });

    return Object.freeze({
      disposition: 'VERDICT_TRANSITIONED' as const,
      workflowRunId,
      workflowStepRunId: parseStep.id,
      reviewStepRunId: reviewStep.id,
      reviewerExecutionId: evidence.invocationId,
      assuranceLevel,
      verdict,
      transition,
    });
  }

  private normalizeAssuranceLevel(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/^AL-(\d)$/u, 'AL$1');
    return /^AL[1-4]$/u.test(normalized) ? normalized : null;
  }

  private reviewVerdict(value: unknown): ReviewVerdict | null {
    return typeof value === 'string' && Object.values(ReviewVerdict).includes(value as ReviewVerdict)
      ? (value as ReviewVerdict)
      : null;
  }

  private objectValue(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private stringArray(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
    return value as string[];
  }
}
