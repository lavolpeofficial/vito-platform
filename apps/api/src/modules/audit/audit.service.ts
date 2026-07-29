import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type AuditActorType = 'USER' | 'DIGITAL_EMPLOYEE' | 'SYSTEM';

export interface RecordAuditEventInput {
  organizationId: string;
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Zentrale, wiederverwendbare Audit-Logik (Architekturregel 6).
 *
 * Alle Module, die audit-relevante Aktionen ausführen, injizieren diesen
 * Service anstatt AuditEvents direkt über Prisma zu schreiben. So bleibt
 * die Erzeugung von AuditEvents an einer Stelle konsistent und AuditEvents
 * können nicht versehentlich über andere Wege verändert werden.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async listForOrganization(organizationId: string) {
    return this.prisma.auditEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
