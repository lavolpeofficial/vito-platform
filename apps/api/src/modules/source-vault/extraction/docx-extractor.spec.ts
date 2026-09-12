import { BadRequestException } from '@nestjs/common';
import { extractDocxText } from './docx-extractor';

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

  const localArea = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localArea.length, 16);
  return Buffer.concat([localArea, centralDirectory, eocd]);
}

describe('extractDocxText', () => {
  it('extracts bounded main-document paragraphs with stable provenance locators', () => {
    const documentXml = `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body>
      <w:p><w:r><w:t>First &amp; governed</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>paragraph</w:t></w:r></w:p>
      <w:p><w:r><w:t>Second</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>line</w:t></w:r></w:p>
    </w:body></w:document>`;
    const docx = createStoredZip({ 'word/document.xml': documentXml });

    expect(extractDocxText(docx)).toEqual({
      format: 'docx',
      adapter: 'vito-openxml-lite',
      adapterVersion: '0.1.0',
      includedParts: ['word/document.xml'],
      paragraphs: [
        { index: 1, locatorValue: 'paragraph:1', text: 'First & governed\tparagraph' },
        { index: 2, locatorValue: 'paragraph:2', text: 'Second\nline' },
      ],
      totals: { paragraphs: 2, characters: 39 },
    });
  });

  it('fails closed when the main document part is absent', () => {
    expect(() => extractDocxText(createStoredZip({ '[Content_Types].xml': '<Types />' })))
      .toThrow(BadRequestException);
  });
});
