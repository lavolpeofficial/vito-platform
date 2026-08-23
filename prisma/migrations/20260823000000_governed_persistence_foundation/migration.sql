-- B2a: Governed Persistence Foundation
-- 1) AgentProvider.credentialRequirement (EO-01.5-Semantik, fail-closed Default UNKNOWN)
-- 2) GovernedOperationEnvelope: vertrauenswürdige Operation-Identität für intern
--    initiierte governed Invocations (kein Task-Dispatch, keine Human-Gate-Persistenz)
-- 3) GovernedInvocationClaim: Idempotenz-Grenzpersistenz (EO-01.5 Phase 3H.1);
--    UNIQUE(logicalOperationKey) = Dedup-Primärschlüssel, UNIQUE(invocationId) =
--    Attempt-Identität (Wiederverwendung unter fremdem Schlüssel => CONTEXT_CONFLICT).
--    Claims werden nie freigegeben.
-- 4) GovernedExecutionRecord: Evidence Ledger für governede Ausführungen;
--    ausschließlich bereits sanitisierte Strukturen, keine Rohinhalte/Secrets.

-- CreateEnum
CREATE TYPE "ProviderCredentialRequirement" AS ENUM ('REQUIRED', 'NOT_REQUIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "GovernedInvocationClaimState" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'TIMED_OUT_UNKNOWN', 'FAILED_UNKNOWN');

-- CreateEnum
CREATE TYPE "GovernedOperationEnvelopeStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentExecutionStatus" AS ENUM ('QUEUED', 'STARTING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'POLICY_BLOCKED', 'QUOTA_BLOCKED');

-- AlterTable
ALTER TABLE "agent_providers" ADD COLUMN "credentialRequirement" "ProviderCredentialRequirement" NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable
CREATE TABLE "governed_operation_envelopes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purposeCode" TEXT NOT NULL,
    "correlationId" TEXT,
    "status" "GovernedOperationEnvelopeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governed_operation_envelopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governed_invocation_claims" (
    "id" TEXT NOT NULL,
    "logicalOperationKey" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "contextFingerprint" TEXT NOT NULL,
    "state" "GovernedInvocationClaimState" NOT NULL DEFAULT 'IN_PROGRESS',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governed_invocation_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governed_execution_records" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "workflowStepRunId" TEXT NOT NULL,
    "capabilityCode" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "AgentExecutionStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "outputReference" TEXT,
    "artifactReferences" JSONB,
    "normalizedError" JSONB,
    "policyDecisionReference" TEXT NOT NULL,
    "sideEffectSummary" JSONB,
    "usageMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governed_execution_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "governed_invocation_claims_logicalOperationKey_key" ON "governed_invocation_claims"("logicalOperationKey");

-- CreateIndex
CREATE UNIQUE INDEX "governed_invocation_claims_invocationId_key" ON "governed_invocation_claims"("invocationId");

-- CreateIndex
CREATE INDEX "governed_operation_envelopes_organizationId_idx" ON "governed_operation_envelopes"("organizationId");

-- CreateIndex
CREATE INDEX "governed_operation_envelopes_correlationId_idx" ON "governed_operation_envelopes"("correlationId");

-- CreateIndex
CREATE INDEX "governed_execution_records_organizationId_idx" ON "governed_execution_records"("organizationId");

-- CreateIndex
CREATE INDEX "governed_execution_records_envelopeId_idx" ON "governed_execution_records"("envelopeId");

-- CreateIndex
CREATE INDEX "governed_execution_records_organizationId_workflowRunId_idx" ON "governed_execution_records"("organizationId", "workflowRunId");

-- AddForeignKey
ALTER TABLE "governed_operation_envelopes" ADD CONSTRAINT "governed_operation_envelopes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governed_execution_records" ADD CONSTRAINT "governed_execution_records_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "governed_operation_envelopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governed_execution_records" ADD CONSTRAINT "governed_execution_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
