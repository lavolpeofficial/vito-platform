import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { extractXlsxStructure } from './extraction/xlsx-extractor';
import { sha256Hex } from './source-hash';
import { ObjectStoragePort } from './storage/object-storage.port';

@Injectable()
export class SourceExtractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly objectStorage: ObjectStoragePort,
  ) {}

  async extractXlsx(organizationId: string, sourcePk: string) {
    const source = await this.prisma.source.findFirst({
      where: { id: sourcePk, organizationId },
      select: {
        id: true,
        sourceId: true,
        sourceType: true,
        originalFilename: true,
        mimeType: true,
        storageUri: true,
        sha256: true,
        metadata: true,
      },
    });

    if (!source) throw new NotFoundException('Source nicht gefunden.');
    if (source.sourceType !== 'SPREADSHEET' || !source.originalFilename.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Der v0.1 XLSX-Adapter akzeptiert ausschließlich als SPREADSHEET registrierte .xlsx-Dateien.');
    }

    await this.prisma.source.update({
      where: { id: source.id },
      data: { extractionStatus: 'PROCESSING' },
    });

    try {
      const buffer = await this.objectStorage.get(source.storageUri);
      const actualHash = sha256Hex(buffer);
      if (actualHash !== source.sha256) {
        throw new ConflictException('Integritätsprüfung vor Extraktion fehlgeschlagen.');
      }

      const envelope = extractXlsxStructure(buffer);
      const previousMetadata =
        source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
          ? (source.metadata as Record<string, unknown>)
          : {};

      // Prisma JSON types are intentionally stricter than ordinary TS objects.
      // SOURCE VAULT extraction envelopes contain only JSON-safe primitives;
      // serialize once here so the persistence boundary is explicit and stable.
      const metadata = JSON.parse(
        JSON.stringify({
          ...previousMetadata,
          extraction: envelope,
        }),
      ) as Prisma.InputJsonValue;

      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.source.update({
          where: { id: source.id },
          data: {
            extractionStatus: 'EXTRACTED',
            metadata,
          },
        });

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'SOURCE_XLSX_EXTRACTED',
            entityType: 'Source',
            entityId: source.id,
            metadata: {
              sourceId: source.sourceId,
              adapter: envelope.adapter,
              adapterVersion: envelope.adapterVersion,
              sheets: envelope.totals.sheets,
              cells: envelope.totals.cells,
              formulas: envelope.totals.formulas,
              nativeFormulas: envelope.totals.nativeFormulas,
              formulaLikeStrings: envelope.totals.formulaLikeStrings,
            },
          },
          tx,
        );

        return updated;
      });

      return { sourceId: source.sourceId, extraction: envelope, status: result.extractionStatus };
    } catch (error) {
      await this.prisma.source
        .update({ where: { id: source.id }, data: { extractionStatus: 'FAILED' } })
        .catch(() => undefined);
      throw error;
    }
  }
}
