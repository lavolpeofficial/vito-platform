-- VITO Self-Learning Core v1 · Phase 7
-- Governed skill candidates are metadata only. They do not activate executable capabilities.

CREATE TABLE "skill_candidates" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "learning_candidate_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "procedure" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "applicability" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "supporting_outcome_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "confidence" DOUBLE PRECISION NOT NULL,
  "approval_ref" TEXT NOT NULL,
  "approved_by_user_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECORDED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "skill_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "skill_candidates_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "skill_candidates_learning_candidate_id_fkey"
    FOREIGN KEY ("learning_candidate_id") REFERENCES "learning_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "skill_candidates_approved_by_user_id_fkey"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "skill_candidates_confidence_check"
    CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "skill_candidates_status_check"
    CHECK ("status" IN ('RECORDED', 'REJECTED', 'RETIRED'))
);

CREATE UNIQUE INDEX "skill_candidates_org_code_key"
  ON "skill_candidates"("organization_id", "code");
CREATE INDEX "skill_candidates_org_status_idx"
  ON "skill_candidates"("organization_id", "status");
CREATE INDEX "skill_candidates_org_learning_candidate_idx"
  ON "skill_candidates"("organization_id", "learning_candidate_id");
