import { createHash } from 'node:crypto';
import { KnowledgeHarvesterService, segmentXlsxRows } from './knowledge-harvester.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name); const d = Buffer.from(content); const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt32LE(d.length, 18); l.writeUInt32LE(d.length, 22); l.writeUInt16LE(n.length, 26); local.push(l, n, d);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42); central.push(c, n);
    offset += l.length + n.length + d.length;
  }
  const la = Buffer.concat(local); const cd = Buffer.concat(central); const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(la.length, 16);
  return Buffer.concat([la, cd, e]);
}

describe('KnowledgeHarvesterService XLSX', () => {
  it('maps spreadsheet rows to CELL_RANGE provenance', () => {
    const units = segmentXlsxRows([{ sheetName: 'Data', rowNumber: 2, cellRange: 'Data!A2:B2', text: 'Sheet "Data" row 2: A2="x" | B2="y"' }]);
    expect(units).toEqual([expect.objectContaining({ locatorType: 'CELL_RANGE', locatorValue: 'Data!A2:B2' })]);
  });

  it('persists verified XLSX row evidence without evaluating formulas', async () => {
    const workbook = `<workbook xmlns:r="urn:r"><sheets><sheet name="Pflege" r:id="rId1"/></sheets></workbook>`;
    const rels = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Score</t></is></c><c r="B1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>`;
    const buffer = zip({ 'xl/workbook.xml': workbook, 'xl/_rels/workbook.xml.rels': rels, 'xl/worksheets/sheet1.xml': sheet });
    const findFirst = jest.fn().mockResolvedValue({
      id: 'source-xlsx', sourceId: 'SRC-XLSX', sourceType: 'SPREADSHEET', originalFilename: 'pflege.xlsx',
      mimeType: XLSX_MIME, storageUri: 'local://xlsx', sha256: sha256(buffer), metadata: {},
    });
    const executeRaw = jest.fn().mockResolvedValue(1); const queryRaw = jest.fn().mockResolvedValue([{ count: 1n }]); const update = jest.fn();
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw, source: { update } };
    const prisma = { source: { findFirst }, $transaction: jest.fn(async (cb: (value: typeof tx) => unknown) => cb(tx)) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) }; const storage = { get: jest.fn().mockResolvedValue(buffer) };
    const service = new KnowledgeHarvesterService(prisma as any, audit as any, storage as any);

    const result = await service.harvestXlsxSource('org-1', 'source-xlsx');

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SOURCE_KNOWLEDGE_HARVESTED', metadata: expect.objectContaining({ sourceFormat: 'XLSX', unitCount: 1 }),
    }), tx);
    expect(result).toEqual(expect.objectContaining({ sourceFormat: 'XLSX', rowsExtracted: 1, cellsExtracted: 2, formulaEvaluation: false }));
  });
});
