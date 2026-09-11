CREATE TABLE "knowledge_units" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "unitType" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "locatorType" "SourceLocatorType",
  "locatorValue" TEXT,
  "derivationType" "SourceDerivationType" NOT NULL DEFAULT 'EXTRACTION',
  "confidence" DOUBLE PRECISION,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED,
  CONSTRAINT "knowledge_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_units_unitType_check" CHECK ("unitType" IN ('TEXT_FRAGMENT','CLAIM','CONCEPT','RULE','PROCEDURE','EVIDENCE')),
  CONSTRAINT "knowledge_units_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "knowledge_units_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "knowledge_units_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "knowledge_units_org_source_hash_key"
  ON "knowledge_units"("organizationId", "sourceId", "contentSha256");
CREATE INDEX "knowledge_units_org_source_idx"
  ON "knowledge_units"("organizationId", "sourceId");
CREATE INDEX "knowledge_units_org_type_idx"
  ON "knowledge_units"("organizationId", "unitType");
CREATE INDEX "knowledge_units_search_gin_idx"
  ON "knowledge_units" USING GIN ("searchVector");
