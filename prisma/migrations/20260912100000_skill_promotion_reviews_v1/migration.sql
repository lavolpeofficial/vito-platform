CREATE TABLE "skill_promotion_reviews" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "skill_candidate_id" TEXT NOT NULL,
  "target_capability_code" TEXT NOT NULL,
  "evidence_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "requested_by_user_id" TEXT NOT NULL,
  "reviewed_by_user_id" TEXT,
  "review_rationale" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "skill_promotion_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "skill_promotion_reviews_status_check" CHECK ("status" IN ('PENDING_REVIEW', 'APPROVED_FOR_REGISTRATION', 'REJECTED')),
  CONSTRAINT "skill_promotion_reviews_candidate_fk" FOREIGN KEY ("skill_candidate_id") REFERENCES "skill_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "skill_promotion_reviews_org_status_idx"
  ON "skill_promotion_reviews"("organization_id", "status", "created_at");

CREATE INDEX "skill_promotion_reviews_candidate_idx"
  ON "skill_promotion_reviews"("organization_id", "skill_candidate_id");

CREATE UNIQUE INDEX "skill_promotion_reviews_one_pending_per_candidate"
  ON "skill_promotion_reviews"("organization_id", "skill_candidate_id")
  WHERE "status" = 'PENDING_REVIEW';
