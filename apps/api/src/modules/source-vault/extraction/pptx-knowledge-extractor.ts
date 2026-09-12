import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { decodeOpenXml, readOpenXmlZipEntries, unzipOpenXmlEntry } from './openxml-zip';

const MAX_SLIDES = 256;
const MAX_SLIDE_CHARS = 24_000;
const MAX_TOTAL_CHARS = 524_288;

export interface PptxKnowledgeSlide {
  readonly slideNumber: number;
  readonly locatorValue: string;
  readonly text: string;
}

export interface PptxKnowledgeEnvelope {
  readonly format: 'pptx';
  readonly adapter: 'vito-openxml-lite';
  readonly adapterVersion: '0.1.0';
  readonly slides: readonly PptxKnowledgeSlide[];
  readonly totals: Readonly<{
    slides: number;
    characters: number;
  }>;
}

export function extractPptxKnowledgeSlides(buffer: Buffer): PptxKnowledgeEnvelope {
  const entries = readOpenXmlZipEntries(buffer);
  const slideEntries = [...entries.values()]
    .map((entry) => {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(entry.name);
      return match ? { entry, slideNumber: Number.parseInt(match[1], 10) } : null;
    })
    .filter((value): value is { entry: ReturnType<typeof entries.get> extends infer T ? Exclude<T, undefined> : never; slideNumber: number } => value !== null)
    .sort((a, b) => a.slideNumber - b.slideNumber);

  if (slideEntries.length === 0) {
    throw new BadRequestException('PPTX contains no slide XML parts.');
  }
  if (slideEntries.length > MAX_SLIDES) {
    throw new PayloadTooLargeException(`PPTX exceeds ${MAX_SLIDES} slides for knowledge extraction.`);
  }

  const slides: PptxKnowledgeSlide[] = [];
  let totalCharacters = 0;
  for (const { entry, slideNumber } of slideEntries) {
    const xml = unzipOpenXmlEntry(buffer, entry).toString('utf8');
    const paragraphs: string[] = [];

    for (const paragraphMatch of xml.matchAll(/<a:p\b[^>]*>(.*?)<\/a:p>/gs)) {
      let paragraph = '';
      for (const textMatch of paragraphMatch[1].matchAll(/<a:t\b[^>]*>(.*?)<\/a:t>/gs)) {
        paragraph += decodeOpenXml(textMatch[1]);
      }
      const normalized = paragraph.replace(/\s+/g, ' ').trim();
      if (normalized) paragraphs.push(normalized);
    }

    if (paragraphs.length === 0) continue;
    const text = `Slide ${slideNumber}: ${paragraphs.join('\n')}`;
    if (text.length > MAX_SLIDE_CHARS) {
      throw new PayloadTooLargeException(`PPTX slide ${slideNumber} exceeds ${MAX_SLIDE_CHARS} extracted characters.`);
    }
    totalCharacters += text.length;
    if (totalCharacters > MAX_TOTAL_CHARS) {
      throw new PayloadTooLargeException(`PPTX extracted text exceeds ${MAX_TOTAL_CHARS} characters.`);
    }
    slides.push(Object.freeze({ slideNumber, locatorValue: `slide:${slideNumber}`, text }));
  }

  if (slides.length === 0) {
    throw new BadRequestException('PPTX contains no harvestable slide text.');
  }

  return Object.freeze({
    format: 'pptx',
    adapter: 'vito-openxml-lite',
    adapterVersion: '0.1.0',
    slides: Object.freeze(slides),
    totals: Object.freeze({ slides: slides.length, characters: totalCharacters }),
  });
}
