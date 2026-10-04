import { Injectable } from '@nestjs/common';

export type ReleaseVerificationResultStatus = 'PASS' | 'FAIL' | 'BLOCKED';

export interface ReleaseVerificationResultProjection {
  readonly status: ReleaseVerificationResultStatus;
  readonly checksExecuted: number;
  readonly checksFailed: number;
  readonly blockingReasons: readonly string[];
  readonly evidenceRefs: readonly string[];
}

const MAX_STDOUT_CHARS = 64 * 1024;
const MAX_CHECK_COUNT = 1_000_000;
const MAX_BLOCKING_REASONS = 16;
const MAX_REASON_CHARS = 1_000;
const MAX_EVIDENCE_REFS = 32;
const MAX_REFERENCE_CHARS = 2_048;

@Injectable()
export class WorkflowReleaseVerificationResultProjectorService {
  project(execution: unknown): ReleaseVerificationResultProjection | null {
    const source = this.objectValue(execution);
    if (!source) return null;

    const providerMetadata = this.objectValue(source.providerExecutionMetadata);
    const stdout = this.boundedString(providerMetadata?.stdout, MAX_STDOUT_CHARS);
    if (!stdout) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(stdout);
    } catch {
      return null;
    }

    const payload = this.objectValue(raw);
    if (!payload || !this.isStatus(payload.status)) return null;

    const checksExecuted = this.checkCount(payload.checksExecuted);
    const checksFailed = this.checkCount(payload.checksFailed);
    if (checksExecuted === null || checksFailed === null || checksFailed > checksExecuted) return null;

    const blockingReasons = this.strings(payload.blockingReasons, MAX_BLOCKING_REASONS, MAX_REASON_CHARS);
    const evidenceRefs = this.strings(payload.evidenceRefs, MAX_EVIDENCE_REFS, MAX_REFERENCE_CHARS);
    if (!blockingReasons || !evidenceRefs) return null;

    if (
      payload.status === 'PASS' &&
      (checksExecuted < 1 || checksFailed !== 0 || blockingReasons.length !== 0)
    ) {
      return null;
    }
    if (
      payload.status === 'FAIL' &&
      (checksExecuted < 1 || checksFailed < 1 || blockingReasons.length < 1)
    ) {
      return null;
    }
    if (payload.status === 'BLOCKED' && blockingReasons.length < 1) {
      return null;
    }

    return Object.freeze({
      status: payload.status,
      checksExecuted,
      checksFailed,
      blockingReasons: Object.freeze(blockingReasons),
      evidenceRefs: Object.freeze(evidenceRefs),
    });
  }

  private isStatus(value: unknown): value is ReleaseVerificationResultStatus {
    return value === 'PASS' || value === 'FAIL' || value === 'BLOCKED';
  }

  private checkCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_CHECK_COUNT
      ? value
      : null;
  }

  private strings(value: unknown, maxItems: number, maxChars: number): string[] | null {
    if (!Array.isArray(value) || value.length > maxItems) return null;
    return value.every(
      (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= maxChars,
    ) ? [...value] : null;
  }

  private boundedString(value: unknown, maxChars: number): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= maxChars ? value : null;
  }

  private objectValue(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }
}
