import { computeRequestFingerprint } from './idempotency';

describe('computeRequestFingerprint', () => {
  const base = {
    capabilityCode: 'CODE_BUILD',
    prompt: 'Implement exactly this task.\n',
    assuranceLevel: 'AL-3',
    budget: { maxDurationMs: 120_000, maxTokens: 1000, maxCostMinorUnits: 50 },
  };

  it('is deterministic for the exact effective dispatch input', () => {
    expect(computeRequestFingerprint(base)).toBe(computeRequestFingerprint({ ...base }));
  });

  it.each([
    { ...base, capabilityCode: 'code_build' },
    { ...base, prompt: 'Implement exactly this task.' },
    { ...base, assuranceLevel: 'al-3' },
    { ...base, assuranceLevel: undefined },
    { ...base, budget: { ...base.budget, maxTokens: 1001 } },
  ])('distinguishes semantically different exact inputs', (candidate) => {
    expect(computeRequestFingerprint(candidate)).not.toBe(computeRequestFingerprint(base));
  });

  it('treats omitted and empty budgets as the same effective dispatch budget', () => {
    expect(computeRequestFingerprint({ ...base, budget: undefined })).toBe(
      computeRequestFingerprint({ ...base, budget: {} }),
    );
  });

  it('distinguishes an omitted budget value from an explicit zero', () => {
    expect(
      computeRequestFingerprint({ ...base, budget: { maxCostMinorUnits: undefined } }),
    ).not.toBe(computeRequestFingerprint({ ...base, budget: { maxCostMinorUnits: 0 } }));
  });
});
