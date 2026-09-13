import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AgentExecutionStatus,
  EngineeringCapability,
  EngineeringStepType,
  ReviewVerdict,
  type IndependenceContext,
  type ReviewResult,
} from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowRuntimeService } from '../workflow-runtime/workflow-runtime.service';
import { WorkflowReviewEvidenceService } from './workflow-review-evidence.service';

const AL4 = 'AL4';
const MAX_REFERENCES = 32;
const MAX_REFERENCE_CHARS = 2_048;
const MAX_INVOCATION_ID_CHARS = 256;

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

    if (assuranceLevel === AL4) {
      return this.parseAl4AndTransition(organizationId, workflowRunId, parseStep.id);
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

  private async parseAl4AndTransition(
    organizationId: string,
    workflowRunId: string,
    parseStepRunId: string,
  ) {
    const reviewStep = await this.prisma.workflowStepRun.findFirst({
      where: {
        organizationId,
        workflowRunId,
        stepType: EngineeringStepType.RED_TEAM,
        status: 'SUCCEEDED',
      },
      orderBy: { finishedAt: 'desc' },
      select: { id: true, metadata: true },
    });
    if (!reviewStep) {
      throw new ConflictException('No succeeded AL4 RED_TEAM workflow step is available.');
    }

    const metadata = this.objectValue(reviewStep.metadata);
    if (metadata?.source !== 'WORKFLOW_AL4_REVIEW_COORDINATOR') {
      throw new ConflictException('AL4 RED_TEAM evidence was not produced by the governed review coordinator.');
    }

    const reviewResults = this.reviewResults(metadata.reviewResults);
    const independenceContext = this.independenceContext(metadata.independenceContext);
    const builderLineage = this.objectValue(metadata.builderLineage);
    const reviewerLineage = this.objectArray(metadata.reviewerLineage);
    if (!reviewResults || reviewResults.length !== 2 || !independenceContext || !builderLineage || reviewerLineage.length !== 2) {
      throw new ConflictException('AL4 multi-reviewer evidence is incomplete or malformed.');
    }

    const builderProviderId = this.nonEmptyString(builderLineage.providerId);
    const builderModelFamily = this.nonEmptyString(builderLineage.modelFamily);
    if (
      !builderProviderId ||
      !builderModelFamily ||
      independenceContext.builderProviderId !== builderProviderId ||
      independenceContext.builderModelFamily !== builderModelFamily
    ) {
      throw new ConflictException('AL4 builder lineage does not match the persisted independence context.');
    }

    const reviewerProviderIds: string[] = [];
    const reviewerModelFamilies: string[] = [];
    for (let index = 0; index < reviewResults.length; index += 1) {
      const reviewResult = reviewResults[index];
      const lineage = reviewerLineage[index];
      const reviewerExecutionId = this.boundedString(lineage.reviewerExecutionId, MAX_INVOCATION_ID_CHARS);
      const providerId = this.nonEmptyString(lineage.providerId);
      const modelFamily = this.nonEmptyString(lineage.modelFamily);
      if (!reviewerExecutionId || !providerId || !modelFamily) {
        throw new ConflictException('AL4 reviewer lineage is incomplete.');
      }
      if (reviewResult.reviewerExecutionId !== reviewerExecutionId) {
        throw new ConflictException('AL4 ReviewResult execution identity does not match reviewer lineage.');
      }
      if (this.normalizeAssuranceLevel(reviewResult.assuranceLevel) !== AL4) {
        throw new ConflictException('AL4 ReviewResult assurance level does not match the WorkflowRun.');
      }

      const provider = await this.prisma.agentProvider.findFirst({
        where: { id: providerId, organizationId },
        select: { id: true, modelFamily: true },
      });
      if (!provider || provider.modelFamily !== modelFamily) {
        throw new ConflictException('AL4 reviewer provider/model-family lineage is not authoritative.');
      }

      const record = await this.prisma.governedExecutionRecord.findFirst({
        where: {
          id: reviewerExecutionId,
          organizationId,
          workflowRunId,
          workflowStepRunId: reviewStep.id,
          capabilityCode: EngineeringCapability.RED_TEAM,
          status: AgentExecutionStatus.SUCCEEDED,
          providerId,
        },
        select: { id: true, artifactReferences: true },
      });
      if (!record) {
        throw new ConflictException('AL4 reviewer execution does not match the governed execution ledger.');
      }

      const authoritativeArtifacts = this.referenceList(record.artifactReferences);
      const resultArtifacts = this.referenceList(reviewResult.artifactRefs);
      if (resultArtifacts.some((reference) => !authoritativeArtifacts.includes(reference))) {
        throw new ConflictException('AL4 ReviewResult artifact references do not match governed execution evidence.');
      }

      reviewerProviderIds.push(providerId);
      reviewerModelFamilies.push(modelFamily);
    }

    if (
      new Set(reviewerProviderIds).size !== reviewResults.length ||
      new Set(reviewerModelFamilies).size !== reviewResults.length ||
      reviewerProviderIds.includes(builderProviderId) ||
      reviewerModelFamilies.includes(builderModelFamily) ||
      !this.sameStringSequence(independenceContext.previousReviewerProviderIds, reviewerProviderIds) ||
      !this.sameStringSequence(independenceContext.previousReviewerModelFamilies, reviewerModelFamilies)
    ) {
      throw new ConflictException('AL4 reviewer independence cannot be proven from persisted authoritative lineage.');
    }

    const transition = await this.workflowRuntime.completeStep({
      organizationId,
      workflowRunId,
      workflowStepRunId: parseStepRunId,
      stepStatus: 'SUCCEEDED',
      reviewResults,
      independenceContext,
      metadata: {
        source: 'WORKFLOW_AL4_REVIEW_VERDICT_RUNTIME',
        reviewStepRunId: reviewStep.id,
        assuranceLevel: AL4,
        reviewerExecutionIds: reviewResults.map((result) => result.reviewerExecutionId),
        reviewerProviderIds,
        reviewerModelFamilies,
        builderProviderId,
        builderModelFamily,
        authority: 'GOVERNED_EXECUTION_RECORDS',
      },
    });

    return Object.freeze({
      disposition: 'AL4_VERDICT_TRANSITIONED' as const,
      workflowRunId,
      workflowStepRunId: parseStepRunId,
      reviewStepRunId: reviewStep.id,
      assuranceLevel: AL4,
      reviewerExecutionIds: Object.freeze(reviewResults.map((result) => result.reviewerExecutionId)),
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

  private reviewResults(value: unknown): readonly ReviewResult[] | null {
    if (!Array.isArray(value)) return null;
    const results: ReviewResult[] = [];
    for (const item of value) {
      const record = this.objectValue(item);
      const verdict = this.reviewVerdict(record?.verdict);
      const reviewerExecutionId = this.boundedString(record?.reviewerExecutionId, MAX_INVOCATION_ID_CHARS);
      const assuranceLevel = this.normalizeAssuranceLevel(record?.assuranceLevel);
      const artifactRefs = this.stringArray(record?.artifactRefs);
      if (!record || !verdict || !reviewerExecutionId || assuranceLevel !== AL4 || artifactRefs === null || !Array.isArray(record.findings)) {
        return null;
      }
      results.push(record as unknown as ReviewResult);
    }
    return Object.freeze(results);
  }

  private independenceContext(value: unknown): IndependenceContext | null {
    const record = this.objectValue(value);
    const builderProviderId = this.nonEmptyString(record?.builderProviderId);
    const builderModelFamily = this.nonEmptyString(record?.builderModelFamily);
    const previousReviewerProviderIds = this.stringArray(record?.previousReviewerProviderIds);
    const previousReviewerModelFamilies = this.stringArray(record?.previousReviewerModelFamilies);
    if (!builderProviderId || !builderModelFamily || !previousReviewerProviderIds || !previousReviewerModelFamilies) {
      return null;
    }
    return Object.freeze({
      builderProviderId,
      builderModelFamily,
      previousReviewerProviderIds: Object.freeze(previousReviewerProviderIds),
      previousReviewerModelFamilies: Object.freeze(previousReviewerModelFamilies),
    });
  }

  private objectValue(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private objectArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    const records = value.map((item) => this.objectValue(item));
    return records.every((item): item is Record<string, unknown> => item !== null) ? records : [];
  }

  private stringArray(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
    return value as string[];
  }

  private referenceList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= MAX_REFERENCE_CHARS,
      )
      .slice(0, MAX_REFERENCES);
  }

  private boundedString(value: unknown, maxChars: number): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= maxChars ? value : null;
  }

  private nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private sameStringSequence(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
}
