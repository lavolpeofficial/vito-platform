import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AgentExecutionStatus,
  EngineeringCapability,
  EngineeringStepType,
  ReviewVerdict,
  type ReviewFindingCategory,
  type ReviewFindingSeverity,
} from '@vito/contracts';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

const MANIFEST_VERSION = 'CORRECTION_CONTEXT_V1';
const MAX_FINDINGS = 50;
const MAX_FINDING_ID_CHARS = 256;
const MAX_SUMMARY_CHARS = 1_000;
const MAX_EVIDENCE_REFS = 16;
const MAX_REFERENCE_CHARS = 2_048;
const MAX_INVOCATION_ID_CHARS = 256;
const SEVERITIES = new Set<ReviewFindingSeverity>(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const CATEGORIES = new Set<ReviewFindingCategory>([
  'CORRECTNESS', 'SECURITY', 'ARCHITECTURE', 'TESTING', 'MAINTAINABILITY', 'GOVERNANCE', 'OTHER',
]);

type StepRow = {
  id: string;
  stepType: string;
  status: string;
  causationId: string | null;
  metadata: unknown;
};

export interface CorrectionContextFinding {
  readonly id: string;
  readonly severity: ReviewFindingSeverity;
  readonly category: ReviewFindingCategory;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly blocking: true;
}

export interface CorrectionContextManifest {
  readonly schemaVersion: typeof MANIFEST_VERSION;
  readonly workflowRunId: string;
  readonly correctionStepRunId: string;
  readonly parseVerdictStepRunId: string;
  readonly redTeamStepRunId: string;
  readonly reviewerExecutionId: string;
  readonly verdict: ReviewVerdict.D;
  readonly blockingFindings: readonly CorrectionContextFinding[];
  readonly governedExecutionReference: string;
  readonly policyDecisionReference: string;
  readonly manifestSha256: string;
}

@Injectable()
export class WorkflowCorrectionContextHandoffService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    organizationId: string,
    workflowRunId: string,
    correctionStepRunId: string,
  ): Promise<CorrectionContextManifest> {
    const correction = await this.step(organizationId, workflowRunId, correctionStepRunId);
    if (correction.stepType !== EngineeringStepType.CORRECTION || correction.status !== 'READY' || !correction.causationId) {
      throw new ConflictException('CORRECTION_CONTEXT_LINEAGE_INVALID');
    }

    const parse = await this.step(organizationId, workflowRunId, correction.causationId);
    if (parse.stepType !== EngineeringStepType.PARSE_VERDICT || parse.status !== 'SUCCEEDED' || !parse.causationId) {
      throw new ConflictException('CORRECTION_CONTEXT_PARSE_VERDICT_INVALID');
    }
    const parseMetadata = this.record(parse.metadata);
    const reviewStepRunId = this.boundedString(parseMetadata?.reviewStepRunId, MAX_INVOCATION_ID_CHARS);
    const reviewerExecutionId = this.boundedString(parseMetadata?.reviewerExecutionId, MAX_INVOCATION_ID_CHARS);
    if (
      parseMetadata?.source !== 'WORKFLOW_REVIEW_VERDICT_RUNTIME' ||
      parseMetadata?.authority !== 'GOVERNED_EXECUTION_RECORD' ||
      parseMetadata?.verdict !== ReviewVerdict.D ||
      !reviewStepRunId || !reviewerExecutionId || parse.causationId !== reviewStepRunId
    ) {
      throw new ConflictException('CORRECTION_CONTEXT_VERDICT_AUTHORITY_INVALID');
    }

    const review = await this.step(organizationId, workflowRunId, reviewStepRunId);
    if (review.stepType !== EngineeringStepType.RED_TEAM || review.status !== 'SUCCEEDED') {
      throw new ConflictException('CORRECTION_CONTEXT_REVIEW_LINEAGE_STALE');
    }
    const reviewMetadata = this.record(review.metadata);
    const reviewResult = this.record(reviewMetadata?.reviewResult);
    const executionEvidence = this.record(reviewMetadata?.executionEvidence);
    const outputReference = this.boundedString(executionEvidence?.outputReference, MAX_REFERENCE_CHARS);
    const invocationId = this.boundedString(executionEvidence?.invocationId, MAX_INVOCATION_ID_CHARS);
    const selectedProviderId = this.boundedString(reviewMetadata?.selectedProviderId, MAX_REFERENCE_CHARS);
    if (
      reviewMetadata?.source !== 'WORKFLOW_AGENT_RUNTIME' ||
      reviewMetadata?.reviewProjectionStatus !== 'VALID' ||
      reviewMetadata?.executionStatus !== AgentExecutionStatus.SUCCEEDED ||
      reviewMetadata?.capabilityCode !== EngineeringCapability.RED_TEAM ||
      reviewResult?.verdict !== ReviewVerdict.D ||
      reviewResult?.reviewerExecutionId !== reviewerExecutionId ||
      invocationId !== reviewerExecutionId ||
      !outputReference || !selectedProviderId
    ) {
      throw new ConflictException('CORRECTION_CONTEXT_REVIEW_PROJECTION_INVALID');
    }

    const blockingFindings = this.blockingFindings(reviewResult.findings);
    if (blockingFindings.length === 0) {
      throw new ConflictException('CORRECTION_CONTEXT_BLOCKING_FINDINGS_MISSING');
    }

    const record = await this.prisma.governedExecutionRecord.findFirst({
      where: {
        id: reviewerExecutionId,
        organizationId,
        workflowRunId,
        workflowStepRunId: review.id,
        capabilityCode: EngineeringCapability.RED_TEAM,
        providerId: selectedProviderId,
        status: AgentExecutionStatus.SUCCEEDED,
      },
      select: { id: true, outputReference: true, policyDecisionReference: true },
    });
    if (!record || record.outputReference !== outputReference || !record.policyDecisionReference) {
      throw new ConflictException('CORRECTION_CONTEXT_EXECUTION_LEDGER_MISMATCH');
    }

    const core = Object.freeze({
      schemaVersion: MANIFEST_VERSION,
      workflowRunId,
      correctionStepRunId,
      parseVerdictStepRunId: parse.id,
      redTeamStepRunId: review.id,
      reviewerExecutionId,
      verdict: ReviewVerdict.D,
      blockingFindings,
      governedExecutionReference: record.outputReference,
      policyDecisionReference: record.policyDecisionReference,
    });
    return Object.freeze({
      ...core,
      manifestSha256: createHash('sha256').update(JSON.stringify(core), 'utf8').digest('hex'),
    });
  }

  private async step(organizationId: string, workflowRunId: string, id: string): Promise<StepRow> {
    const step = await this.prisma.workflowStepRun.findFirst({
      where: { id, organizationId, workflowRunId },
      select: { id: true, stepType: true, status: true, causationId: true, metadata: true },
    });
    if (!step) throw new NotFoundException('CORRECTION_CONTEXT_STEP_NOT_FOUND');
    return step as StepRow;
  }

  private blockingFindings(value: unknown): readonly CorrectionContextFinding[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FINDINGS) {
      throw new ConflictException('CORRECTION_CONTEXT_FINDINGS_INVALID');
    }
    const findings: CorrectionContextFinding[] = [];
    for (const candidate of value) {
      const source = this.record(candidate);
      const id = this.boundedString(source?.id, MAX_FINDING_ID_CHARS);
      const summary = this.boundedString(source?.summary, MAX_SUMMARY_CHARS);
      const severity = source?.severity;
      const category = source?.category;
      const evidenceRefs = this.referenceList(source?.evidenceRefs);
      if (
        !id || !summary || typeof severity !== 'string' || !SEVERITIES.has(severity as ReviewFindingSeverity) ||
        typeof category !== 'string' || !CATEGORIES.has(category as ReviewFindingCategory) ||
        !Array.isArray(source?.evidenceRefs) || evidenceRefs.length !== source.evidenceRefs.length ||
        typeof source?.blocking !== 'boolean'
      ) {
        throw new ConflictException('CORRECTION_CONTEXT_FINDING_PROJECTION_INVALID');
      }
      if (source.blocking) {
        findings.push(Object.freeze({
          id,
          severity: severity as ReviewFindingSeverity,
          category: category as ReviewFindingCategory,
          summary,
          evidenceRefs: Object.freeze(evidenceRefs),
          blocking: true as const,
        }));
      }
    }
    return Object.freeze(findings);
  }

  private referenceList(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > MAX_EVIDENCE_REFS) return [];
    return value.filter(
      (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= MAX_REFERENCE_CHARS,
    );
  }

  private record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  private boundedString(value: unknown, maxChars: number): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= maxChars ? value : null;
  }
}
