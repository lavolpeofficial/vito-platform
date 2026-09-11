import { BadRequestException } from '@nestjs/common';
import { MemoryService } from './memory.service';

describe('MemoryService', () => {
  const prisma = { $queryRaw: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new MemoryService(prisma as any, audit as any);

  beforeEach(() => jest.clearAllMocks());

  it('rejects scoped memory without an explicit scope id', async () => {
    await expect(service.record('org-1', {
      kind: 'EPISODIC',
      scope: 'AGENT',
      scopeId: null,
      title: 'Observed execution',
      content: 'A persisted observation.',
      sourceType: 'EXPERIENCE',
      sourceRef: 'exp-1',
      confidence: null,
      metadata: {},
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('does not allow organization-global memory to masquerade as a narrower scope', async () => {
    await expect(service.record('org-1', {
      kind: 'ORGANIZATIONAL',
      scope: 'ORGANIZATION',
      scopeId: 'other-org',
      title: 'Policy',
      content: 'A governed policy memory.',
      sourceType: 'USER_CURATED',
      sourceRef: null,
      confidence: null,
      metadata: {},
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bounds runtime retrieval to global, organization, agent and workflow scopes', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await service.retrieveRuntimeContext('org-1', 'release verification', 'agent-1', 'run-1');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
