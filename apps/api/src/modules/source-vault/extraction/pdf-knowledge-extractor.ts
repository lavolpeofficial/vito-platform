import { BadRequestException, HttpException, PayloadTooLargeException } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';

const MAX_PAGES = 512;
const MAX_PAGE_CHARS = 24_000;
const MAX_TOTAL_CHARS = 524_288;

export interface PdfKnowledgePage {
  readonly pageNumber: number;
  readonly locatorValue: string;
  readonly text: string;
}

export interface PdfKnowledgeEnvelope {
  readonly format: 'pdf';
  readonly adapter: 'pdf-parse';
  readonly adapterVersion: '2.4.5';
  readonly pages: readonly PdfKnowledgePage[];
  readonly totals: Readonly<{ pages: number; characters: number }>;
}

export async function extractPdfKnowledgePages(buffer: Buffer): Promise<PdfKnowledgeEnvelope> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    if (result.total > MAX_PAGES) {
      throw new PayloadTooLargeException(`PDF exceeds ${MAX_PAGES} pages for knowledge extraction.`);
    }

    const pages: PdfKnowledgePage[] = [];
    let totalCharacters = 0;
    for (const page of result.pages) {
      const text = normalizePageText(page.text);
      if (!text) continue;
      if (text.length > MAX_PAGE_CHARS) {
        throw new PayloadTooLargeException(`PDF page ${page.num} exceeds ${MAX_PAGE_CHARS} extracted characters.`);
      }
      totalCharacters += text.length;
      if (totalCharacters > MAX_TOTAL_CHARS) {
        throw new PayloadTooLargeException(`PDF extracted text exceeds ${MAX_TOTAL_CHARS} characters.`);
      }
      pages.push(Object.freeze({ pageNumber: page.num, locatorValue: `page:${page.num}`, text }));
    }

    if (pages.length === 0) {
      throw new BadRequestException('PDF contains no harvestable text layer. OCR is not performed.');
    }
    return Object.freeze({
      format: 'pdf', adapter: 'pdf-parse', adapterVersion: '2.4.5', pages: Object.freeze(pages),
      totals: Object.freeze({ pages: pages.length, characters: totalCharacters }),
    });
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new BadRequestException('PDF could not be parsed as a supported text-bearing document.');
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function normalizePageText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
