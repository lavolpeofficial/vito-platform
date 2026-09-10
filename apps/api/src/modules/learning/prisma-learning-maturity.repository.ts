import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateLearningCandidateInput,
  LearningCandidateRecord,
  LearningMaturity,
  LearningMaturityRepository,
  PromoteLearningCandidateInput,
  PromotionRecord,
} from './learning-maturity.types';

type CandidateRow = {
  id: string;
  organization_id: string;
  experience_id: string;
  reflection_id: string;
  statement: string;
  applicability: unknown;
  maturity: LearningMaturity;
  confidence: number | null;
  status: 'ACTIVE' | 'REJECTED' | 'RETIRED';
  created_at: Date;
  updated_at: Date;
};

type PromotionRow = {
  id: string;
  organization_id: string;
  candidate_id: string;
  from_maturity: LearningMaturity;
  to_maturity: LearningMaturity;
  evidence: unknown;
  reason: string;
  actor_type: 'SYSTEM' | 'USER' | 'EXTERNAL';
  actor_id: string | null;
  approval_ref: string | null;
  created_at: Date;
};

@Injectable()
export class PrismaLearningMaturityRepository implements LearningMaturityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createCandidate(organizationId: string, input: CreateLearningCandidateInput): Promise<LearningCandidateRecord> {
    const rows = await this.prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      INSERT INTO "learning_candidates" (
        "id", "organization_id", "experience_id", "reflection_id", "statement", "applicability", "confidence"
      ) VALUES (
        ${randomUUID()}, ${organizationId}, ${input.experienceId}, ${input.reflectionId}, ${input.statement},
        ${JSON.stringify(input.applicability ?? {})}::jsonb, ${input.confidence ?? null}
      ) RETURNING *
    `);
    return mapCandidate(rows[0]);
  }

  async getCandidate(organizationId: string, candidateId: string): Promise<LearningCandidateRecord | null> {
    const rows = await this.prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT * FROM "learning_candidates"
      WHERE "organization_id" = ${organizationId} AND "id" = ${candidateId}
      LIMIT 1
    `);
    return rows[0] ? mapCandidate(rows[0]) : null;
  }

  async createPromotion(
    organizationId: string,
    candidate: LearningCandidateRecord,
    input: PromoteLearningCandidateInput,
  ): Promise<PromotionRecord> {
    const rows = await this.prisma.$queryRaw<PromotionRow[]>(Prisma.sql`
      INSERT INTO "learning_promotions" (
        "id", "organization_id", "candidate_id", "from_maturity", "to_maturity", "evidence", "reason",
        "actor_type", "actor_id", "approval_ref"
      ) VALUES (
        ${randomUUID()}, ${organizationId}, ${candidate.id}, ${candidate.maturity}, ${input.toMaturity},
        ${JSON.stringify(input.evidence)}::jsonb, ${input.reason}, ${input.actorType ?? 'SYSTEM'},
        ${input.actorId ?? null}, ${input.approvalRef ?? null}
      ) RETURNING *
    `);
    return mapPromotion(rows[0]);
  }

  async setMaturity(
    organizationId: string,
    candidateId: string,
    fromMaturity: LearningMaturity,
    toMaturity: LearningMaturity,
  ): Promise<boolean> {
    const changed = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "learning_candidates"
      SET "maturity" = ${toMaturity}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "organization_id" = ${organizationId}
        AND "id" = ${candidateId}
        AND "maturity" = ${fromMaturity}
        AND "status" = 'ACTIVE'
    `);
    return changed === 1;
  }

  async listPromotions(organizationId: string, candidateId: string): Promise<readonly PromotionRecord[]> {
    const rows = await this.prisma.$queryRaw<PromotionRow[]>(Prisma.sql`
      SELECT * FROM "learning_promotions"
      WHERE "organization_id" = ${organizationId} AND "candidate_id" = ${candidateId}
      ORDER BY "created_at" ASC
    `);
    return rows.map(mapPromotion);
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

function mapCandidate(row: CandidateRow | undefined): LearningCandidateRecord {
  if (!row) throw new Error('Learning candidate insert did not return a row.');
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    experienceId: row.experience_id,
    reflectionId: row.reflection_id,
    statement: row.statement,
    applicability: asRecord(row.applicability),
    maturity: row.maturity,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapPromotion(row: PromotionRow | undefined): PromotionRecord {
  if (!row) throw new Error('Learning promotion insert did not return a row.');
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    candidateId: row.candidate_id,
    fromMaturity: row.from_maturity,
    toMaturity: row.to_maturity,
    evidence: asRecord(row.evidence),
    reason: row.reason,
    actorType: row.actor_type,
    actorId: row.actor_id,
    approvalRef: row.approval_ref,
    createdAt: row.created_at,
  });
}
