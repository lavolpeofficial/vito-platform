-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('DOCUMENT', 'SPREADSHEET', 'PRESENTATION', 'IMAGE', 'AUDIO', 'VIDEO', 'EMAIL', 'WEB_CAPTURE', 'DATASET', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceConfidentiality" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "SourceRightsStatus" AS ENUM ('OWNED', 'LICENSED', 'CUSTOMER_PROVIDED', 'THIRD_PARTY_REFERENCE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SourceIngestionStatus" AS ENUM ('RECEIVED', 'HASHED', 'STORED', 'FAILED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "SourceExtractionStatus" AS ENUM ('NOT_STARTED', 'PROCESSING', 'EXTRACTED', 'PARTIAL', 'FAILED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "SourceValidationStatus" AS ENUM ('UNREVIEWED', 'REVIEWED', 'VALIDATED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SourceLocatorType" AS ENUM ('PAGE', 'SHEET', 'CELL_RANGE', 'SLIDE', 'TIMECODE', 'SECTION', 'MESSAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceDerivationType" AS ENUM ('QUOTE', 'PARAPHRASE', 'EXTRACTION', 'INFERENCE', 'SYNTHESIS');

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectKey" TEXT,
    "domain" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageUri" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesSourceId" TEXT,
    "parentSourceId" TEXT,
    "language" TEXT,
    "title" TEXT,
    "author" TEXT,
    "sourceDate" TIMESTAMP(3),
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestedBy" TEXT NOT NULL,
    "confidentiality" "SourceConfidentiality" NOT NULL DEFAULT 'INTERNAL',
    "rightsStatus" "SourceRightsStatus" NOT NULL DEFAULT 'UNKNOWN',
    "retentionClass" TEXT,
    "ingestionStatus" "SourceIngestionStatus" NOT NULL DEFAULT 'RECEIVED',
    "extractionStatus" "SourceExtractionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "validationStatus" "SourceValidationStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_source_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "knowledgeRef" TEXT NOT NULL,
    "locatorType" "SourceLocatorType",
    "locatorValue" TEXT,
    "derivationType" "SourceDerivationType" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_source_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sources_sourceId_key" ON "sources"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "sources_organizationId_sha256_key" ON "sources"("organizationId", "sha256");

-- CreateIndex
CREATE INDEX "sources_organizationId_idx" ON "sources"("organizationId");

-- CreateIndex
CREATE INDEX "sources_organizationId_projectKey_idx" ON "sources"("organizationId", "projectKey");

-- CreateIndex
CREATE INDEX "sources_organizationId_originalFilename_idx" ON "sources"("organizationId", "originalFilename");

-- CreateIndex
CREATE INDEX "sources_supersedesSourceId_idx" ON "sources"("supersedesSourceId");

-- CreateIndex
CREATE INDEX "sources_parentSourceId_idx" ON "sources"("parentSourceId");

-- CreateIndex
CREATE INDEX "knowledge_source_links_organizationId_idx" ON "knowledge_source_links"("organizationId");

-- CreateIndex
CREATE INDEX "knowledge_source_links_sourceId_idx" ON "knowledge_source_links"("sourceId");

-- CreateIndex
CREATE INDEX "knowledge_source_links_organizationId_knowledgeRef_idx" ON "knowledge_source_links"("organizationId", "knowledgeRef");

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_supersedesSourceId_fkey" FOREIGN KEY ("supersedesSourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_parentSourceId_fkey" FOREIGN KEY ("parentSourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_source_links" ADD CONSTRAINT "knowledge_source_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_source_links" ADD CONSTRAINT "knowledge_source_links_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
