import {
  ProviderCredentialRequirement,
  type GovernedCapabilityInvocationResult,
  type GovernedInvocationClaimState,
  type GovernedInvocationExecutionClaim,
} from '@vito/contracts';

/**
 * Reine Persistenz-Mapper für die Governed Persistence Foundation (B2a).
 *
 * Enthalten weder Geschäftslogik noch Policy-Entscheidungen und erzeugen
 * keine Secret-/Rohmaterial-Felder. Die JSON-Strukturen der Execution
 * Records sind bereits durch EO-01.5 sanitisierte Formen und werden hier
 * unverändert übernommen — dieses Modul erfindet KEIN zweites Redaction-
 * System.
 */

const PERSISTED_CREDENTIAL_REQUIREMENT_VALUES: readonly string[] = [
  ProviderCredentialRequirement.REQUIRED,
  ProviderCredentialRequirement.NOT_REQUIRED,
  ProviderCredentialRequirement.UNKNOWN,
];

/** Vertragswert -> Persistenzwert (1:1, keine Normalisierung). */
export function mapCredentialRequirementToPersistence(value: ProviderCredentialRequirement): string {
  return value;
}

/**
 * Persistenzwert -> Vertragswert. Strikt: jeder unbekannte/fehlende
 * Rohwert fail-closed zu UNKNOWN (EO-01.5: fehlende Daten werden niemals
 * stillschweigend auf NOT_REQUIRED gemappt).
 */
export function mapCredentialRequirementFromPersistence(
  raw: string | null | undefined,
): ProviderCredentialRequirement {
  if (raw && PERSISTED_CREDENTIAL_REQUIREMENT_VALUES.includes(raw)) {
    return raw as ProviderCredentialRequirement;
  }
  return ProviderCredentialRequirement.UNKNOWN;
}

/** Zeilenform eines governed Invocation Claims (strukturkompatibel zur Tabelle). */
export interface GovernedInvocationClaimRow {
  logicalOperationKey: string;
  invocationId: string;
  contextFingerprint: string;
  state: string;
  claimedAt: Date;
}

/** Tabellenzeile -> Contract-Claim (Evidenzform, ohne interne Zusatzfelder). */
export function mapClaimRowToGovernedClaim(row: GovernedInvocationClaimRow): GovernedInvocationExecutionClaim {
  return {
    logicalOperationKey: row.logicalOperationKey,
    invocationId: row.invocationId,
    contextFingerprint: row.contextFingerprint,
    state: row.state as GovernedInvocationClaimState,
    claimedAt: row.claimedAt,
  };
}

/** Spalteninput für governed_execution_records (Prisma-kompatible Form). */
export interface GovernedExecutionRecordInput {
  id: string;
  organizationId: string;
  workflowRunId: string;
  workflowStepRunId: string;
  capabilityCode: string;
  providerId: string;
  status: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  outputReference: string | null;
  artifactReferences: readonly string[] | null;
  normalizedError: Record<string, unknown> | null;
  policyDecisionReference: string;
  sideEffectSummary: Record<string, unknown> | null;
  usageMetadata: Record<string, unknown> | null;
}

/**
 * Governdes Invocation-Ergebnis -> Record-Spalten. Optionale Strukturen
 * bleiben optional (null), es werden keine Defaults erfunden. correlationId
 * lebt am Operation Envelope, nicht am Record.
 */
export function mapGovernedExecutionResultToRecordInput(
  result: GovernedCapabilityInvocationResult,
): GovernedExecutionRecordInput {
  return {
    id: result.invocationId,
    organizationId: result.organizationId,
    workflowRunId: result.workflowRunId,
    workflowStepRunId: result.workflowStepRunId,
    capabilityCode: result.capabilityCode,
    providerId: result.providerId,
    status: result.status,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    outputReference: result.outputReference ?? null,
    artifactReferences: result.artifactReferences ? [...result.artifactReferences] : null,
    normalizedError: result.normalizedError
      ? (result.normalizedError as unknown as Record<string, unknown>)
      : null,
    policyDecisionReference: result.policyDecisionReference,
    sideEffectSummary: result.sideEffectSummary
      ? (result.sideEffectSummary as unknown as Record<string, unknown>)
      : null,
    usageMetadata: result.usageMetadata ?? null,
  };
}
