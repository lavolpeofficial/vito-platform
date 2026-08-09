import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SourceValidationStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LinkKnowledgeSourceDto } from './dto/link-knowledge-source.dto';
import { RegisterSourceDto } from './dto/register-source.dto';

@Injectable()
export class SourceVaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private createHumanSourceId(): string {
    const year = new Date().getUTCFullYear();
    return `SRC-${year}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }

  async register(organizationId: string, dto: RegisterSourceDto) {
    const normalizedHash = dto.sha256.toLowerCase();

    const duplicate = await this.prisma.source.findUnique({
      where: { organizationId_sha256: { organizationId, sha256: normalizedHash } },
    });

    if (duplicate) {
      return { duplicate: true, source: duplicate };
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
      return await this.prisma.$transaction(async (tx) => {
        const source = await tx.source.create({
          data: {
            sourceId: this.createHumanSourceId(),
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
            },
          },
          tx,
        );

        return { duplicate: false, source };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Die Source konnte wegen eines konkurrierenden Duplikats nicht registriert werden.');
      }
      throw error;
    }
  }

  async findAll(organizationId: string) {
    return this.prisma.source.findMany({
      where: { organizationId },
      orderBy: { ingestedAt: 'desc' },
      include: { knowledgeLinks: true },
    });
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

    return source;
  }

  async findDuplicate(organizationId: string, sha256: string) {
    const normalizedHash = sha256.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedHash)) {
      return { duplicate: false, source: null };
    }

    const source = await this.prisma.source.findUnique({
      where: { organizationId_sha256: { organizationId, sha256: normalizedHash } },
    });

    return { duplicate: Boolean(source), source };
  }

  async lineage(organizationId: string, id: string) {
    const current = await this.findByIdOrFail(organizationId, id);
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

    return {
      current: {
        id: current.id,
        sourceId: current.sourceId,
        version: current.version,
        sha256: current.sha256,
      },
      previous,
      later,
    };
  }

  async linkKnowledge(organizationId: string, sourceId: string, dto: LinkKnowledgeSourceDto) {
    await this.findByIdOrFail(organizationId, sourceId);

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
