import { createHash } from 'node:crypto';

const GIT_SHA = /^[a-f0-9]{40,64}$/u;

export interface GovernedEvidenceBinding {
  readonly revisionReference?: string;
  readonly stdoutSha256Reference?: string;
  readonly exitCode?: number;
}

export interface BoundedExecutionResultSummary {
  readonly sha256: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly charLength: number;
}

export function buildGovernedEvidenceBinding(
  rawProviderExecutionMetadata: Record<string, unknown> | undefined,
  sanitizedProviderExecutionMetadata: Record<string, unknown> | undefined = rawProviderExecutionMetadata,
): GovernedEvidenceBinding | null {
  if (!rawProviderExecutionMetadata && !sanitizedProviderExecutionMetadata) return null;
  const rawSettling = record(rawProviderExecutionMetadata?.governedResultSettling);
  const rawBaseSha = rawSettling?.baseSha;
  const baseSha = typeof rawBaseSha === 'string' && GIT_SHA.test(rawBaseSha) ? rawBaseSha : undefined;
  const stdout = typeof sanitizedProviderExecutionMetadata?.stdout === 'string'
    ? sanitizedProviderExecutionMetadata.stdout
    : undefined;
  const exitCode = Number.isInteger(sanitizedProviderExecutionMetadata?.exitCode)
    ? (sanitizedProviderExecutionMetadata?.exitCode as number)
    : undefined;
  if (!baseSha && stdout === undefined && exitCode === undefined) return null;
  return Object.freeze({
    ...(baseSha ? { revisionReference: `gov://revision/${baseSha}` } : {}),
    ...(stdout !== undefined ? { stdoutSha256Reference: `gov://evidence/stdout-sha256/${sha256(stdout)}` } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  });
}

export function buildBoundedExecutionResultSummary(
  providerExecutionMetadata: Record<string, unknown> | undefined,
  maxChars: number,
): BoundedExecutionResultSummary | null {
  if (!providerExecutionMetadata || !Number.isInteger(maxChars) || maxChars < 1) return null;
  const stdout = providerExecutionMetadata.stdout;
  if (typeof stdout !== 'string' || stdout.length === 0) return null;
  return Object.freeze({
    sha256: sha256(stdout),
    content: stdout.slice(0, maxChars),
    truncated: stdout.length > maxChars,
    charLength: stdout.length,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
