CREATE TABLE "memory_entries" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "scopeId" TEXT,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceRef" TEXT,
  "confidence" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "memory_entries_kind_check" CHECK ("kind" IN ('EPISODIC','SEMANTIC','PROCEDURAL','ORGANIZATIONAL')),
  CONSTRAINT "memory_entries_scope_check" CHECK ("scope" IN ('GLOBAL','ORGANIZATION','PROJECT','CUSTOMER','AGENT','WORKFLOW')),
  CONSTRAINT "memory_entries_status_check" CHECK ("status" IN ('ACTIVE','RETRACTED')),
  CONSTRAINT "memory_entries_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "memory_entries_scoped_id_check" CHECK (("scope" IN ('GLOBAL','ORGANIZATION') AND "scopeId" IS NULL) OR ("scope" NOT IN ('GLOBAL','ORGANIZATION') AND "scopeId" IS NOT NULL))
);

CREATE INDEX "memory_entries_org_status_idx" ON "memory_entries"("organizationId", "status");
CREATE INDEX "memory_entries_org_kind_idx" ON "memory_entries"("organizationId", "kind");
CREATE INDEX "memory_entries_org_scope_idx" ON "memory_entries"("organizationId", "scope", "scopeId");
CREATE INDEX "memory_entries_source_idx" ON "memory_entries"("organizationId", "sourceType", "sourceRef");
CREATE INDEX "memory_entries_fts_idx" ON "memory_entries" USING GIN (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", '')));
