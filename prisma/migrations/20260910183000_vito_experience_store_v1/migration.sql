-- VITO Self-Learning Core v1 · Phase 1
-- Durable, tenant-scoped Experience Store. Learning promotion remains a later governed phase.

CREATE TABLE "experiences" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "goal" TEXT NOT NULL,
  "context" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "observation" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "decision" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "action" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "result" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "success_score" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION,
  "feedback" JSONB,
  "lesson" TEXT,
  "reusable_pattern" JSONB,
  "status" TEXT NOT NULL DEFAULT 'OBSERVED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "experiences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "experiences_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "experiences_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "digital_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "experiences_success_score_check"
    CHECK ("success_score" IS NULL OR ("success_score" >= -1 AND "success_score" <= 1)),
  CONSTRAINT "experiences_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "experiences_status_check"
    CHECK ("status" IN ('OBSERVED', 'EVALUATED', 'REFLECTED', 'LEARNING_CANDIDATE', 'ARCHIVED'))
);

CREATE INDEX "experiences_organization_id_created_at_idx"
  ON "experiences"("organization_id", "created_at" DESC);
CREATE INDEX "experiences_organization_id_agent_id_created_at_idx"
  ON "experiences"("organization_id", "agent_id", "created_at" DESC);
CREATE INDEX "experiences_organization_id_status_idx"
  ON "experiences"("organization_id", "status");
