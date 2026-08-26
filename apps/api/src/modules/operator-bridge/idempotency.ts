import { createHash } from 'node:crypto';

export interface OperatorFingerprintInput {
  readonly capabilityCode: string;
  readonly prompt: string;
  readonly assuranceLevel?: string;
  readonly budget?: {
    readonly maxDurationMs?: number;
    readonly maxTokens?: number;
    readonly maxCostMinorUnits?: number;
  };
}

export function computeRequestFingerprint(input: OperatorFingerprintInput): string {
  const canonical = JSON.stringify({
    capabilityCode: input.capabilityCode,
    prompt: input.prompt,
    assuranceLevel: input.assuranceLevel ?? null,
    budget: {
      maxDurationMs: input.budget?.maxDurationMs ?? null,
      maxTokens: input.budget?.maxTokens ?? null,
      maxCostMinorUnits: input.budget?.maxCostMinorUnits ?? null,
    },
  });

  return createHash('sha256').update(canonical).digest('hex');
}
