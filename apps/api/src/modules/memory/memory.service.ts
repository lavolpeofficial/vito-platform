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

const MAX_MEMORY_QUERY_CHARS = 512;
const MAX_MEMORY_QUERY_TERMS = 16;
const MIN_MEMORY_QUERY_TERM_CHARS = 3;

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
    const safeQuery = query.trim().slice(0, MAX_MEMORY_QUERY_CHARS);
    if (!safeQuery) throw new BadRequestException('query is required.');
    const lexicalQuery = buildLexicalMemoryQuery(safeQuery);
    if (!lexicalQuery) throw new BadRequestException('query must contain searchable terms.');
    const safeLimit = Math.max(1, Math.min(20, Number.isFinite(limit) ? limit : 8));
    const scopeClauses = scopes?.length
      ? Prisma.sql`AND (${Prisma.join(scopes.map((item) => item.scope === 'GLOBAL' || item.scope === 'ORGANIZATION'
          ? Prisma.sql`("scope" = ${item.scope} AND "scopeId" IS NULL)`
          : Prisma.sql`("scope" = ${item.scope} AND "scopeId" = ${item.scopeId ?? null})`), ' OR ')})`
      : Prisma.empty;

    // Runtime and planning callers submit full prompts/goals, not keyword-only queries.
    // plainto_tsquery combines terms with AND and therefore silently misses useful
    // memories when even one prompt term is absent. Build a bounded, sanitized OR
    // tsquery instead: PostgreSQL remains the retrieval engine, ranking stays
    // deterministic, and tenant/scope filters remain authoritative.
    return this.prisma.$queryRaw<MemoryEntry[]>(Prisma.sql`
      SELECT * FROM memory_entries
      WHERE "organizationId" = ${organizationId}
        AND "status" = 'ACTIVE'
        ${scopeClauses}
        AND to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", '')) @@ to_tsquery('simple', ${lexicalQuery})
      ORDER BY ts_rank(to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", '')), to_tsquery('simple', ${lexicalQuery})) DESC,
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

function buildLexicalMemoryQuery(query: string): string {
  const terms = query
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}_]+/gu) ?? [];
  const uniqueTerms: string[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    if (term.length < MIN_MEMORY_QUERY_TERM_CHARS || seen.has(term)) continue;
    seen.add(term);
    uniqueTerms.push(term);
    if (uniqueTerms.length >= MAX_MEMORY_QUERY_TERMS) break;
  }
  return uniqueTerms.join(' | ');
}

function validateScope(scope: MemoryScope, scopeId: string | null) {
  const unscoped = scope === 'GLOBAL' || scope === 'ORGANIZATION';
  if (unscoped && scopeId) throw new BadRequestException(`${scope} memory must not have scopeId.`);
  if (!unscoped && !scopeId?.trim()) throw new BadRequestException(`${scope} memory requires scopeId.`);
}
