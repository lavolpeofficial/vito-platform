import {
  mapCredentialRequirementFromPersistence,
  mapCredentialRequirementToPersistence,
  mapClaimRowToGovernedClaim,
  mapGovernedExecutionResultToRecordInput,
} from './governed-persistence.mappers';
import { ProviderCredentialRequirement, AgentExecutionStatus } from '@vito/contracts';
import type { GovernedCapabilityInvocationResult } from '@vito/contracts';

/**
 * Fokussierte B2a-Tests für die reinen Persistenz-Mapper.
 *
 * Mapper enthalten weder Geschäftslogik noch Policy-Entscheidungen.
 * credentialRequirement wird strikt gemappt: unbekannte Rohwerte fail-closed
 * zu UNKNOWN (EO-01.5-Semantik bleibt erhalten).
 */

describe('provider credentialRequirement persistence mapping', () => {
  it('maps all contract values verbatim to persistence', () => {
    expect(mapCredentialRequirementToPersistence(ProviderCredentialRequirement.REQUIRED)).toBe('REQUIRED');
    expect(mapCredentialRequirementToPersistence(ProviderCredentialRequirement.NOT_REQUIRED)).toBe('NOT_REQUIRED');
    expect(mapCredentialRequirementToPersistence(ProviderCredentialRequirement.UNKNOWN)).toBe('UNKNOWN');
  });

  it('maps persisted values back to the matching contract enum', () => {
    expect(mapCredentialRequirementFromPersistence('REQUIRED')).toBe(ProviderCredentialRequirement.REQUIRED);
    expect(mapCredentialRequirementFromPersistence('NOT_REQUIRED')).toBe(ProviderCredentialRequirement.NOT_REQUIRED);
    expect(mapCredentialRequirementFromPersistence('UNKNOWN')).toBe(ProviderCredentialRequirement.UNKNOWN);
  });

  it('fails closed to UNKNOWN for garbage / legacy / missing raw values', () => {
    expect(mapCredentialRequirementFromPersistence('garbage')).toBe(ProviderCredentialRequirement.UNKNOWN);
    expect(mapCredentialRequirementFromPersistence('required')).toBe(ProviderCredentialRequirement.UNKNOWN);
    expect(mapCredentialRequirementFromPersistence('')).toBe(ProviderCredentialRequirement.UNKNOWN);
    expect(mapCredentialRequirementFromPersistence(null)).toBe(ProviderCredentialRequirement.UNKNOWN);
    expect(mapCredentialRequirementFromPersistence(undefined)).toBe(ProviderCredentialRequirement.UNKNOWN);
  });

  it('round-trips without information gain', () => {
    for (const value of [
      ProviderCredentialRequirement.REQUIRED,
      ProviderCredentialRequirement.NOT_REQUIRED,
      ProviderCredentialRequirement.UNKNOWN,
    ]) {
      expect(mapCredentialRequirementFromPersistence(mapCredentialRequirementToPersistence(value))).toBe(value);
    }
  });
});

const CLAIM_ROW = Object.freeze({
  id: 'claim-row-1',
  logicalOperationKey: 'logop-v2|org:5:org-1',
  invocationId: 'inv-1',
  contextFingerprint: 'v1|org:5:org-1',
  state: 'IN_PROGRESS',
  claimedAt: new Date('2026-08-23T10:00:00.000Z'),
  updatedAt: new Date('2026-08-23T10:00:01.000Z'),
});

describe('claim row persistence mapping', () => {
  it('maps every contract field faithfully', () => {
    const claim = mapClaimRowToGovernedClaim(CLAIM_ROW);
    expect(claim).toEqual({
      logicalOperationKey: CLAIM_ROW.logicalOperationKey,
      invocationId: CLAIM_ROW.invocationId,
      contextFingerprint: CLAIM_ROW.contextFingerprint,
      state: 'IN_PROGRESS',
      claimedAt: CLAIM_ROW.claimedAt,
    });
  });

  it('preserves the exact claimedAt instance (no re-normalization)', () => {
    const claim = mapClaimRowToGovernedClaim({ ...CLAIM_ROW, state: 'TIMED_OUT_UNKNOWN' });
    expect(claim.claimedAt).toBe(CLAIM_ROW.claimedAt);
    expect(claim.state).toBe('TIMED_OUT_UNKNOWN');
  });
});

function makeResult(overrides: Partial<GovernedCapabilityInvocationResult> = {}): GovernedCapabilityInvocationResult {
  return {
    invocationId: 'inv-9',
    organizationId: 'org-1',
    workflowRunId: 'run-1',
    workflowStepRunId: 'step-1',
    correlationId: 'corr-1',
    capabilityCode: 'CODE_BUILD',
    providerId: 'provider-1',
    status: AgentExecutionStatus.SUCCEEDED,
    startedAt: new Date('2026-08-23T10:00:00.000Z'),
    completedAt: new Date('2026-08-23T10:00:02.000Z'),
    durationMs: 2000,
    policyDecisionReference: 'pdref-1',
    providerExecutionMetadata: {},
    ...overrides,
  };
}

describe('governed execution result -> record input mapping', () => {
  it('maps identity chain, status and timing verbatim', () => {
    const input = mapGovernedExecutionResultToRecordInput(makeResult());
    expect(input.id).toBe('inv-9');
    expect(input.organizationId).toBe('org-1');
    expect(input.workflowRunId).toBe('run-1');
    expect(input.workflowStepRunId).toBe('step-1');
    expect(input.capabilityCode).toBe('CODE_BUILD');
    expect(input.providerId).toBe('provider-1');
    expect(input.status).toBe('SUCCEEDED');
    expect(input.startedAt).toEqual(new Date('2026-08-23T10:00:00.000Z'));
    expect(input.completedAt).toEqual(new Date('2026-08-23T10:00:02.000Z'));
    expect(input.durationMs).toBe(2000);
    expect(input.policyDecisionReference).toBe('pdref-1');
  });

  it('maps optional structures without inventing data', () => {
    const result = makeResult({
      outputReference: 'gov://workspace/out.txt',
      artifactReferences: ['gov://workspace/a.txt'],
      normalizedError: { reason: 'EXECUTION_FAILED', message: 'boom', retryable: false },
      sideEffectSummary: { filesCreated: ['out.txt'], filesModified: [], filesDeleted: [], commandsExecuted: [] },
      usageMetadata: { tokensIn: 1 },
    });
    const input = mapGovernedExecutionResultToRecordInput(result);
    expect(input.outputReference).toBe('gov://workspace/out.txt');
    expect(input.artifactReferences).toEqual(['gov://workspace/a.txt']);
    expect(input.normalizedError).toEqual({ reason: 'EXECUTION_FAILED', message: 'boom', retryable: false });
    expect(input.sideEffectSummary).toEqual({
      filesCreated: ['out.txt'],
      filesModified: [],
      filesDeleted: [],
      commandsExecuted: [],
    });
    expect(input.usageMetadata).toEqual({ tokensIn: 1 });
  });

  it('keeps absent optionals absent (no fabricated defaults)', () => {
    const input = mapGovernedExecutionResultToRecordInput(makeResult());
    expect(input.outputReference).toBeNull();
    expect(input.artifactReferences).toBeNull();
    expect(input.normalizedError).toBeNull();
    expect(input.sideEffectSummary).toBeNull();
    expect(input.usageMetadata).toBeNull();
  });
});
