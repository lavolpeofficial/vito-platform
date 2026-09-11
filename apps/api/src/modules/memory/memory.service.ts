import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export type MemoryKind = 'EPISODIC' | 'SEMANTIC' | 'PROCEDURAL' | 'ORGANIZATIONAL';
export type MemoryScope = 'GLOBAL' | 'ORGANIZATION' | 'PROJECT' | 'CUSTOMER' | 'AGENT' | 'WORKFLOW';

export interface MemoryEntry {
  id: string;
  organizationId: string;
  kind: MemoryKind;
  scope: MemoryScope;
  scopeId: string | null;
  title: string;
  content: string;
  sourceType: string;
  sourceRef: string | null;
  confidence: number | null;
  status: 'ACTIVE' | 'RETRACTED';
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async record(organizationId: string, input: Omit<MemoryEntry, 'id' | 'organizationId' | 'status' | 'createdAt' | 'updatedAt'>) {
    validateScope(input.scope, input.scopeId);
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});
    const rows = await this.prisma.$queryRaw<MemoryEntry[]>`
      INSERT INTO memory_entries
        ("id","organizationId","kind","scope","scopeId","title","content","sourceType","sourceRef","confidence","metadata")
      VALUES
        (${id}, ${organizationId}, ${input.kind}, ${input.scope}, ${input.scopeId}, ${input.title.trim()}, ${input.content.trim()}, ${input.sourceType.trim()}, ${input.sourceRef ?? null}, ${input.confidence ?? null}, ${metadata}::jsonb)
      RETURNING *
    `;
    const entry = rows[0];
    await this.audit.record({
      organizationId,
      actorType: 'SYSTEM',
      action: 'MEMORY_ENTRY_RECORDED',
      entityType: 'MemoryEntry',
      entityId: entry.id,
      metadata: { kind: entry.kind, scope: entry.scope, scopeId: entry.scopeId, sourceType: entry.sourceType, sourceRef: entry.sourceRef },
    });
    return entry;
  }

  async retract(organizationId: string, id: string) {
    const rows = await this.prisma.$queryRaw<MemoryEntry[]>`
      UPDATE memory_entries SET "status" = 'RETRACTED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      RETURNING *
    `;
    if (!rows[0]) throw new NotFoundException('Memory entry not found.');
    await this.audit.record({ organizationId, actorType: 'SYSTEM', action: 'MEMORY_ENTRY_RETRACTED', entityType: 'MemoryEntry', entityId: id });
    return rows[0];
  }

  async search(organizationId: string, query: string, limit = 8, scopes?: readonly { scope: MemoryScope; scopeId?: string | null }[]) {
    const safeQuery = query.trim().slice(0, 512);
    if (!safeQuery) throw new BadRequestException('query is required.');
    const safeLimit = Math.max(1, Math.min(20, Number.isFinite(limit) ? limit : 8));
    const scopeClauses = scopes?.length
      ? Prisma.sql`AND (${Prisma.join(scopes.map((item) => item.scope === 'GLOBAL' || item.scope === 'ORGANIZATION'
          ? Prisma.sql`("scope" = ${item.scope} AND "scopeId" IS NULL)`
          : Prisma.sql`("scope" = ${item.scope} AND "scopeId" = ${item.scopeId ?? null})`), ' OR ')})`
      : Prisma.empty;

    return this.prisma.$queryRaw<MemoryEntry[]>(Prisma.sql`
      SELECT * FROM memory_entries
      WHERE "organizationId" = ${organizationId}
        AND "status" = 'ACTIVE'
        ${scopeClauses}
        AND to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", '')) @@ plainto_tsquery('simple', ${safeQuery})
      ORDER BY ts_rank(to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", '')), plainto_tsquery('simple', ${safeQuery})) DESC,
               "createdAt" DESC
      LIMIT ${safeLimit}
    `);
  }

  async retrieveRuntimeContext(organizationId: string, query: string, agentId?: string, workflowRunId?: string) {
    const scopes: { scope: MemoryScope; scopeId?: string | null }[] = [
      { scope: 'GLOBAL' },
      { scope: 'ORGANIZATION' },
    ];
    if (agentId) scopes.push({ scope: 'AGENT', scopeId: agentId });
    if (workflowRunId) scopes.push({ scope: 'WORKFLOW', scopeId: workflowRunId });
    return this.search(organizationId, query, 8, scopes);
  }
}

function validateScope(scope: MemoryScope, scopeId: string | null) {
  const unscoped = scope === 'GLOBAL' || scope === 'ORGANIZATION';
  if (unscoped && scopeId) throw new BadRequestException(`${scope} memory must not have scopeId.`);
  if (!unscoped && !scopeId?.trim()) throw new BadRequestException(`${scope} memory requires scopeId.`);
}
