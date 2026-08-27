import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  MAX_OPERATOR_PROMPT_BYTES,
  SubmitOperatorTaskDto,
} from './submit-operator-task.dto';

describe('SubmitOperatorTaskDto', () => {
  const valid = {
    requestId: '0b31931b-aa1c-4570-bc5d-f9cd90b4970e',
    capabilityCode: 'CODE_BUILD',
    prompt: 'Implement the bounded task.',
    assuranceLevel: 'AL-3',
    budget: { maxDurationMs: 1000, maxTokens: 1, maxCostMinorUnits: 0 },
  };

  async function errors(value: Record<string, unknown>) {
    return validate(
      plainToInstance(SubmitOperatorTaskDto, value, { enableImplicitConversion: true }),
    );
  }

  it('accepts the complete bounded request', async () => {
    expect(await errors(valid)).toHaveLength(0);
  });

  it('enforces request UUID, capability, assurance and nested budget bounds', async () => {
    expect(
      await errors({
        ...valid,
        requestId: 'not-a-uuid',
        capabilityCode: '',
        assuranceLevel: 'x'.repeat(65),
        budget: { maxDurationMs: 999, maxTokens: 0, maxCostMinorUnits: -1 },
      }),
    ).not.toHaveLength(0);
  });

  it.each([
    ['requestId', 'not-a-uuid'],
    ['capabilityCode', ''],
    ['capabilityCode', 'x'.repeat(129)],
    ['assuranceLevel', 'x'.repeat(65)],
  ])('independently rejects invalid %s', async (field, value) => {
    expect(await errors({ ...valid, [field]: value })).not.toHaveLength(0);
  });

  it.each([
    ['maxDurationMs', 999],
    ['maxTokens', 0],
    ['maxCostMinorUnits', -1],
  ])('independently rejects budget.%s below its lower bound', async (field, value) => {
    expect(
      await errors({ ...valid, budget: { ...valid.budget, [field]: value } }),
    ).not.toHaveLength(0);
  });

  it('accepts exactly 512 KiB of UTF-8 prompt data', async () => {
    expect(await errors({ ...valid, prompt: 'a'.repeat(MAX_OPERATOR_PROMPT_BYTES) })).toHaveLength(0);
  });

  it('rejects a multibyte prompt over the exact UTF-8 byte boundary', async () => {
    const prompt = `${'a'.repeat(MAX_OPERATOR_PROMPT_BYTES - 1)}é`;
    expect(Buffer.byteLength(prompt, 'utf8')).toBe(MAX_OPERATOR_PROMPT_BYTES + 1);
    expect(await errors({ ...valid, prompt })).not.toHaveLength(0);
  });

  it('rejects whitespace-only prompts', async () => {
    expect(await errors({ ...valid, prompt: '   \n' })).not.toHaveLength(0);
  });

  it.each([
    ['requestId', 1],
    ['capabilityCode', 1],
    ['prompt', 1],
    ['assuranceLevel', 1],
  ])('rejects a non-string %s despite global implicit conversion', async (field, value) => {
    expect(await errors({ ...valid, [field]: value })).not.toHaveLength(0);
  });

  it.each([
    ['maxDurationMs', '1000'],
    ['maxTokens', '1'],
    ['maxCostMinorUnits', '0'],
  ])('rejects a non-numeric budget.%s despite global implicit conversion', async (field, value) => {
    expect(
      await errors({ ...valid, budget: { ...valid.budget, [field]: value } }),
    ).not.toHaveLength(0);
  });

  it.each([
    { maxDurationMs: 3_600_001, maxTokens: 1, maxCostMinorUnits: 0 },
    { maxDurationMs: 1000, maxTokens: 10_000_001, maxCostMinorUnits: 0 },
    { maxDurationMs: 1000, maxTokens: 1, maxCostMinorUnits: 100_000_001 },
  ])('rejects budget values above the approved bounds', async (budget) => {
    expect(await errors({ ...valid, budget })).not.toHaveLength(0);
  });

  it.each(['assuranceLevel', 'budget'])('rejects null for optional field %s', async (field) => {
    expect(await errors({ ...valid, [field]: null })).not.toHaveLength(0);
  });
});
