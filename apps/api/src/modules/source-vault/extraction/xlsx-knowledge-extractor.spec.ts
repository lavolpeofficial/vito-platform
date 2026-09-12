import { extractXlsxKnowledgeRows } from './xlsx-knowledge-extractor';

function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name);
    const d = Buffer.from(content);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt32LE(d.length, 18); l.writeUInt32LE(d.length, 22); l.writeUInt16LE(n.length, 26);
    local.push(l, n, d);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += l.length + n.length + d.length;
  }
  const la = Buffer.concat(local); const cd = Buffer.concat(central); const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(la.length, 16);
  return Buffer.concat([la, cd, e]);
}

describe('extractXlsxKnowledgeRows', () => {
  it('extracts values and formulas without evaluating them', () => {
    const workbook = `<workbook xmlns:r="urn:r"><sheets><sheet name="Pflege" r:id="rId1"/></sheets></workbook>`;
    const rels = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
    const strings = `<sst><si><t>Name</t></si><si><t>Mobilität</t></si></sst>`;
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>7</v></c><c r="B2"><f>A2*2</f><v>14</v></c></row></sheetData></worksheet>`;
    const result = extractXlsxKnowledgeRows(zip({
      'xl/workbook.xml': workbook,
      'xl/_rels/workbook.xml.rels': rels,
      'xl/sharedStrings.xml': strings,
      'xl/worksheets/sheet1.xml': sheet,
    }));
    expect(result.totals).toEqual({ sheets: 1, rows: 2, cells: 4, characters: expect.any(Number) });
    expect(result.rows[0]).toEqual(expect.objectContaining({ sheetName: 'Pflege', rowNumber: 1, cellRange: 'Pflege!A1:B1' }));
    expect(result.rows[0].text).toContain('A1="Name"');
    expect(result.rows[0].text).toContain('B1="Mobilität"');
    expect(result.rows[1].text).toContain('B2[formula="A2*2", cached="14"]');
  });
});
