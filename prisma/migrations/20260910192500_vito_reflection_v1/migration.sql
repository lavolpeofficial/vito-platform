-- VITO Self-Learning Core v1 · Phase 3
-- Structured reflection remains evidence-grounded and is not a policy promotion.

CREATE TABLE "experience_reflections" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "experience_id" TEXT NOT NULL,
  "lesson" TEXT NOT NULL,
  "what_worked" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "what_failed" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "assumptions" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "next_action_hint" TEXT,
  "evidence_outcome_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "confidence" DOUBLE PRECISION,
  "reflector_type" TEXT NOT NULL DEFAULT 'SYSTEM',
  "reflector_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "experience_reflections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "experience_reflections_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "experience_reflections_experience_id_fkey"
    FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "experience_reflections_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "experience_reflections_reflector_type_check"
    CHECK ("reflector_type" IN ('SYSTEM', 'USER', 'EXTERNAL')),
  CONSTRAINT "experience_reflections_evidence_nonempty_check"
    CHECK (jsonb_typeof("evidence_outcome_ids") = 'array' AND jsonb_array_length("evidence_outcome_ids") > 0)
);

CREATE INDEX "experience_reflections_organization_experience_created_idx"
  ON "experience_reflections"("organization_id", "experience_id", "created_at");
