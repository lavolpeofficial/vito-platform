import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FailurePatternRecord,
  FailurePatternRepository,
  FailurePatternStatus,
  RecordFailurePatternInput,
} from './failure-pattern.types';

type FailurePatternRow = {
  id: string;
  organization_id: string;
  experience_id: string;
  reflection_id: string;
  outcome_ids: unknown;
  signature: string;
  root_cause: string;
  prevention: string;
  applicability: unknown;
  severity: number;
  confidence: number | null;
  status: FailurePatternStatus;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class PrismaFailurePatternRepository implements FailurePatternRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, input: RecordFailurePatternInput): Promise<FailurePatternRecord> {
    const rows = await this.prisma.$queryRaw<FailurePatternRow[]>(Prisma.sql`
      INSERT INTO "failure_patterns" (
        "id", "organization_id", "experience_id", "reflection_id", "outcome_ids", "signature",
        "root_cause", "prevention", "applicability", "severity", "confidence"
      ) VALUES (
        ${randomUUID()}, ${organizationId}, ${input.experienceId}, ${input.reflectionId},
        ${JSON.stringify(input.outcomeIds)}::jsonb, ${input.signature}, ${input.rootCause}, ${input.prevention},
        ${JSON.stringify(input.applicability ?? {})}::jsonb, ${input.severity}, ${input.confidence ?? null}
      ) RETURNING *
    `);
    return mapRow(rows[0]);
  }

  async getById(organizationId: string, failurePatternId: string): Promise<FailurePatternRecord | null> {
    const rows = await this.prisma.$queryRaw<FailurePatternRow[]>(Prisma.sql`
      SELECT * FROM "failure_patterns"
      WHERE "organization_id" = ${organizationId} AND "id" = ${failurePatternId}
      LIMIT 1
    `);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async search(
    organizationId: string,
    query: { signature?: string; status?: FailurePatternStatus; limit?: number },
  ): Promise<readonly FailurePatternRecord[]> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const signatureClause = query.signature
      ? Prisma.sql`AND LOWER("signature") LIKE ${`%${query.signature.toLowerCase()}%`}`
      : Prisma.empty;
    const statusClause = query.status ? Prisma.sql`AND "status" = ${query.status}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<FailurePatternRow[]>(Prisma.sql`
      SELECT * FROM "failure_patterns"
      WHERE "organization_id" = ${organizationId}
      ${signatureClause}
      ${statusClause}
      ORDER BY "severity" DESC, "created_at" DESC
      LIMIT ${limit}
    `);
    return rows.map(mapRow);
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mapRow(row: FailurePatternRow | undefined): FailurePatternRecord {
  if (!row) throw new Error('Failure pattern insert did not return a row.');
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    experienceId: row.experience_id,
    reflectionId: row.reflection_id,
    outcomeIds: asStringArray(row.outcome_ids),
    signature: row.signature,
    rootCause: row.root_cause,
    prevention: row.prevention,
    applicability: asRecord(row.applicability),
    severity: row.severity,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
