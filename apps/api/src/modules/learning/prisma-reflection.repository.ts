import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RecordReflectionInput,
  ReflectionRecord,
  ReflectionRepository,
} from './reflection.types';

type ReflectionRow = {
  id: string;
  organization_id: string;
  experience_id: string;
  lesson: string;
  what_worked: unknown;
  what_failed: unknown;
  assumptions: unknown;
  next_action_hint: string | null;
  evidence_outcome_ids: unknown;
  confidence: number | null;
  reflector_type: 'SYSTEM' | 'USER' | 'EXTERNAL';
  reflector_id: string | null;
  created_at: Date;
};

@Injectable()
export class PrismaReflectionRepository implements ReflectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, input: RecordReflectionInput): Promise<ReflectionRecord> {
    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<ReflectionRow[]>(Prisma.sql`
      INSERT INTO "experience_reflections" (
        "id", "organization_id", "experience_id", "lesson", "what_worked", "what_failed",
        "assumptions", "next_action_hint", "evidence_outcome_ids", "confidence",
        "reflector_type", "reflector_id"
      ) VALUES (
        ${id},
        ${organizationId},
        ${input.experienceId},
        ${input.lesson},
        ${JSON.stringify(input.whatWorked ?? [])}::jsonb,
        ${JSON.stringify(input.whatFailed ?? [])}::jsonb,
        ${JSON.stringify(input.assumptions ?? [])}::jsonb,
        ${input.nextActionHint ?? null},
        ${JSON.stringify(input.evidenceOutcomeIds)}::jsonb,
        ${input.confidence ?? null},
        ${input.reflectorType ?? 'SYSTEM'},
        ${input.reflectorId ?? null}
      )
      RETURNING *
    `);
    return mapRow(rows[0]);
  }

  async listForExperience(organizationId: string, experienceId: string): Promise<readonly ReflectionRecord[]> {
    const rows = await this.prisma.$queryRaw<ReflectionRow[]>(Prisma.sql`
      SELECT *
      FROM "experience_reflections"
      WHERE "organization_id" = ${organizationId}
        AND "experience_id" = ${experienceId}
      ORDER BY "created_at" ASC
    `);
    return rows.map(mapRow);
  }

  async markExperienceReflected(organizationId: string, experienceId: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "experiences"
      SET "status" = 'REFLECTED', "updated_at" = CURRENT_TIMESTAMP
      WHERE "organization_id" = ${organizationId}
        AND "id" = ${experienceId}
        AND "status" = 'EVALUATED'
    `);
  }
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mapRow(row: ReflectionRow | undefined): ReflectionRecord {
  if (!row) throw new Error('Reflection insert did not return a row.');
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    experienceId: row.experience_id,
    lesson: row.lesson,
    whatWorked: asStringArray(row.what_worked),
    whatFailed: asStringArray(row.what_failed),
    assumptions: asStringArray(row.assumptions),
    nextActionHint: row.next_action_hint,
    evidenceOutcomeIds: asStringArray(row.evidence_outcome_ids),
    confidence: row.confidence,
    reflectorType: row.reflector_type,
    reflectorId: row.reflector_id,
    createdAt: row.created_at,
  });
}
