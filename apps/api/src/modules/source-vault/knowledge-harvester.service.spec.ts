import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { KnowledgeHarvesterService, segmentHarvestText } from './knowledge-harvester.service';

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

describe('KnowledgeHarvesterService', () => {
  it('segments deterministic source text without inventing semantic claims', () => {
    const units = segmentHarvestText('Alpha evidence.\n\nBeta procedure context.');
    expect(units).toHaveLength(2);
    expect(units[0]).toEqual(expect.objectContaining({ content: 'Alpha evidence.', locatorValue: 'section:1' }));
    expect(units[1]).toEqual(expect.objectContaining({ content: 'Beta procedure context.', locatorValue: 'section:2' }));
    expect(units[0].contentSha256).toHaveLength(64);
  });

  it('rejects unbounded text rather than silently truncating evidence', () => {
    expect(() => segmentHarvestText('x'.repeat(524_289))).toThrow(PayloadTooLargeException);
  });

  it('harvests only verified source bytes and records provenance metadata', async () => {
    const buffer = Buffer.from('First paragraph.\n\nSecond paragraph.', 'utf8');
    const findFirst = jest.fn().mockResolvedValue({
      id: 'source-pk-1',
      sourceId: 'SRC-1',
      mimeType: 'text/plain',
      storageUri: 'local://source-1',
      sha256: sha256(buffer),
      metadata: {},
    });
    const executeRaw = jest.fn().mockResolvedValue(1);
    const queryRaw = jest.fn().mockResolvedValue([{ count: 2n }]);
    const update = jest.fn().mockResolvedValue({});
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw, source: { update } };
    const transaction = jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx));
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const storage = { get: jest.fn().mockResolvedValue(buffer) };
    const prisma = { source: { findFirst }, $transaction: transaction };
    const service = new KnowledgeHarvesterService(prisma as any, audit as any, storage as any);

    const result = await service.harvestTextSource('org-1', 'source-pk-1');

    expect(storage.get).toHaveBeenCalledWith('local://source-1');
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'source-pk-1' } }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', action: 'SOURCE_KNOWLEDGE_HARVESTED', entityId: 'source-pk-1',
    }), tx);
    expect(result).toEqual(expect.objectContaining({
      sourceId: 'SRC-1', knowledgeUnits: 2, unitType: 'TEXT_FRAGMENT', semanticEnrichment: false,
    }));
  });

  it('fails closed when stored bytes no longer match the registered source hash', async () => {
    const buffer = Buffer.from('tampered', 'utf8');
    const prisma = {
      source: { findFirst: jest.fn().mockResolvedValue({
        id: 'source-pk-1', sourceId: 'SRC-1', mimeType: 'text/plain', storageUri: 'local://source-1',
        sha256: '0'.repeat(64), metadata: {},
      }) },
    };
    const service = new KnowledgeHarvesterService(
      prisma as any,
      { record: jest.fn() } as any,
      { get: jest.fn().mockResolvedValue(buffer) } as any,
    );
    await expect(service.harvestTextSource('org-1', 'source-pk-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
