-- VITO Self-Learning Core v1 · Phase 4
-- Governed, traceable and reversible maturity ladder.

CREATE TABLE "learning_candidates" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "experience_id" TEXT NOT NULL,
  "reflection_id" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "applicability" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "maturity" TEXT NOT NULL DEFAULT 'OBSERVATION',
  "confidence" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "learning_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "learning_candidates_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "learning_candidates_experience_id_fkey"
    FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "learning_candidates_reflection_id_fkey"
    FOREIGN KEY ("reflection_id") REFERENCES "experience_reflections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "learning_candidates_maturity_check"
    CHECK ("maturity" IN ('OBSERVATION', 'HYPOTHESIS', 'PATTERN', 'POLICY')),
  CONSTRAINT "learning_candidates_status_check"
    CHECK ("status" IN ('ACTIVE', 'REJECTED', 'RETIRED')),
  CONSTRAINT "learning_candidates_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
);

CREATE TABLE "learning_promotions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "candidate_id" TEXT NOT NULL,
  "from_maturity" TEXT NOT NULL,
  "to_maturity" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "reason" TEXT NOT NULL,
  "actor_type" TEXT NOT NULL DEFAULT 'SYSTEM',
  "actor_id" TEXT,
  "approval_ref" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "learning_promotions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "learning_promotions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "learning_promotions_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "learning_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "learning_promotions_from_maturity_check"
    CHECK ("from_maturity" IN ('OBSERVATION', 'HYPOTHESIS', 'PATTERN', 'POLICY')),
  CONSTRAINT "learning_promotions_to_maturity_check"
    CHECK ("to_maturity" IN ('OBSERVATION', 'HYPOTHESIS', 'PATTERN', 'POLICY')),
  CONSTRAINT "learning_promotions_actor_type_check"
    CHECK ("actor_type" IN ('SYSTEM', 'USER', 'EXTERNAL'))
);

CREATE INDEX "learning_candidates_org_status_maturity_idx"
  ON "learning_candidates"("organization_id", "status", "maturity");
CREATE INDEX "learning_promotions_org_candidate_created_idx"
  ON "learning_promotions"("organization_id", "candidate_id", "created_at");
