import { extractXlsxStructure } from './xlsx-extractor';

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
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localArea = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localArea.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localArea, centralDirectory, eocd]);
}

describe('extractXlsxStructure', () => {
  it('extracts sheet, native formulas and formula-like shared strings', () => {
    const workbook = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Vorlage" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const rels = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
    const sharedStrings = `<?xml version="1.0"?><sst><si><t>=GPT(A1)</t></si><si><t>normal</t></si></sst>`;
    const sheet = `<?xml version="1.0"?><worksheet><dimension ref="A1:D5"/><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>A1*2</f><v>2</v></c><c r="C1" t="s"><v>0</v></c><c r="D1" t="s"><v>1</v></c></row></sheetData></worksheet>`;

    const zip = createStoredZip({
      'xl/workbook.xml': workbook,
      'xl/_rels/workbook.xml.rels': rels,
      'xl/sharedStrings.xml': sharedStrings,
      'xl/worksheets/sheet1.xml': sheet,
    });

    expect(extractXlsxStructure(zip)).toEqual({
      format: 'xlsx',
      adapter: 'vito-openxml-lite',
      adapterVersion: '0.1.0',
      sheets: [
        {
          name: 'Vorlage',
          path: 'xl/worksheets/sheet1.xml',
          dimension: 'A1:D5',
          cellCount: 4,
          formulaCount: 2,
          nativeFormulaCount: 1,
          formulaLikeStringCount: 1,
          formulaCells: ['B1', 'C1'],
        },
      ],
      totals: { sheets: 1, cells: 4, formulas: 2, nativeFormulas: 1, formulaLikeStrings: 1 },
    });
  });
});
