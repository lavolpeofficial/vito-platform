import { BadRequestException } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { extractPdfKnowledgePages } from './pdf-knowledge-extractor';

jest.mock('pdf-parse', () => ({ PDFParse: jest.fn() }));

const PdfParseMock = PDFParse as unknown as jest.Mock;

describe('extractPdfKnowledgePages', () => {
  beforeEach(() => PdfParseMock.mockReset());

  it('maps parsed pages to bounded PAGE provenance without semantic enrichment', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    PdfParseMock.mockImplementation(() => ({
      getText: jest.fn().mockResolvedValue({
        total: 2,
        pages: [
          { num: 1, text: 'Alpha evidence' },
          { num: 2, text: 'Beta decision' },
        ],
      }),
      destroy,
    }));

    const result = await extractPdfKnowledgePages(Buffer.from('%PDF-test'));
    expect(result).toEqual({
      format: 'pdf', adapter: 'pdf-parse', adapterVersion: '2.4.5',
      pages: [
        { pageNumber: 1, locatorValue: 'page:1', text: 'Alpha evidence' },
        { pageNumber: 2, locatorValue: 'page:2', text: 'Beta decision' },
      ],
      totals: { pages: 2, characters: 27 },
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the parser rejects malformed or unsupported bytes', async () => {
    PdfParseMock.mockImplementation(() => ({
      getText: jest.fn().mockRejectedValue(new Error('invalid pdf')),
      destroy: jest.fn().mockResolvedValue(undefined),
    }));
    await expect(extractPdfKnowledgePages(Buffer.from('not-a-pdf'))).rejects.toBeInstanceOf(BadRequestException);
  });
});
