-- VITO Self-Learning Core v1 · Phase 2
-- Objective outcomes are persisted separately from model reflection.

CREATE TABLE "experience_outcomes" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "experience_id" TEXT NOT NULL,
  "metric_code" TEXT NOT NULL,
  "expected_value" JSONB,
  "observed_value" JSONB NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "score" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION,
  "evaluator_type" TEXT NOT NULL DEFAULT 'SYSTEM',
  "evaluator_id" TEXT,
  "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "experience_outcomes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "experience_outcomes_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "experience_outcomes_experience_id_fkey"
    FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experience_outcomes_score_check"
    CHECK ("score" >= -1 AND "score" <= 1),
  CONSTRAINT "experience_outcomes_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "experience_outcomes_evaluator_type_check"
    CHECK ("evaluator_type" IN ('SYSTEM', 'USER', 'EXTERNAL'))
);

CREATE INDEX "experience_outcomes_organization_id_experience_id_idx"
  ON "experience_outcomes"("organization_id", "experience_id");
CREATE INDEX "experience_outcomes_organization_id_metric_code_idx"
  ON "experience_outcomes"("organization_id", "metric_code");
CREATE INDEX "experience_outcomes_organization_id_evaluated_at_idx"
  ON "experience_outcomes"("organization_id", "evaluated_at" DESC);
