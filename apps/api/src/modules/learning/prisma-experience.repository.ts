import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ExperienceRecord,
  ExperienceRepository,
  ExperienceSearchQuery,
  ExperienceStatus,
  RecordExperienceInput,
} from './experience-store.types';

type ExperienceRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  goal: string;
  context: unknown;
  observation: unknown;
  decision: unknown;
  action: unknown;
  result: unknown;
  success_score: number | null;
  confidence: number | null;
  feedback: unknown | null;
  lesson: string | null;
  reusable_pattern: unknown | null;
  status: ExperienceStatus;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class PrismaExperienceRepository implements ExperienceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async agentBelongsToOrganization(organizationId: string, agentId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM "digital_employees"
        WHERE "id" = ${agentId}
          AND "organizationId" = ${organizationId}
      ) AS "exists"
    `);
    return rows[0]?.exists === true;
  }

  async create(organizationId: string, input: RecordExperienceInput): Promise<ExperienceRecord> {
    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<ExperienceRow[]>(Prisma.sql`
      INSERT INTO "experiences" (
        "id", "organization_id", "agent_id", "goal", "context", "observation",
        "decision", "action", "result", "success_score", "confidence", "feedback",
        "lesson", "reusable_pattern", "status"
      ) VALUES (
        ${id},
        ${organizationId},
        ${input.agentId},
        ${input.goal},
        ${JSON.stringify(input.context)}::jsonb,
        ${JSON.stringify(input.observation)}::jsonb,
        ${JSON.stringify(input.decision)}::jsonb,
        ${JSON.stringify(input.action)}::jsonb,
        ${JSON.stringify(input.result)}::jsonb,
        ${input.successScore ?? null},
        ${input.confidence ?? null},
        ${input.feedback == null ? null : JSON.stringify(input.feedback)}::jsonb,
        ${input.lesson ?? null},
        ${input.reusablePattern == null ? null : JSON.stringify(input.reusablePattern)}::jsonb,
        ${input.status ?? 'OBSERVED'}
      )
      RETURNING *
    `);
    return mapRow(rows[0]);
  }

  async getById(organizationId: string, experienceId: string): Promise<ExperienceRecord | null> {
    const rows = await this.prisma.$queryRaw<ExperienceRow[]>(Prisma.sql`
      SELECT *
      FROM "experiences"
      WHERE "organization_id" = ${organizationId}
        AND "id" = ${experienceId}
      LIMIT 1
    `);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async search(organizationId: string, query: ExperienceSearchQuery): Promise<readonly ExperienceRecord[]> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const agentClause = query.agentId
      ? Prisma.sql`AND "agent_id" = ${query.agentId}`
      : Prisma.empty;
    const statusClause = query.statuses?.length
      ? Prisma.sql`AND "status" IN (${Prisma.join(query.statuses)})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<ExperienceRow[]>(Prisma.sql`
      SELECT *
      FROM "experiences"
      WHERE "organization_id" = ${organizationId}
      ${agentClause}
      ${statusClause}
      ORDER BY "created_at" DESC
      LIMIT ${limit}
    `);
    return rows.map(mapRow);
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

function mapRow(row: ExperienceRow | undefined): ExperienceRecord {
  if (!row) throw new Error('Experience insert did not return a row.');
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    goal: row.goal,
    context: asRecord(row.context),
    observation: asRecord(row.observation),
    decision: asRecord(row.decision),
    action: asRecord(row.action),
    result: asRecord(row.result),
    successScore: row.success_score,
    confidence: row.confidence,
    feedback: row.feedback == null ? null : asRecord(row.feedback),
    lesson: row.lesson,
    reusablePattern: row.reusable_pattern == null ? null : asRecord(row.reusable_pattern),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
