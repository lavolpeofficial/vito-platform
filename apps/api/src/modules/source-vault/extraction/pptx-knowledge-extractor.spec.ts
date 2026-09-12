import { BadRequestException } from '@nestjs/common';
import { extractPptxKnowledgeSlides } from './pptx-knowledge-extractor';

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

describe('extractPptxKnowledgeSlides', () => {
  it('extracts ordered slide text with stable slide provenance', () => {
    const slide1 = `<?xml version="1.0"?><p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:p><a:r><a:t>Welcome &amp; Context</a:t></a:r></a:p><a:p><a:r><a:t>Second point</a:t></a:r></a:p></p:cSld></p:sld>`;
    const slide2 = `<?xml version="1.0"?><p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:p><a:r><a:t>Decision</a:t></a:r></a:p></p:cSld></p:sld>`;
    const pptx = createStoredZip({
      'ppt/slides/slide2.xml': slide2,
      'ppt/slides/slide1.xml': slide1,
    });

    expect(extractPptxKnowledgeSlides(pptx)).toEqual({
      format: 'pptx',
      adapter: 'vito-openxml-lite',
      adapterVersion: '0.1.0',
      slides: [
        { slideNumber: 1, locatorValue: 'slide:1', text: 'Slide 1: Welcome & Context\nSecond point' },
        { slideNumber: 2, locatorValue: 'slide:2', text: 'Slide 2: Decision' },
      ],
      totals: { slides: 2, characters: 57 },
    });
  });

  it('fails closed when no slide parts exist', () => {
    expect(() => extractPptxKnowledgeSlides(createStoredZip({ '[Content_Types].xml': '<Types />' })))
      .toThrow(BadRequestException);
  });
});
