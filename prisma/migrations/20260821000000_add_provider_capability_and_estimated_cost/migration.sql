-- EO-01.3 Correction 02:
-- 1) Durable ProviderCapability assignments (routing authority)
-- 2) Explicit estimated monetary cost on AgentProvider

-- AlterTable
ALTER TABLE "agent_providers" ADD COLUMN "estimatedCostMinorUnits" INTEGER;

-- CreateTable
CREATE TABLE "provider_capabilities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentProviderId" TEXT NOT NULL,
    "capabilityCode" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_capabilities_organizationId_agentProviderId_capabilityCode_key" ON "provider_capabilities"("organizationId", "agentProviderId", "capabilityCode");

-- CreateIndex
CREATE INDEX "provider_capabilities_organizationId_idx" ON "provider_capabilities"("organizationId");

-- CreateIndex
CREATE INDEX "provider_capabilities_organizationId_capabilityCode_idx" ON "provider_capabilities"("organizationId", "capabilityCode");

-- CreateIndex
CREATE INDEX "provider_capabilities_organizationId_capabilityCode_isEnabled_idx" ON "provider_capabilities"("organizationId", "capabilityCode", "isEnabled");

-- AddForeignKey
ALTER TABLE "provider_capabilities" ADD CONSTRAINT "provider_capabilities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_capabilities" ADD CONSTRAINT "provider_capabilities_agentProviderId_fkey" FOREIGN KEY ("agentProviderId") REFERENCES "agent_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
