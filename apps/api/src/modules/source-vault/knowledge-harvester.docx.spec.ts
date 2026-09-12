import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { KnowledgeHarvesterService, segmentDocxParagraphs } from './knowledge-harvester.service';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

function createStoredZip(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const localArea = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localArea.length, 16);
  return Buffer.concat([localArea, centralDirectory, eocd]);
}

describe('KnowledgeHarvesterService DOCX', () => {
  it('preserves paragraph provenance while segmenting DOCX evidence', () => {
    const units = segmentDocxParagraphs([
      { index: 1, locatorValue: 'paragraph:1', text: 'Care evidence one.' },
      { index: 2, locatorValue: 'paragraph:2', text: 'Care evidence two.' },
    ]);
    expect(units).toEqual([
      expect.objectContaining({ content: 'Care evidence one.', locatorValue: 'paragraph:1' }),
      expect.objectContaining({ content: 'Care evidence two.', locatorValue: 'paragraph:2' }),
    ]);
    expect(units.every((unit) => unit.contentSha256.length === 64)).toBe(true);
  });

  it('harvests verified DOCX main-document paragraphs into provenance-backed knowledge units', async () => {
    const documentXml = `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>Pflege evidence alpha.</w:t></w:r></w:p><w:p><w:r><w:t>Pflege evidence beta.</w:t></w:r></w:p></w:body></w:document>`;
    const buffer = createStoredZip({ 'word/document.xml': documentXml });
    const findFirst = jest.fn().mockResolvedValue({
      id: 'source-pk-docx',
      sourceId: 'SRC-DOCX-1',
      sourceType: 'DOCUMENT',
      originalFilename: 'pflegewissen.docx',
      mimeType: DOCX_MIME,
      storageUri: 'local://docx-1',
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

    const result = await service.harvestDocxSource('org-1', 'source-pk-docx');

    expect(storage.get).toHaveBeenCalledWith('local://docx-1');
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'source-pk-docx' } }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1',
      action: 'SOURCE_KNOWLEDGE_HARVESTED',
      entityId: 'source-pk-docx',
      metadata: expect.objectContaining({ sourceFormat: 'DOCX', unitCount: 2 }),
    }), tx);
    expect(result).toEqual(expect.objectContaining({
      sourceId: 'SRC-DOCX-1',
      knowledgeUnits: 2,
      sourceFormat: 'DOCX',
      paragraphsExtracted: 2,
      semanticEnrichment: false,
    }));
  });

  it('rejects MIME spoofing instead of parsing arbitrary files as DOCX', async () => {
    const prisma = { source: { findFirst: jest.fn().mockResolvedValue({
      id: 'source-pk-docx', sourceId: 'SRC-DOCX-1', sourceType: 'DOCUMENT',
      originalFilename: 'pflegewissen.docx', mimeType: 'application/octet-stream',
      storageUri: 'local://docx-1', sha256: '0'.repeat(64), metadata: {},
    }) } };
    const service = new KnowledgeHarvesterService(
      prisma as any,
      { record: jest.fn() } as any,
      { get: jest.fn() } as any,
    );
    await expect(service.harvestDocxSource('org-1', 'source-pk-docx')).rejects.toBeInstanceOf(BadRequestException);
  });
});
