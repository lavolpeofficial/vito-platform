import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { sha256Hex } from './source-hash';
import { ObjectStoragePort } from './storage/object-storage.port';

const MAX_SOURCE_BYTES = 1_048_576;
const MAX_TOTAL_CHARS = 524_288;
const MAX_UNIT_CHARS = 3_000;
const MAX_UNITS = 256;
const SEARCH_LIMIT_MAX = 20;

export type HarvestedTextUnit = Readonly<{
  content: string;
  contentSha256: string;
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
    for (let offset = 0; offset < block.length; offset += MAX_UNIT_CHARS) {
      const content = block.slice(offset, offset + MAX_UNIT_CHARS).trim();
      if (!content) continue;
      if (units.length >= MAX_UNITS) {
        throw new PayloadTooLargeException(`Harvest exceeds ${MAX_UNITS} knowledge units.`);
      }
      units.push(Object.freeze({
        content,
        contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
        locatorValue: `section:${units.length + 1}`,
      }));
    }
  }
  return Object.freeze(units);
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
      select: {
        id: true,
        sourceId: true,
        mimeType: true,
        storageUri: true,
        sha256: true,
        metadata: true,
      },
    });
    if (!source) throw new NotFoundException('Source not found.');
    if (!this.isSupportedTextMime(source.mimeType)) {
      throw new BadRequestException(`Knowledge Harvester v1 does not support MIME type ${source.mimeType}.`);
    }

    const buffer = await this.objectStorage.get(source.storageUri);
    if (buffer.byteLength > MAX_SOURCE_BYTES) {
      throw new PayloadTooLargeException(`Source exceeds ${MAX_SOURCE_BYTES} bytes for Knowledge Harvester v1.`);
    }
    if (sha256Hex(buffer) !== source.sha256) {
      throw new BadRequestException('Source integrity verification failed before harvest.');
    }

    const text = this.decodeText(buffer, source.mimeType);
    const units = segmentHarvestText(text);
    if (units.length === 0) throw new BadRequestException('Source contains no harvestable text.');

    const result = await this.prisma.$transaction(async (tx) => {
      for (const unit of units) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "knowledge_units" (
            "id", "organizationId", "sourceId", "unitType", "content", "contentSha256",
            "locatorType", "locatorValue", "derivationType", "confidence", "metadata"
          ) VALUES (
            ${randomUUID()}, ${organizationId}, ${source.id}, 'TEXT_FRAGMENT', ${unit.content}, ${unit.contentSha256},
            CAST('SECTION' AS "SourceLocatorType"), ${unit.locatorValue}, CAST('EXTRACTION' AS "SourceDerivationType"), NULL,
            ${JSON.stringify({ harvester: 'vito-knowledge-harvester', version: '1' })}::jsonb
          )
          ON CONFLICT ("organizationId", "sourceId", "contentSha256") DO UPDATE SET
            "locatorType" = EXCLUDED."locatorType",
            "locatorValue" = EXCLUDED."locatorValue",
            "metadata" = EXCLUDED."metadata"
        `);
      }

      const rows = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "knowledge_units"
        WHERE "organizationId" = ${organizationId} AND "sourceId" = ${source.id}
      `);
      const unitCount = Number(rows[0]?.count ?? 0n);
      const previousMetadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
        ? source.metadata as Record<string, unknown>
        : {};
      const metadata = JSON.parse(JSON.stringify({
        ...previousMetadata,
        harvest: {
          harvester: 'vito-knowledge-harvester',
          version: '1',
          unitType: 'TEXT_FRAGMENT',
          unitCount,
          semanticEnrichment: 'NOT_PERFORMED',
        },
      })) as Prisma.InputJsonValue;

      await tx.source.update({ where: { id: source.id }, data: { metadata } });
      await this.auditService.record({
        organizationId,
        actorType: 'SYSTEM',
        action: 'SOURCE_KNOWLEDGE_HARVESTED',
        entityType: 'Source',
        entityId: source.id,
        metadata: {
          sourceId: source.sourceId,
          unitCount,
          unitType: 'TEXT_FRAGMENT',
          semanticEnrichment: false,
        },
      }, tx);
      return unitCount;
    });

    return Object.freeze({
      sourceId: source.sourceId,
      knowledgeUnits: result,
      unitType: 'TEXT_FRAGMENT' as const,
      semanticEnrichment: false,
    });
  }

  async search(organizationId: string, query: string, requestedLimit?: number) {
    const normalized = query.trim();
    if (!normalized) throw new BadRequestException('Knowledge search query is required.');
    const limit = Math.min(Math.max(requestedLimit ?? 8, 1), SEARCH_LIMIT_MAX);
    const rows = await this.prisma.$queryRaw<KnowledgeSearchRow[]>(Prisma.sql`
      SELECT
        ku."id",
        ku."sourceId",
        s."sourceId" AS "sourcePublicId",
        ku."unitType",
        ku."content",
        ku."locatorType"::text AS "locatorType",
        ku."locatorValue",
        ku."derivationType"::text AS "derivationType",
        ku."confidence",
        ts_rank(ku."searchVector", websearch_to_tsquery('simple', ${normalized})) AS rank
      FROM "knowledge_units" ku
      JOIN "sources" s ON s."id" = ku."sourceId" AND s."organizationId" = ku."organizationId"
      WHERE ku."organizationId" = ${organizationId}
        AND ku."searchVector" @@ websearch_to_tsquery('simple', ${normalized})
      ORDER BY rank DESC, ku."createdAt" ASC, ku."id" ASC
      LIMIT ${limit}
    `);
    return Object.freeze(rows.map((row) => Object.freeze(row)));
  }

  private isSupportedTextMime(mimeType: string): boolean {
    const normalized = mimeType.toLowerCase().split(';', 1)[0].trim();
    return normalized.startsWith('text/') || [
      'application/json',
      'application/ld+json',
      'application/xml',
    ].includes(normalized);
  }

  private decodeText(buffer: Buffer, mimeType: string): string {
    const normalized = mimeType.toLowerCase().split(';', 1)[0].trim();
    const raw = buffer.toString('utf8');
    if (normalized === 'application/json' || normalized === 'application/ld+json') {
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        throw new BadRequestException('JSON source is not valid JSON.');
      }
    }
    return raw;
  }
}
