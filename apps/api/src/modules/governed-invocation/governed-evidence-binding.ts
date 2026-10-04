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

export interface GovernedRuntimeEvidence {
  readonly workspaceDisposition: 'CLEANED';
  readonly ephemeralMaterialDisposition: 'REMOVED';
  readonly settling: Readonly<{
    executionId: string;
    revisionReference: string;
    changedFiles: readonly string[];
    empty: boolean;
    patchSha256Reference: string;
  }>;
  readonly providerIdentityPostcondition?: Readonly<{
    enforced: boolean;
    passed: boolean;
    observedProviderId: string | null;
    observedModelId: string | null;
  }>;
  readonly flight001Acceptance?: Readonly<{
    checked: boolean;
    passed?: boolean;
    expectedPath?: string;
    expectedSha256Reference?: string;
    actualSha256Reference?: string | null;
  }>;
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

export function buildGovernedRuntimeEvidence(
  providerExecutionMetadata: Record<string, unknown> | undefined,
): GovernedRuntimeEvidence | null {
  if (!providerExecutionMetadata) return null;
  const settling = record(providerExecutionMetadata.governedResultSettling);
  if (!settling) return null;
  const executionId = boundedString(settling.executionId, 256);
  const baseSha = typeof settling.baseSha === 'string' && GIT_SHA.test(settling.baseSha)
    ? settling.baseSha
    : null;
  const changedFiles = strictBoundedStringArray(settling.changedFiles, 64, 512);
  const patch = typeof settling.patch === 'string' ? settling.patch : null;
  const empty = typeof settling.empty === 'boolean' ? settling.empty : null;
  if (
    providerExecutionMetadata.workspaceDisposition !== 'CLEANED' ||
    providerExecutionMetadata.credentialDisposition !== 'removed' ||
    !executionId ||
    !baseSha ||
    changedFiles === null ||
    patch === null ||
    empty === null
  ) return null;

  const identity = record(providerExecutionMetadata.providerIdentityPostcondition);
  const identityEvidence = identity && typeof identity.enforced === 'boolean' && typeof identity.passed === 'boolean'
    ? Object.freeze({
        enforced: identity.enforced,
        passed: identity.passed,
        observedProviderId: boundedString(identity.observedProviderId, 256),
        observedModelId: boundedString(identity.observedModelId, 256),
      })
    : undefined;
  const acceptance = record(providerExecutionMetadata.flight001Acceptance);
  const acceptanceEvidence = acceptance && typeof acceptance.checked === 'boolean'
    ? Object.freeze({
        checked: acceptance.checked,
        ...(typeof acceptance.passed === 'boolean' ? { passed: acceptance.passed } : {}),
        ...(boundedString(acceptance.expectedPath, 512) ? { expectedPath: boundedString(acceptance.expectedPath, 512)! } : {}),
        ...(boundedSha(acceptance.expectedSha256) ? { expectedSha256Reference: `gov://evidence/sha256/${boundedSha(acceptance.expectedSha256)!}` } : {}),
        ...(acceptance.actualSha256 === null ? { actualSha256Reference: null } : boundedSha(acceptance.actualSha256) ? { actualSha256Reference: `gov://evidence/sha256/${boundedSha(acceptance.actualSha256)!}` } : {}),
      })
    : undefined;

  return Object.freeze({
    workspaceDisposition: 'CLEANED' as const,
    ephemeralMaterialDisposition: 'REMOVED' as const,
    settling: Object.freeze({
      executionId,
      revisionReference: `gov://revision/${baseSha}`,
      changedFiles,
      empty,
      patchSha256Reference: `gov://evidence/patch-sha256/${sha256(patch)}`,
    }),
    ...(identityEvidence ? { providerIdentityPostcondition: identityEvidence } : {}),
    ...(acceptanceEvidence ? { flight001Acceptance: acceptanceEvidence } : {}),
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

function boundedString(value: unknown, maxChars: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxChars ? value : null;
}

function strictBoundedStringArray(value: unknown, maxItems: number, maxChars: number): readonly string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > maxChars) return null;
    result.push(item);
  }
  return Object.freeze(result);
}

function boundedSha(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
