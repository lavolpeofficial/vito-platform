import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { extractDocxText, type DocxParagraph } from './extraction/docx-extractor';
import { extractXlsxKnowledgeRows, type XlsxKnowledgeRow } from './extraction/xlsx-knowledge-extractor';
import { sha256Hex } from './source-hash';
import { ObjectStoragePort } from './storage/object-storage.port';

const MAX_SOURCE_BYTES = 1_048_576;
const MAX_DOCX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_XLSX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_CHARS = 524_288;
const MAX_UNIT_CHARS = 3_000;
const MAX_UNITS = 256;
const SEARCH_LIMIT_MAX = 20;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type KnowledgeLocatorType = 'SECTION' | 'CELL_RANGE';

export type HarvestedTextUnit = Readonly<{
  content: string;
  contentSha256: string;
  locatorType: KnowledgeLocatorType;
  locatorValue: string;
}>;

type KnowledgeSearchRow = {
  id: string;
  sourceId: string;
  sourcePublicId: string;
  unitType: string;
  content: string;
  locatorType: string | null;
  locatorValue: string | null;
  derivationType: string;
  confidence: number | null;
  rank: number;
};

export function segmentHarvestText(input: string): readonly HarvestedTextUnit[] {
  const normalized = input.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return Object.freeze([]);
  if (normalized.length > MAX_TOTAL_CHARS) {
    throw new PayloadTooLargeException(`Harvest text exceeds ${MAX_TOTAL_CHARS} characters.`);
  }

  const units: HarvestedTextUnit[] = [];
  const blocks = normalized.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  for (const block of blocks) {
    appendBoundedUnitChunks(units, block, 'SECTION', `section:${units.length + 1}`);
  }
  return Object.freeze(units);
}

export function segmentDocxParagraphs(paragraphs: readonly DocxParagraph[]): readonly HarvestedTextUnit[] {
  const units: HarvestedTextUnit[] = [];
  let totalChars = 0;
  for (const paragraph of paragraphs) {
    totalChars += paragraph.text.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      throw new PayloadTooLargeException(`Harvest text exceeds ${MAX_TOTAL_CHARS} characters.`);
    }
    appendBoundedUnitChunks(units, paragraph.text, 'SECTION', paragraph.locatorValue);
  }
  return Object.freeze(units);
}

export function segmentXlsxRows(rows: readonly XlsxKnowledgeRow[]): readonly HarvestedTextUnit[] {
  const units: HarvestedTextUnit[] = [];
  let totalChars = 0;
  for (const row of rows) {
    totalChars += row.text.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      throw new PayloadTooLargeException(`Harvest text exceeds ${MAX_TOTAL_CHARS} characters.`);
    }
    appendBoundedUnitChunks(units, row.text, 'CELL_RANGE', row.cellRange);
  }
  return Object.freeze(units);
}

function appendBoundedUnitChunks(
  units: HarvestedTextUnit[],
  input: string,
  locatorType: KnowledgeLocatorType,
  locator: string,
): void {
  const value = input.trim();
  if (!value) return;
  let part = 0;
  for (let offset = 0; offset < value.length; offset += MAX_UNIT_CHARS) {
    const content = value.slice(offset, offset + MAX_UNIT_CHARS).trim();
    if (!content) continue;
    if (units.length >= MAX_UNITS) {
      throw new PayloadTooLargeException(`Harvest exceeds ${MAX_UNITS} knowledge units.`);
    }
    part += 1;
    units.push(Object.freeze({
      content,
      contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      locatorType,
      locatorValue: part === 1 && value.length <= MAX_UNIT_CHARS ? locator : `${locator}:part:${part}`,
    }));
  }
}

@Injectable()
export class KnowledgeHarvesterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly objectStorage: ObjectStoragePort,
  ) {}

  async harvestTextSource(organizationId: string, sourcePk: string) {
    const source = await this.prisma.source.findFirst({
      where: { id: sourcePk, organizationId },
      select: { id: true, sourceId: true, mimeType: true, storageUri: true, sha256: true, metadata: true },
    });
    if (!source) throw new NotFoundException('Source not found.');
    if (!this.isSupportedTextMime(source.mimeType)) {
      throw new BadRequestException(`Knowledge Harvester v1 does not support MIME type ${source.mimeType}.`);
    }

    const buffer = await this.objectStorage.get(source.storageUri);
    if (buffer.byteLength > MAX_SOURCE_BYTES) {
      throw new PayloadTooLargeException(`Source exceeds ${MAX_SOURCE_BYTES} bytes for Knowledge Harvester v1.`);
    }
    this.assertSourceHash(buffer, source.sha256, 'harvest');
    const units = segmentHarvestText(this.decodeText(buffer, source.mimeType));
    if (units.length === 0) throw new BadRequestException('Source contains no harvestable text.');

    const unitCount = await this.persistUnits({
      organizationId, source, units, harvester: 'vito-knowledge-harvester', version: '1', sourceFormat: 'TEXT',
    });
    return Object.freeze({ sourceId: source.sourceId, knowledgeUnits: unitCount, unitType: 'TEXT_FRAGMENT' as const, semanticEnrichment: false });
  }

  async harvestDocxSource(organizationId: string, sourcePk: string) {
    const source = await this.prisma.source.findFirst({
      where: { id: sourcePk, organizationId },
      select: { id: true, sourceId: true, sourceType: true, originalFilename: true, mimeType: true, storageUri: true, sha256: true, metadata: true },
    });
    if (!source) throw new NotFoundException('Source not found.');
    const mime = this.normalizedMime(source.mimeType);
    if (source.sourceType !== 'DOCUMENT' || mime !== DOCX_MIME || !source.originalFilename.toLowerCase().endsWith('.docx')) {
      throw new BadRequestException('DOCX harvester accepts only DOCUMENT sources registered as .docx OpenXML documents.');
    }

    const buffer = await this.objectStorage.get(source.storageUri);
    if (buffer.byteLength > MAX_DOCX_SOURCE_BYTES) throw new PayloadTooLargeException(`DOCX source exceeds ${MAX_DOCX_SOURCE_BYTES} bytes.`);
    this.assertSourceHash(buffer, source.sha256, 'DOCX harvest');
    const extraction = extractDocxText(buffer);
    const units = segmentDocxParagraphs(extraction.paragraphs);
    if (units.length === 0) throw new BadRequestException('DOCX contains no harvestable text.');

    const unitCount = await this.persistUnits({
      organizationId, source, units, harvester: 'vito-docx-knowledge-harvester', version: '1', sourceFormat: 'DOCX',
      extractionMetadata: {
        adapter: extraction.adapter, adapterVersion: extraction.adapterVersion, includedParts: extraction.includedParts,
        paragraphs: extraction.totals.paragraphs, characters: extraction.totals.characters,
      },
    });
    return Object.freeze({
      sourceId: source.sourceId, knowledgeUnits: unitCount, unitType: 'TEXT_FRAGMENT' as const,
      sourceFormat: 'DOCX' as const, paragraphsExtracted: extraction.totals.paragraphs, semanticEnrichment: false,
    });
  }

  async harvestXlsxSource(organizationId: string, sourcePk: string) {
    const source = await this.prisma.source.findFirst({
      where: { id: sourcePk, organizationId },
      select: { id: true, sourceId: true, sourceType: true, originalFilename: true, mimeType: true, storageUri: true, sha256: true, metadata: true },
    });
    if (!source) throw new NotFoundException('Source not found.');
    const mime = this.normalizedMime(source.mimeType);
    if (source.sourceType !== 'SPREADSHEET' || mime !== XLSX_MIME || !source.originalFilename.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('XLSX harvester accepts only SPREADSHEET sources registered as .xlsx OpenXML workbooks.');
    }

    const buffer = await this.objectStorage.get(source.storageUri);
    if (buffer.byteLength > MAX_XLSX_SOURCE_BYTES) throw new PayloadTooLargeException(`XLSX source exceeds ${MAX_XLSX_SOURCE_BYTES} bytes.`);
    this.assertSourceHash(buffer, source.sha256, 'XLSX harvest');
    const extraction = extractXlsxKnowledgeRows(buffer);
    const units = segmentXlsxRows(extraction.rows);
    if (units.length === 0) throw new BadRequestException('XLSX contains no harvestable cell values.');

    const unitCount = await this.persistUnits({
      organizationId, source, units, harvester: 'vito-xlsx-knowledge-harvester', version: '1', sourceFormat: 'XLSX',
      extractionMetadata: {
        adapter: extraction.adapter, adapterVersion: extraction.adapterVersion, sheets: extraction.totals.sheets,
        rows: extraction.totals.rows, cells: extraction.totals.cells, characters: extraction.totals.characters,
        formulaEvaluation: 'NOT_PERFORMED',
      },
    });
    return Object.freeze({
      sourceId: source.sourceId, knowledgeUnits: unitCount, unitType: 'TEXT_FRAGMENT' as const,
      sourceFormat: 'XLSX' as const, rowsExtracted: extraction.totals.rows, cellsExtracted: extraction.totals.cells,
      formulaEvaluation: false, semanticEnrichment: false,
    });
  }

  async search(organizationId: string, query: string, requestedLimit?: number) {
    const normalized = query.trim();
    if (!normalized) throw new BadRequestException('Knowledge search query is required.');
    const limit = Math.min(Math.max(requestedLimit ?? 8, 1), SEARCH_LIMIT_MAX);
    const rows = await this.prisma.$queryRaw<KnowledgeSearchRow[]>(Prisma.sql`
      SELECT ku."id", ku."sourceId", s."sourceId" AS "sourcePublicId", ku."unitType", ku."content",
        ku."locatorType"::text AS "locatorType", ku."locatorValue", ku."derivationType"::text AS "derivationType",
        ku."confidence", ts_rank(ku."searchVector", websearch_to_tsquery('simple', ${normalized})) AS rank
      FROM "knowledge_units" ku
      JOIN "sources" s ON s."id" = ku."sourceId" AND s."organizationId" = ku."organizationId"
      WHERE ku."organizationId" = ${organizationId} AND ku."searchVector" @@ websearch_to_tsquery('simple', ${normalized})
      ORDER BY rank DESC, ku."createdAt" ASC, ku."id" ASC LIMIT ${limit}
    `);
    return Object.freeze(rows.map((row) => Object.freeze(row)));
  }

  private async persistUnits(input: {
    organizationId: string;
    source: { id: string; sourceId: string; metadata: unknown };
    units: readonly HarvestedTextUnit[];
    harvester: string;
    version: string;
    sourceFormat: 'TEXT' | 'DOCX' | 'XLSX';
    extractionMetadata?: Record<string, unknown>;
  }): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      for (const unit of input.units) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "knowledge_units" (
            "id", "organizationId", "sourceId", "unitType", "content", "contentSha256",
            "locatorType", "locatorValue", "derivationType", "confidence", "metadata"
          ) VALUES (
            ${randomUUID()}, ${input.organizationId}, ${input.source.id}, 'TEXT_FRAGMENT', ${unit.content}, ${unit.contentSha256},
            CAST(${unit.locatorType} AS "SourceLocatorType"), ${unit.locatorValue}, CAST('EXTRACTION' AS "SourceDerivationType"), NULL,
            ${JSON.stringify({ harvester: input.harvester, version: input.version, sourceFormat: input.sourceFormat })}::jsonb
          )
          ON CONFLICT ("organizationId", "sourceId", "contentSha256") DO UPDATE SET
            "locatorType" = EXCLUDED."locatorType", "locatorValue" = EXCLUDED."locatorValue", "metadata" = EXCLUDED."metadata"
        `);
      }

      const rows = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM "knowledge_units"
        WHERE "organizationId" = ${input.organizationId} AND "sourceId" = ${input.source.id}
      `);
      const unitCount = Number(rows[0]?.count ?? 0n);
      const previousMetadata = input.source.metadata && typeof input.source.metadata === 'object' && !Array.isArray(input.source.metadata)
        ? input.source.metadata as Record<string, unknown> : {};
      const metadata = JSON.parse(JSON.stringify({
        ...previousMetadata,
        harvest: {
          harvester: input.harvester, version: input.version, sourceFormat: input.sourceFormat,
          unitType: 'TEXT_FRAGMENT', unitCount, semanticEnrichment: 'NOT_PERFORMED',
          ...(input.extractionMetadata ? { extraction: input.extractionMetadata } : {}),
        },
      })) as Prisma.InputJsonValue;

      await tx.source.update({ where: { id: input.source.id }, data: { metadata } });
      await this.auditService.record({
        organizationId: input.organizationId, actorType: 'SYSTEM', action: 'SOURCE_KNOWLEDGE_HARVESTED',
        entityType: 'Source', entityId: input.source.id,
        metadata: { sourceId: input.source.sourceId, sourceFormat: input.sourceFormat, unitCount, unitType: 'TEXT_FRAGMENT', semanticEnrichment: false },
      }, tx);
      return unitCount;
    });
  }

  private assertSourceHash(buffer: Buffer, expectedHash: string, operation: string): void {
    if (sha256Hex(buffer) !== expectedHash) throw new BadRequestException(`Source integrity verification failed before ${operation}.`);
  }

  private normalizedMime(mimeType: string): string {
    return mimeType.toLowerCase().split(';', 1)[0].trim();
  }

  private isSupportedTextMime(mimeType: string): boolean {
    const normalized = this.normalizedMime(mimeType);
    return normalized.startsWith('text/') || ['application/json', 'application/ld+json', 'application/xml'].includes(normalized);
  }

  private decodeText(buffer: Buffer, mimeType: string): string {
    const normalized = this.normalizedMime(mimeType);
    const raw = buffer.toString('utf8');
    if (normalized === 'application/json' || normalized === 'application/ld+json') {
      try { return JSON.stringify(JSON.parse(raw), null, 2); }
      catch { throw new BadRequestException('JSON source is not valid JSON.'); }
    }
    return raw;
  }
}
