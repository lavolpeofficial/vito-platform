import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SourceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KnowledgeHarvesterService } from './knowledge-harvester.service';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PDF_MIME = 'application/pdf';

export type KnowledgeHarvesterKind = 'TEXT' | 'DOCX' | 'XLSX' | 'PPTX' | 'PDF';

export type HarvestDispatchSource = Readonly<{
  sourceType: SourceType;
  originalFilename: string;
  mimeType: string;
}>;

export function resolveKnowledgeHarvester(source: HarvestDispatchSource): KnowledgeHarvesterKind {
  const mime = source.mimeType.toLowerCase().split(';', 1)[0].trim();
  const filename = source.originalFilename.toLowerCase();

  if (source.sourceType === SourceType.DOCUMENT && mime === DOCX_MIME && filename.endsWith('.docx')) {
    return 'DOCX';
  }
  if (source.sourceType === SourceType.SPREADSHEET && mime === XLSX_MIME && filename.endsWith('.xlsx')) {
    return 'XLSX';
  }
  if (source.sourceType === SourceType.PRESENTATION && mime === PPTX_MIME && filename.endsWith('.pptx')) {
    return 'PPTX';
  }
  if (source.sourceType === SourceType.DOCUMENT && mime === PDF_MIME && filename.endsWith('.pdf')) {
    return 'PDF';
  }
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/ld+json' ||
    mime === 'application/xml'
  ) {
    return 'TEXT';
  }

  throw new BadRequestException(
    `No governed knowledge harvester is available for sourceType=${source.sourceType}, mimeType=${mime}.`,
  );
}

@Injectable()
export class KnowledgeHarvestDispatcherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly harvester: KnowledgeHarvesterService,
  ) {}

  async harvestSource(organizationId: string, sourcePk: string) {
    const source = await this.prisma.source.findFirst({
      where: { id: sourcePk, organizationId },
      select: { sourceType: true, originalFilename: true, mimeType: true },
    });
    if (!source) throw new NotFoundException('Source not found.');

    const selected = resolveKnowledgeHarvester(source);
    if (selected === 'DOCX') return this.harvester.harvestDocxSource(organizationId, sourcePk);
    if (selected === 'XLSX') return this.harvester.harvestXlsxSource(organizationId, sourcePk);
    if (selected === 'PPTX') return this.harvester.harvestPptxSource(organizationId, sourcePk);
    if (selected === 'PDF') return this.harvester.harvestPdfSource(organizationId, sourcePk);
    return this.harvester.harvestTextSource(organizationId, sourcePk);
  }
}
