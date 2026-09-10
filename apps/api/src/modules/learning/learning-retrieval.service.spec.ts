import { BadRequestException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { LearningRetrievalRepository } from './learning-retrieval.types';
import { LearningRetrievalService } from './learning-retrieval.service';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function tenant(): TenantContext {
  const context = new TenantContext();
  context.set({ organizationId, userId: null, role: null, authenticationMethod: 'insecure-header' });
  return context;
}

function build() {
  const repository: jest.Mocked<LearningRetrievalRepository> = {
    retrieve: jest.fn().mockResolvedValue([
      {
        kind: 'FAILURE_PATTERN',
        sourceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: 'stale-reuse',
        detail: 'Validate applicability before reuse.',
        maturity: 'ACTIVE',
        confidence: 0.9,
        createdAt: new Date('2026-09-10T21:00:00Z'),
      },
    ]),
  };
  return { service: new LearningRetrievalService(tenant(), repository), repository };
}

describe('LearningRetrievalService', () => {
  it('retrieves prior learning only inside the authenticated organization', async () => {
    const { service, repository } = build();
    const result = await service.retrieve({ query: ' reuse ', agentId: 'agent-1', limit: 10 });
    expect(result).toHaveLength(1);
    expect(repository.retrieve).toHaveBeenCalledWith(organizationId, {
      query: 'reuse',
      agentId: 'agent-1',
      limit: 10,
    });
  });

  it('rejects empty retrieval queries', async () => {
    const { service, repository } = build();
    await expect(service.retrieve({ query: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.retrieve).not.toHaveBeenCalled();
  });

  it('rejects unbounded retrieval requests', async () => {
    const { service, repository } = build();
    await expect(service.retrieve({ query: 'reuse', limit: 51 })).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.retrieve).not.toHaveBeenCalled();
  });
});
