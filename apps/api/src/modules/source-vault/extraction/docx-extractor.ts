import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { decodeOpenXml, openXmlTextEntry, readOpenXmlZipEntries } from './openxml-zip';

const MAX_PARAGRAPHS = 5_000;
const MAX_TOTAL_CHARS = 524_288;
const MAX_PARAGRAPH_CHARS = 12_000;

export interface DocxParagraph {
  readonly index: number;
  readonly locatorValue: string;
  readonly text: string;
}

export interface DocxExtractionEnvelope {
  readonly format: 'docx';
  readonly adapter: 'vito-openxml-lite';
  readonly adapterVersion: '0.1.0';
  readonly includedParts: readonly ['word/document.xml'];
  readonly paragraphs: readonly DocxParagraph[];
  readonly totals: Readonly<{
    paragraphs: number;
    characters: number;
  }>;
}

export function extractDocxText(buffer: Buffer): DocxExtractionEnvelope {
  const entries = readOpenXmlZipEntries(buffer);
  const xml = openXmlTextEntry(buffer, entries, 'word/document.xml');
  const paragraphs: DocxParagraph[] = [];
  let totalCharacters = 0;

  for (const paragraphMatch of xml.matchAll(/<w:p\b[^>]*>(.*?)<\/w:p>/gs)) {
    if (paragraphs.length >= MAX_PARAGRAPHS) {
      throw new PayloadTooLargeException(`DOCX exceeds ${MAX_PARAGRAPHS} paragraphs.`);
    }
    const body = paragraphMatch[1];
    let text = '';
    const tokenPattern = /<w:t\b[^>]*>(.*?)<\/w:t>|<w:tab\b[^>]*\/?\s*>|<w:(?:br|cr)\b[^>]*\/?\s*>/gs;
    for (const token of body.matchAll(tokenPattern)) {
      if (token[1] !== undefined) text += decodeOpenXml(token[1]);
      else if (token[0].startsWith('<w:tab')) text += '\t';
      else text += '\n';
    }
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
    if (!text) continue;
    if (text.length > MAX_PARAGRAPH_CHARS) {
      throw new PayloadTooLargeException(`DOCX paragraph exceeds ${MAX_PARAGRAPH_CHARS} characters.`);
    }
    totalCharacters += text.length;
    if (totalCharacters > MAX_TOTAL_CHARS) {
      throw new PayloadTooLargeException(`DOCX extracted text exceeds ${MAX_TOTAL_CHARS} characters.`);
    }
    const index = paragraphs.length + 1;
    paragraphs.push(Object.freeze({ index, locatorValue: `paragraph:${index}`, text }));
  }

  if (paragraphs.length === 0) {
    throw new BadRequestException('DOCX contains no harvestable main-document text.');
  }

  return Object.freeze({
    format: 'docx',
    adapter: 'vito-openxml-lite',
    adapterVersion: '0.1.0',
    includedParts: Object.freeze(['word/document.xml'] as const),
    paragraphs: Object.freeze(paragraphs),
    totals: Object.freeze({ paragraphs: paragraphs.length, characters: totalCharacters }),
  });
}
