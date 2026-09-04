-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DEGRADED');

-- CreateEnum
CREATE TYPE "ProviderHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'QUOTA_LIMITED', 'UNAVAILABLE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ProviderQuotaStatus" AS ENUM ('UNKNOWN', 'AVAILABLE', 'LIMITED', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('CLOUD_LLM', 'LOCAL_LLM', 'DETERMINISTIC_TOOL', 'LOCAL_TOOL');

-- CreateTable
CREATE TABLE "agent_providers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "providerType" "ProviderType" NOT NULL DEFAULT 'CLOUD_LLM',
    "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "modelFamily" TEXT,
    "modelName" TEXT,
    "modelCode" TEXT,
    "supportedCapabilities" JSONB NOT NULL DEFAULT '[]',
    "healthStatus" "ProviderHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "healthCheckedAt" TIMESTAMP(3),
    "quotaStatus" "ProviderQuotaStatus" NOT NULL DEFAULT 'UNKNOWN',
    "quotaCheckedAt" TIMESTAMP(3),
    "qualityScore" DOUBLE PRECISION,
    "latencyScore" DOUBLE PRECISION,
    "costScore" DOUBLE PRECISION,
    "costMetadata" JSONB NOT NULL DEFAULT '{}',
    "assuranceLevels" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_routing_decisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "workflowStepRunId" TEXT,
    "requestedCapability" TEXT NOT NULL,
    "assuranceLevel" TEXT,
    "selectedProviderId" TEXT,
    "candidateProviderIds" JSONB NOT NULL DEFAULT '[]',
    "rejectionReasons" JSONB NOT NULL DEFAULT '{}',
    "scoreComponents" JSONB NOT NULL DEFAULT '{}',
    "finalScore" DOUBLE PRECISION,
    "decisionReason" TEXT NOT NULL,
    "routingPolicyVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_routing_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_providers_organizationId_providerCode_key" ON "agent_providers"("organizationId", "providerCode");

-- CreateIndex
CREATE INDEX "agent_providers_organizationId_idx" ON "agent_providers"("organizationId");

-- CreateIndex
CREATE INDEX "agent_providers_organizationId_status_idx" ON "agent_providers"("organizationId", "status");

-- CreateIndex
CREATE INDEX "agent_providers_organizationId_providerCode_idx" ON "agent_providers"("organizationId", "providerCode");

-- CreateIndex
CREATE INDEX "provider_routing_decisions_organizationId_idx" ON "provider_routing_decisions"("organizationId");

-- CreateIndex
CREATE INDEX "provider_routing_decisions_organizationId_correlationId_idx" ON "provider_routing_decisions"("organizationId", "correlationId");

-- CreateIndex
CREATE INDEX "provider_routing_decisions_organizationId_workflowRunId_idx" ON "provider_routing_decisions"("organizationId", "workflowRunId");

-- CreateIndex
CREATE INDEX "provider_routing_decisions_selectedProviderId_idx" ON "provider_routing_decisions"("selectedProviderId");

-- AddForeignKey
ALTER TABLE "agent_providers" ADD CONSTRAINT "agent_providers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_routing_decisions" ADD CONSTRAINT "provider_routing_decisions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_routing_decisions" ADD CONSTRAINT "provider_routing_decisions_selectedProviderId_fkey" FOREIGN KEY ("selectedProviderId") REFERENCES "agent_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
