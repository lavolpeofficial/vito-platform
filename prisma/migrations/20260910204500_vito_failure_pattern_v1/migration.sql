-- VITO Self-Learning Core v1 · Phase 5
-- Objective failure patterns are grounded in persisted negative outcomes.

CREATE TABLE "failure_patterns" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "experience_id" TEXT NOT NULL,
  "reflection_id" TEXT NOT NULL,
  "outcome_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "signature" TEXT NOT NULL,
  "root_cause" TEXT NOT NULL,
  "prevention" TEXT NOT NULL,
  "applicability" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "severity" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "failure_patterns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "failure_patterns_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "failure_patterns_experience_id_fkey"
    FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "failure_patterns_reflection_id_fkey"
    FOREIGN KEY ("reflection_id") REFERENCES "experience_reflections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "failure_patterns_outcome_ids_nonempty_check"
    CHECK (jsonb_typeof("outcome_ids") = 'array' AND jsonb_array_length("outcome_ids") > 0),
  CONSTRAINT "failure_patterns_severity_check"
    CHECK ("severity" >= 0 AND "severity" <= 1),
  CONSTRAINT "failure_patterns_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "failure_patterns_status_check"
    CHECK ("status" IN ('ACTIVE', 'RESOLVED', 'ARCHIVED'))
);

CREATE INDEX "failure_patterns_org_status_severity_idx"
  ON "failure_patterns"("organization_id", "status", "severity" DESC);
CREATE INDEX "failure_patterns_org_experience_idx"
  ON "failure_patterns"("organization_id", "experience_id");
