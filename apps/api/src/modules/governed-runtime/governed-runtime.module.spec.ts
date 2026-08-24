import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { ProviderType } from '@vito/contracts';
import { AuditService } from '../audit/audit.service';
import { CommonModule } from '../../common/common.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { GovernedRuntimeModule } from './governed-runtime.module';
import { GOVERNED_WORKSPACE_ROOT } from './governed-runtime.module';
import { GovernedRuntimeService } from './governed-runtime.service';

describe('GovernedRuntimeModule (B2c assembly)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? 'postgresql://vito:vito@localhost:5432/vito';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('assembles the governed runtime with a valid absolute workspace root', async () => {
    process.env.GOVERNED_WORKSPACE_ROOT = `/tmp/vito-b2c-module-${randomUUID()}`;

    const moduleRef = await Test.createTestingModule({
      imports: [CommonModule, PrismaModule, GovernedRuntimeModule],
    })
      .useMocker((token) => {
        if (token === AuditService) {
          return { record: jest.fn().mockResolvedValue({}) };
        }
        return undefined;
      })
      .compile();

    const service = moduleRef.get(GovernedRuntimeService);
    expect(service).toBeDefined();

    const registry = moduleRef.get('GOVERNED_ADAPTER_REGISTRY');
    expect(registry.has(ProviderType.DETERMINISTIC_TOOL)).toBe(true);

    const root = moduleRef.get<string>(GOVERNED_WORKSPACE_ROOT);
    expect(root).toBe(process.env.GOVERNED_WORKSPACE_ROOT);
  });

  it('fails startup closed when GOVERNED_WORKSPACE_ROOT is missing', async () => {
    delete process.env.GOVERNED_WORKSPACE_ROOT;

    await expect(
      Test.createTestingModule({ imports: [GovernedRuntimeModule] }).compile(),
    ).rejects.toThrow(/GOVERNED_WORKSPACE_ROOT_INVALID/);
  });

  it('fails startup closed when GOVERNED_WORKSPACE_ROOT is not absolute', async () => {
    process.env.GOVERNED_WORKSPACE_ROOT = 'relative/unsafe/path';

    await expect(
      Test.createTestingModule({ imports: [GovernedRuntimeModule] }).compile(),
    ).rejects.toThrow(/GOVERNED_WORKSPACE_ROOT_INVALID/);
  });
});
