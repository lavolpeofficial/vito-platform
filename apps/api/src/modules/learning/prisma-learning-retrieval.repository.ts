import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LearningRetrievalQuery,
  LearningRetrievalRepository,
  RetrievedLearningItem,
} from './learning-retrieval.types';

type RetrievalRow = {
  kind: 'EXPERIENCE' | 'LEARNING_CANDIDATE' | 'FAILURE_PATTERN';
  source_id: string;
  title: string;
  detail: string;
  maturity: string | null;
  confidence: number | null;
  created_at: Date;
  rank: number;
};

@Injectable()
export class PrismaLearningRetrievalRepository implements LearningRetrievalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async retrieve(
    organizationId: string,
    query: LearningRetrievalQuery,
  ): Promise<readonly RetrievedLearningItem[]> {
    const limit = Math.min(Math.max(query.limit ?? 12, 1), 50);
    const pattern = `%${query.query.toLowerCase()}%`;
    const agentClause = query.agentId ? Prisma.sql`AND e."agent_id" = ${query.agentId}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<RetrievalRow[]>(Prisma.sql`
      WITH matches AS (
        SELECT
          'EXPERIENCE'::text AS kind,
          e."id" AS source_id,
          e."goal" AS title,
          COALESCE(e."lesson", e."result"::text) AS detail,
          e."status" AS maturity,
          e."confidence" AS confidence,
          e."created_at" AS created_at,
          1 AS rank
        FROM "experiences" e
        WHERE e."organization_id" = ${organizationId}
          ${agentClause}
          AND (
            LOWER(e."goal") LIKE ${pattern}
            OR LOWER(e."context"::text) LIKE ${pattern}
            OR LOWER(e."lesson") LIKE ${pattern}
          )

        UNION ALL

        SELECT
          'LEARNING_CANDIDATE'::text AS kind,
          c."id" AS source_id,
          c."statement" AS title,
          c."applicability"::text AS detail,
          c."maturity" AS maturity,
          c."confidence" AS confidence,
          c."created_at" AS created_at,
          CASE c."maturity"
            WHEN 'POLICY' THEN 2
            WHEN 'PATTERN' THEN 3
            WHEN 'HYPOTHESIS' THEN 4
            ELSE 5
          END AS rank
        FROM "learning_candidates" c
        WHERE c."organization_id" = ${organizationId}
          AND c."status" = 'ACTIVE'
          AND (
            LOWER(c."statement") LIKE ${pattern}
            OR LOWER(c."applicability"::text) LIKE ${pattern}
          )

        UNION ALL

        SELECT
          'FAILURE_PATTERN'::text AS kind,
          f."id" AS source_id,
          f."signature" AS title,
          CONCAT(f."root_cause", ' | Prevention: ', f."prevention") AS detail,
          f."status" AS maturity,
          f."confidence" AS confidence,
          f."created_at" AS created_at,
          0 AS rank
        FROM "failure_patterns" f
        WHERE f."organization_id" = ${organizationId}
          AND f."status" = 'ACTIVE'
          AND (
            LOWER(f."signature") LIKE ${pattern}
            OR LOWER(f."root_cause") LIKE ${pattern}
            OR LOWER(f."prevention") LIKE ${pattern}
            OR LOWER(f."applicability"::text) LIKE ${pattern}
          )
      )
      SELECT * FROM matches
      ORDER BY rank ASC, confidence DESC NULLS LAST, created_at DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => Object.freeze({
      kind: row.kind,
      sourceId: row.source_id,
      title: row.title,
      detail: row.detail,
      maturity: row.maturity,
      confidence: row.confidence,
      createdAt: row.created_at,
    }));
  }
}
