import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OutcomeRecord,
  OutcomeRepository,
  OutcomeEvaluatorType,
  RecordOutcomeInput,
} from './outcome-evaluation.types';

type OutcomeRow = {
  id: string;
  organization_id: string;
  experience_id: string;
  metric_code: string;
  expected_value: unknown | null;
  observed_value: unknown;
  evidence: unknown;
  score: number;
  confidence: number | null;
  evaluator_type: OutcomeEvaluatorType;
  evaluator_id: string | null;
  evaluated_at: Date;
  created_at: Date;
};

@Injectable()
export class PrismaOutcomeRepository implements OutcomeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async experienceExists(organizationId: string, experienceId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM "experiences"
        WHERE "id" = ${experienceId}
          AND "organization_id" = ${organizationId}
      ) AS "exists"
    `);
    return rows[0]?.exists === true;
  }

  async create(organizationId: string, input: RecordOutcomeInput): Promise<OutcomeRecord> {
    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<OutcomeRow[]>(Prisma.sql`
      INSERT INTO "experience_outcomes" (
        "id", "organization_id", "experience_id", "metric_code", "expected_value",
        "observed_value", "evidence", "score", "confidence", "evaluator_type", "evaluator_id"
      ) VALUES (
        ${id}, ${organizationId}, ${input.experienceId}, ${input.metricCode},
        ${input.expectedValue == null ? null : JSON.stringify(input.expectedValue)}::jsonb,
        ${JSON.stringify(input.observedValue)}::jsonb,
        ${JSON.stringify(input.evidence)}::jsonb,
        ${input.score}, ${input.confidence ?? null}, ${input.evaluatorType ?? 'SYSTEM'},
        ${input.evaluatorId ?? null}
      )
      RETURNING *
    `);
    return mapRow(rows[0]);
  }

  async listForExperience(
    organizationId: string,
    experienceId: string,
  ): Promise<readonly OutcomeRecord[]> {
    const rows = await this.prisma.$queryRaw<OutcomeRow[]>(Prisma.sql`
      SELECT * FROM "experience_outcomes"
      WHERE "organization_id" = ${organizationId}
        AND "experience_id" = ${experienceId}
      ORDER BY "evaluated_at" DESC, "created_at" DESC
    `);
    return rows.map(mapRow);
  }

  async markExperienceEvaluated(organizationId: string, experienceId: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "experiences"
      SET "status" = 'EVALUATED', "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${experienceId}
        AND "organization_id" = ${organizationId}
        AND "status" = 'OBSERVED'
    `);
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

function mapRow(row: OutcomeRow | undefined): OutcomeRecord {
  if (!row) throw new Error('Outcome insert did not return a row.');
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    experienceId: row.experience_id,
    metricCode: row.metric_code,
    expectedValue: row.expected_value,
    observedValue: row.observed_value,
    evidence: asRecord(row.evidence),
    score: row.score,
    confidence: row.confidence,
    evaluatorType: row.evaluator_type,
    evaluatorId: row.evaluator_id,
    evaluatedAt: row.evaluated_at,
    createdAt: row.created_at,
  });
}
