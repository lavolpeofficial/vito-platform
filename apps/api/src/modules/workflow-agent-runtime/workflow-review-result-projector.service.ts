import { Injectable } from '@nestjs/common';
import {
  AssuranceLevel,
  ReviewVerdict,
  type ReviewFinding,
  type ReviewFindingCategory,
  type ReviewFindingSeverity,
  type ReviewResult,
} from '@vito/contracts';

const MAX_STDOUT_CHARS = 64 * 1024;
const MAX_FINDINGS = 50;
const MAX_FINDING_ID_CHARS = 256;
const MAX_SUMMARY_CHARS = 1_000;
const MAX_EVIDENCE_REFS = 16;
const MAX_REFERENCE_CHARS = 2_048;
const MAX_ARTIFACT_REFS = 32;
const MAX_INVOCATION_ID_CHARS = 256;
const SEVERITIES = new Set<ReviewFindingSeverity>(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const CATEGORIES = new Set<ReviewFindingCategory>([
  'CORRECTNESS', 'SECURITY', 'ARCHITECTURE', 'TESTING', 'MAINTAINABILITY', 'GOVERNANCE', 'OTHER',
]);

@Injectable()
export class WorkflowReviewResultProjectorService {
  project(execution: unknown, assuranceLevel: string): ReviewResult | null {
    const source = this.objectValue(execution);
    if (!source) return null;
    const invocationId = this.boundedString(source.invocationId, MAX_INVOCATION_ID_CHARS);
    const providerMetadata = this.objectValue(source.providerExecutionMetadata);
    const stdout = this.boundedString(providerMetadata?.stdout, MAX_STDOUT_CHARS);
    const assurance = this.assuranceLevel(assuranceLevel);
    if (!invocationId || !stdout || !assurance) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(stdout);
    } catch {
      return null;
    }
    const payload = this.objectValue(raw);
    if (!payload || !this.isVerdict(payload.verdict) || !Array.isArray(payload.findings)) return null;
    if (payload.findings.length > MAX_FINDINGS) return null;

    const findings: ReviewFinding[] = [];
    for (const candidate of payload.findings) {
      const finding = this.finding(candidate);
      if (!finding) return null;
      findings.push(finding);
    }

    return Object.freeze({
      verdict: payload.verdict,
      findings: Object.freeze(findings),
      reviewerExecutionId: invocationId,
      assuranceLevel: assurance,
      artifactRefs: Object.freeze(this.references(source.artifactReferences, MAX_ARTIFACT_REFS)),
    });
  }

  private finding(value: unknown): ReviewFinding | null {
    const source = this.objectValue(value);
    if (!source) return null;
    const id = this.boundedString(source.id, MAX_FINDING_ID_CHARS);
    const summary = this.boundedString(source.summary, MAX_SUMMARY_CHARS);
    if (!id || !summary || !this.isSeverity(source.severity) || !this.isCategory(source.category)) return null;
    if (typeof source.blocking !== 'boolean' || !Array.isArray(source.evidenceRefs)) return null;
    const evidenceRefs = this.references(source.evidenceRefs, MAX_EVIDENCE_REFS);
    if (evidenceRefs.length !== source.evidenceRefs.length) return null;
    return Object.freeze({
      id,
      severity: source.severity,
      category: source.category,
      summary,
      evidenceRefs: Object.freeze(evidenceRefs),
      blocking: source.blocking,
    });
  }

  private assuranceLevel(value: string): AssuranceLevel | null {
    const normalized = value.replace(/^AL-(\d)$/u, 'AL$1');
    return Object.values(AssuranceLevel).includes(normalized as AssuranceLevel)
      ? (normalized as AssuranceLevel)
      : null;
  }

  private isVerdict(value: unknown): value is ReviewVerdict {
    return typeof value === 'string' && Object.values(ReviewVerdict).includes(value as ReviewVerdict);
  }

  private isSeverity(value: unknown): value is ReviewFindingSeverity {
    return typeof value === 'string' && SEVERITIES.has(value as ReviewFindingSeverity);
  }

  private isCategory(value: unknown): value is ReviewFindingCategory {
    return typeof value === 'string' && CATEGORIES.has(value as ReviewFindingCategory);
  }

  private references(value: unknown, max: number): string[] {
    if (!Array.isArray(value) || value.length > max) return [];
    return value.filter(
      (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= MAX_REFERENCE_CHARS,
    );
  }

  private boundedString(value: unknown, maxChars: number): string | null {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxChars) return null;
    return value;
  }

  private objectValue(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, any>;
  }
}
