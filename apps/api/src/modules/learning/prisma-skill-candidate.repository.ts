import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RecordSkillCandidateInput,
  SkillCandidateRecord,
  SkillCandidateRepository,
  SkillCandidateStatus,
} from './skill-candidate.types';

type SkillCandidateRow = {
  id: string;
  organization_id: string;
  learning_candidate_id: string;
  code: string;
  name: string;
  description: string;
  procedure: unknown;
  applicability: unknown;
  supporting_outcome_ids: unknown;
  confidence: number;
  approval_ref: string;
  approved_by_user_id: string;
  status: SkillCandidateStatus;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class PrismaSkillCandidateRepository implements SkillCandidateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async outcomesBelongToOrganization(organizationId: string, outcomeIds: readonly string[]): Promise<boolean> {
    const ids = [...new Set(outcomeIds)];
    if (ids.length === 0) return false;
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "experience_outcomes"
      WHERE "organization_id" = ${organizationId}
        AND "id" IN (${Prisma.join(ids)})
    `);
    return Number(rows[0]?.count ?? 0n) === ids.length;
  }

  async create(
    organizationId: string,
    approvedByUserId: string,
    input: RecordSkillCandidateInput,
  ): Promise<SkillCandidateRecord> {
    const rows = await this.prisma.$queryRaw<SkillCandidateRow[]>(Prisma.sql`
      INSERT INTO "skill_candidates" (
        "id", "organization_id", "learning_candidate_id", "code", "name", "description",
        "procedure", "applicability", "supporting_outcome_ids", "confidence", "approval_ref", "approved_by_user_id"
      ) VALUES (
        ${randomUUID()}, ${organizationId}, ${input.learningCandidateId}, ${input.code}, ${input.name}, ${input.description},
        ${JSON.stringify(input.procedure)}::jsonb, ${JSON.stringify(input.applicability ?? {})}::jsonb,
        ${JSON.stringify([...new Set(input.supportingOutcomeIds)])}::jsonb, ${input.confidence}, ${input.approvalRef}, ${approvedByUserId}
      ) RETURNING *
    `);
    return mapRow(rows[0]);
  }

  async getById(organizationId: string, skillCandidateId: string): Promise<SkillCandidateRecord | null> {
    const rows = await this.prisma.$queryRaw<SkillCandidateRow[]>(Prisma.sql`
      SELECT * FROM "skill_candidates"
      WHERE "organization_id" = ${organizationId} AND "id" = ${skillCandidateId}
      LIMIT 1
    `);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async search(
    organizationId: string,
    query: { code?: string; status?: SkillCandidateStatus; limit?: number } = {},
  ): Promise<readonly SkillCandidateRecord[]> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const codeClause = query.code
      ? Prisma.sql`AND LOWER("code") LIKE ${`%${query.code.toLowerCase()}%`}`
      : Prisma.empty;
    const statusClause = query.status ? Prisma.sql`AND "status" = ${query.status}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<SkillCandidateRow[]>(Prisma.sql`
      SELECT * FROM "skill_candidates"
      WHERE "organization_id" = ${organizationId}
      ${codeClause}
      ${statusClause}
      ORDER BY "confidence" DESC, "created_at" DESC
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

function mapRow(row: SkillCandidateRow | undefined): SkillCandidateRecord {
  if (!row) throw new Error('Skill candidate insert did not return a row.');
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    learningCandidateId: row.learning_candidate_id,
    code: row.code,
    name: row.name,
    description: row.description,
    procedure: asRecord(row.procedure),
    applicability: asRecord(row.applicability),
    supportingOutcomeIds: asStringArray(row.supporting_outcome_ids),
    confidence: row.confidence,
    approvalRef: row.approval_ref,
    approvedByUserId: row.approved_by_user_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
