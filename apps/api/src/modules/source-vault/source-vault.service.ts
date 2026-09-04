import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SourceValidationStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LinkKnowledgeSourceDto } from './dto/link-knowledge-source.dto';
import { RegisterSourceDto } from './dto/register-source.dto';
import { UploadSourceDto } from './dto/upload-source.dto';
import { sha256Hex } from './source-hash';
import { ObjectStoragePort } from './storage/object-storage.port';

export interface UploadedSourceFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class SourceVaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly objectStorage: ObjectStoragePort,
  ) {}

  private createHumanSourceId(): string {
    const year = new Date().getUTCFullYear();
    return `SRC-${year}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }

  private toApi<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, currentValue) =>
        typeof currentValue === 'bigint' ? currentValue.toString() : currentValue,
      ),
    ) as T;
  }

  async ingestUpload(organizationId: string, file: UploadedSourceFile, dto: UploadSourceDto) {
    const sha256 = sha256Hex(file.buffer);
    const duplicate = await this.prisma.source.findUnique({
      where: { organizationId_sha256: { organizationId, sha256 } },
    });

    if (duplicate) {
      return this.toApi({ duplicate: true, source: duplicate });
    }

    const humanSourceId = this.createHumanSourceId();
    let storageUri: string | undefined;

    try {
      const stored = await this.objectStorage.putImmutable({
        organizationId,
        sourceId: humanSourceId,
        filename: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        body: file.buffer,
        metadata: { sha256 },
      });
      storageUri = stored.storageUri;

      const registerDto: RegisterSourceDto = {
        sourceType: dto.sourceType,
        originalFilename: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        byteSize: file.size,
        sha256,
        storageUri,
        ingestedBy: dto.ingestedBy,
        projectKey: dto.projectKey,
        domain: dto.domain,
        language: dto.language,
        title: dto.title,
        author: dto.author,
        sourceDate: dto.sourceDate,
        confidentiality: dto.confidentiality,
        rightsStatus: dto.rightsStatus,
        retentionClass: dto.retentionClass,
        supersedesSourceId: dto.supersedesSourceId,
        parentSourceId: dto.parentSourceId,
        ingestionStatus: 'STORED',
        extractionStatus: 'NOT_STARTED',
        validationStatus: 'UNREVIEWED',
        metadata: { upload: { storageByteSize: stored.byteSize, etag: stored.etag ?? null } },
      };

      const result = await this.register(organizationId, registerDto, humanSourceId);
      if (result.duplicate && storageUri) {
        await this.objectStorage.delete(storageUri);
      }
      return result;
    } catch (error) {
      if (storageUri) {
        await this.objectStorage.delete(storageUri).catch(() => undefined);
      }
      throw error;
    }
  }

  async register(organizationId: string, dto: RegisterSourceDto, sourceIdOverride?: string) {
    const normalizedHash = dto.sha256.toLowerCase();

    const duplicate = await this.prisma.source.findUnique({
      where: { organizationId_sha256: { organizationId, sha256: normalizedHash } },
    });

    if (duplicate) {
      return this.toApi({ duplicate: true, source: duplicate });
    }

    let version = 1;
    if (dto.supersedesSourceId) {
      const previous = await this.prisma.source.findFirst({
        where: { id: dto.supersedesSourceId, organizationId },
      });
      if (!previous) {
        throw new NotFoundException('Die angegebene Vorgänger-Source wurde in dieser Organization nicht gefunden.');
      }
      version = previous.version + 1;
    }

    if (dto.parentSourceId) {
      const parent = await this.prisma.source.findFirst({
        where: { id: dto.parentSourceId, organizationId },
        select: { id: true },
      });
      if (!parent) {
        throw new NotFoundException('Die angegebene Parent-Source wurde in dieser Organization nicht gefunden.');
      }
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const source = await tx.source.create({
          data: {
            sourceId: sourceIdOverride ?? this.createHumanSourceId(),
            organizationId,
            projectKey: dto.projectKey,
            domain: dto.domain,
            sourceType: dto.sourceType,
            originalFilename: dto.originalFilename,
            mimeType: dto.mimeType,
            byteSize: BigInt(dto.byteSize),
            sha256: normalizedHash,
            storageUri: dto.storageUri,
            version,
            supersedesSourceId: dto.supersedesSourceId,
            parentSourceId: dto.parentSourceId,
            language: dto.language,
            title: dto.title,
            author: dto.author,
            sourceDate: dto.sourceDate ? new Date(dto.sourceDate) : undefined,
            ingestedBy: dto.ingestedBy,
            confidentiality: dto.confidentiality,
            rightsStatus: dto.rightsStatus,
            retentionClass: dto.retentionClass,
            ingestionStatus: dto.ingestionStatus ?? 'STORED',
            extractionStatus: dto.extractionStatus,
            validationStatus: dto.validationStatus,
            metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
          },
        });

        if (dto.supersedesSourceId) {
          await tx.source.update({
            where: { id: dto.supersedesSourceId },
            data: { validationStatus: SourceValidationStatus.SUPERSEDED },
          });
        }

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'SOURCE_REGISTERED',
            entityType: 'Source',
            entityId: source.id,
            metadata: {
              sourceId: source.sourceId,
              sha256: source.sha256,
              sourceType: source.sourceType,
              version: source.version,
              projectKey: source.projectKey,
              storageUri: source.storageUri,
            },
          },
          tx,
        );

        return { duplicate: false, source };
      });

      return this.toApi(result);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicateAfterRace = await this.prisma.source.findUnique({
          where: { organizationId_sha256: { organizationId, sha256: normalizedHash } },
        });
        if (duplicateAfterRace) {
          return this.toApi({ duplicate: true, source: duplicateAfterRace });
        }
        throw new ConflictException('Die Source konnte wegen einer konkurrierenden Registrierung nicht registriert werden.');
      }
      throw error;
    }
  }

  async getContent(organizationId: string, id: string) {
    const source = await this.prisma.source.findFirst({
      where: { id, organizationId },
      select: { id: true, sourceId: true, originalFilename: true, mimeType: true, storageUri: true, sha256: true },
    });
    if (!source) throw new NotFoundException('Source nicht gefunden.');

    const exists = await this.objectStorage.exists(source.storageUri);
    if (!exists) throw new NotFoundException('Das Originalobjekt der Source ist im Storage nicht verfügbar.');

    const buffer = await this.objectStorage.get(source.storageUri);
    const actualHash = sha256Hex(buffer);
    if (actualHash !== source.sha256) {
      throw new ConflictException('Integritätsprüfung fehlgeschlagen: Stored Object stimmt nicht mit dem registrierten SHA-256 überein.');
    }

    return { source, buffer };
  }

  async findAll(organizationId: string) {
    const sources = await this.prisma.source.findMany({
      where: { organizationId },
      orderBy: { ingestedAt: 'desc' },
      include: { knowledgeLinks: true },
    });
    return this.toApi(sources);
  }

  async findByIdOrFail(organizationId: string, id: string) {
    const source = await this.prisma.source.findFirst({
      where: { id, organizationId },
      include: {
        knowledgeLinks: true,
        supersedes: true,
        supersededBy: true,
        parent: true,
        children: true,
      },
    });

    if (!source) {
      throw new NotFoundException('Source nicht gefunden.');
    }

    return this.toApi(source);
  }

  async findDuplicate(organizationId: string, sha256: string) {
    const normalizedHash = sha256.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedHash)) {
      return { duplicate: false, source: null };
    }

    const source = await this.prisma.source.findUnique({
      where: { organizationId_sha256: { organizationId, sha256: normalizedHash } },
    });

    return this.toApi({ duplicate: Boolean(source), source });
  }

  async lineage(organizationId: string, id: string) {
    const current = await this.prisma.source.findFirst({
      where: { id, organizationId },
      select: { id: true, sourceId: true, version: true, sha256: true, supersedesSourceId: true },
    });

    if (!current) {
      throw new NotFoundException('Source nicht gefunden.');
    }

    const previous: Array<{ id: string; sourceId: string; version: number; sha256: string }> = [];
    const seen = new Set<string>();
    let cursorId = current.supersedesSourceId;

    while (cursorId && !seen.has(cursorId)) {
      seen.add(cursorId);
      const item = await this.prisma.source.findFirst({
        where: { id: cursorId, organizationId },
        select: { id: true, sourceId: true, version: true, sha256: true, supersedesSourceId: true },
      });
      if (!item) break;
      previous.push({ id: item.id, sourceId: item.sourceId, version: item.version, sha256: item.sha256 });
      cursorId = item.supersedesSourceId;
    }

    const later = await this.prisma.source.findMany({
      where: { organizationId, supersedesSourceId: id },
      select: { id: true, sourceId: true, version: true, sha256: true },
      orderBy: { version: 'asc' },
    });

    return { current, previous, later };
  }

  async linkKnowledge(organizationId: string, sourceId: string, dto: LinkKnowledgeSourceDto) {
    const exists = await this.prisma.source.findFirst({
      where: { id: sourceId, organizationId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Source nicht gefunden.');
    }

    return this.prisma.$transaction(async (tx) => {
      const link = await tx.knowledgeSourceLink.create({
        data: {
          organizationId,
          sourceId,
          knowledgeRef: dto.knowledgeRef,
          locatorType: dto.locatorType,
          locatorValue: dto.locatorValue,
          derivationType: dto.derivationType,
          confidence: dto.confidence,
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });

      await this.auditService.record(
        {
          organizationId,
          actorType: 'SYSTEM',
          action: 'SOURCE_KNOWLEDGE_LINKED',
          entityType: 'KnowledgeSourceLink',
          entityId: link.id,
          metadata: {
            sourceId,
            knowledgeRef: dto.knowledgeRef,
            locatorType: dto.locatorType,
            locatorValue: dto.locatorValue,
            derivationType: dto.derivationType,
          },
        },
        tx,
      );

      return link;
    });
  }
}
