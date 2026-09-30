import { Injectable } from '@nestjs/common';

export type TestResultStatus = 'PASS' | 'FAIL' | 'BLOCKED';

export interface TestResultProjection {
  readonly status: TestResultStatus;
  readonly testsExecuted: number;
  readonly testsFailed: number;
  readonly evidenceRefs: readonly string[];
}

const MAX_STDOUT_CHARS = 64 * 1024;
const MAX_TEST_COUNT = 1_000_000;
const MAX_EVIDENCE_REFS = 32;
const MAX_REFERENCE_CHARS = 2_048;

@Injectable()
export class WorkflowTestResultProjectorService {
  project(execution: unknown): TestResultProjection | null {
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

    const testsExecuted = this.testCount(payload.testsExecuted);
    const testsFailed = this.testCount(payload.testsFailed);
    if (testsExecuted === null || testsFailed === null || testsFailed > testsExecuted) return null;

    const evidenceRefs = this.references(payload.evidenceRefs);
    if (!evidenceRefs) return null;

    if (payload.status === 'PASS' && (testsExecuted < 1 || testsFailed !== 0)) return null;
    if (payload.status === 'FAIL' && (testsExecuted < 1 || testsFailed < 1)) return null;

    return Object.freeze({
      status: payload.status,
      testsExecuted,
      testsFailed,
      evidenceRefs: Object.freeze(evidenceRefs),
    });
  }
  private isStatus(value: unknown): value is TestResultStatus {
    return value === 'PASS' || value === 'FAIL' || value === 'BLOCKED';
  }

  private testCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TEST_COUNT
      ? value
      : null;
  }

  private references(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length > MAX_EVIDENCE_REFS) return null;
    return value.every(
      (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= MAX_REFERENCE_CHARS,
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