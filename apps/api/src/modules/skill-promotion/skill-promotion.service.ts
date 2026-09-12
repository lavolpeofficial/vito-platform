import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TenantContext } from '../../common/tenant/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SkillCandidateService } from '../learning/skill-candidate.service';

export type SkillPromotionReviewStatus = 'PENDING_REVIEW' | 'APPROVED_FOR_REGISTRATION' | 'REJECTED';

export interface SkillPromotionReview {
  readonly id: string;
  readonly organizationId: string;
  readonly skillCandidateId: string;
  readonly targetCapabilityCode: string;
  readonly evidenceSnapshot: Readonly<Record<string, unknown>>;
  readonly status: SkillPromotionReviewStatus;
  readonly requestedByUserId: string;
  readonly reviewedByUserId: string | null;
  readonly reviewRationale: string | null;
  readonly createdAt: Date;
  readonly reviewedAt: Date | null;
  readonly updatedAt: Date;
}

type SkillPromotionReviewRow = {
  id: string;
  organization_id: string;
  skill_candidate_id: string;
  target_capability_code: string;
  evidence_snapshot: unknown;
  status: SkillPromotionReviewStatus;
  requested_by_user_id: string;
  reviewed_by_user_id: string | null;
  review_rationale: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  updated_at: Date;
};

const CAPABILITY_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/u;

@Injectable()
export class SkillPromotionService {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly skillCandidates: SkillCandidateService,
  ) {}

  async propose(skillCandidateId: string, targetCapabilityCode: string): Promise<SkillPromotionReview> {
    const { organizationId, userId } = this.requireHumanGovernance();
    const candidate = await this.skillCandidates.get(skillCandidateId);
    if (candidate.status !== 'RECORDED') {
      throw new BadRequestException('Only RECORDED skill candidates may enter promotion review.');
    }

    const capabilityCode = normalizeCapabilityCode(targetCapabilityCode);
    const existing = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "skill_promotion_reviews"
      WHERE "organization_id" = ${organizationId}
        AND "skill_candidate_id" = ${candidate.id}
        AND "status" = 'PENDING_REVIEW'
      LIMIT 1
    `);
    if (existing[0]) throw new ConflictException('A pending promotion review already exists for this skill candidate.');

    const evidenceSnapshot = Object.freeze({
      learningCandidateId: candidate.learningCandidateId,
      candidateCode: candidate.code,
      supportingOutcomeIds: [...candidate.supportingOutcomeIds],
      confidence: candidate.confidence,
      approvalRef: candidate.approvalRef,
      candidateStatus: candidate.status,
    });

    const rows = await this.prisma.$queryRaw<SkillPromotionReviewRow[]>(Prisma.sql`
      INSERT INTO "skill_promotion_reviews" (
        "id", "organization_id", "skill_candidate_id", "target_capability_code",
        "evidence_snapshot", "status", "requested_by_user_id"
      ) VALUES (
        ${randomUUID()}, ${organizationId}, ${candidate.id}, ${capabilityCode},
        ${JSON.stringify(evidenceSnapshot)}::jsonb, 'PENDING_REVIEW', ${userId}
      )
      RETURNING *
    `);
    const review = mapRow(rows[0]);

    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: 'SKILL_PROMOTION_REVIEW_PROPOSED',
      entityType: 'SkillPromotionReview',
      entityId: review.id,
      metadata: {
        skillCandidateId: candidate.id,
        targetCapabilityCode: capabilityCode,
        executionAuthorityGranted: false,
      },
    });
    return review;
  }

  async approveForRegistration(id: string, rationale: string): Promise<SkillPromotionReview> {
    return this.review(id, 'APPROVED_FOR_REGISTRATION', rationale);
  }

  async reject(id: string, rationale: string): Promise<SkillPromotionReview> {
    return this.review(id, 'REJECTED', rationale);
  }

  async get(id: string): Promise<SkillPromotionReview> {
    const organizationId = this.tenantContext.getOrThrow();
    const rows = await this.prisma.$queryRaw<SkillPromotionReviewRow[]>(Prisma.sql`
      SELECT * FROM "skill_promotion_reviews"
      WHERE "organization_id" = ${organizationId} AND "id" = ${id}
      LIMIT 1
    `);
    if (!rows[0]) throw new NotFoundException('Skill promotion review not found.');
    return mapRow(rows[0]);
  }

  async list(status?: SkillPromotionReviewStatus, limit = 50): Promise<readonly SkillPromotionReview[]> {
    const organizationId = this.tenantContext.getOrThrow();
    const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? limit : 50));
    const statusClause = status ? Prisma.sql`AND "status" = ${status}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<SkillPromotionReviewRow[]>(Prisma.sql`
      SELECT * FROM "skill_promotion_reviews"
      WHERE "organization_id" = ${organizationId}
      ${statusClause}
      ORDER BY "created_at" DESC
      LIMIT ${safeLimit}
    `);
    return Object.freeze(rows.map(mapRow));
  }

  private async review(
    id: string,
    status: Exclude<SkillPromotionReviewStatus, 'PENDING_REVIEW'>,
    rationale: string,
  ): Promise<SkillPromotionReview> {
    const { organizationId, userId } = this.requireHumanGovernance();
    const normalizedRationale = rationale?.trim();
    if (!normalizedRationale || normalizedRationale.length > 2000) {
      throw new BadRequestException('review rationale must contain between 1 and 2000 characters.');
    }

    const rows = await this.prisma.$queryRaw<SkillPromotionReviewRow[]>(Prisma.sql`
      UPDATE "skill_promotion_reviews"
      SET "status" = ${status},
          "reviewed_by_user_id" = ${userId},
          "review_rationale" = ${normalizedRationale},
          "reviewed_at" = CURRENT_TIMESTAMP,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "organization_id" = ${organizationId}
        AND "id" = ${id}
        AND "status" = 'PENDING_REVIEW'
      RETURNING *
    `);
    if (!rows[0]) {
      const existing = await this.get(id).catch(() => null);
      if (!existing) throw new NotFoundException('Skill promotion review not found.');
      throw new ConflictException('Skill promotion review is already final.');
    }
    const review = mapRow(rows[0]);

    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: status === 'APPROVED_FOR_REGISTRATION'
        ? 'SKILL_PROMOTION_APPROVED_FOR_REGISTRATION'
        : 'SKILL_PROMOTION_REJECTED',
      entityType: 'SkillPromotionReview',
      entityId: review.id,
      metadata: {
        skillCandidateId: review.skillCandidateId,
        targetCapabilityCode: review.targetCapabilityCode,
        status: review.status,
        executionAuthorityGranted: false,
        capabilityCreated: false,
        providerBindingChanged: false,
      },
    });
    return review;
  }

  private requireHumanGovernance(): { organizationId: string; userId: string } {
    const organizationId = this.tenantContext.getOrThrow();
    const userId = this.tenantContext.getUserId();
    if (this.tenantContext.getAuthenticationMethod() !== 'jwt' || !userId) {
      throw new BadRequestException('Skill promotion requires authenticated human governance.');
    }
    return { organizationId, userId };
  }
}

function normalizeCapabilityCode(value: string): string {
  const code = value?.trim().toUpperCase();
  if (!CAPABILITY_CODE_PATTERN.test(code)) {
    throw new BadRequestException('targetCapabilityCode must be an uppercase capability identifier.');
  }
  return code;
}

function mapRow(row: SkillPromotionReviewRow | undefined): SkillPromotionReview {
  if (!row) throw new Error('Skill promotion review operation did not return a row.');
  const snapshot = row.evidence_snapshot && typeof row.evidence_snapshot === 'object' && !Array.isArray(row.evidence_snapshot)
    ? row.evidence_snapshot as Readonly<Record<string, unknown>>
    : {};
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    skillCandidateId: row.skill_candidate_id,
    targetCapabilityCode: row.target_capability_code,
    evidenceSnapshot: Object.freeze(snapshot),
    status: row.status,
    requestedByUserId: row.requested_by_user_id,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewRationale: row.review_rationale,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    updatedAt: row.updated_at,
  });
}
