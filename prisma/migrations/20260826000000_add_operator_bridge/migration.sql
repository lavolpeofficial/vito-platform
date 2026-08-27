-- VITO-OB-001: stable machine identity classification and Operator Bridge task persistence.

-- CreateEnum
CREATE TYPE "OperatorTaskStatus" AS ENUM ('DISPATCHING', 'COMPLETED', 'HUMAN_GATE', 'FAILED');

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "isMachineIdentity" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "machineScope" TEXT;

-- Fail closed: a human identity can never carry a machine scope.
ALTER TABLE "users"
  ADD CONSTRAINT "users_machine_scope_requires_machine_identity_check"
  CHECK ("isMachineIdentity" = true OR "machineScope" IS NULL);

-- CreateTable
CREATE TABLE "operator_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "workflowStepRunId" TEXT NOT NULL,
    "capabilityCode" TEXT NOT NULL,
    "prompt" TEXT,
    "assuranceLevel" TEXT,
    "status" "OperatorTaskStatus" NOT NULL,
    "maxDurationMs" INTEGER,
    "maxTokens" INTEGER,
    "maxCostMinorUnits" INTEGER,
    "invocationId" TEXT,
    "executionId" TEXT,
    "routingDecisionId" TEXT,
    "providerCode" TEXT,
    "providerName" TEXT,
    "stdout" TEXT,
    "stderr" TEXT,
    "changedFiles" JSONB,
    "patch" TEXT,
    "errorReason" TEXT,
    "errorMessage" TEXT,
    "errorRetryable" BOOLEAN,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "workspaceDisposition" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "sensitivePayloadAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sensitivePayloadExpiresAt" TIMESTAMP(3) NOT NULL,
    "sensitivePayloadDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operator_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operator_tasks_organizationId_requestId_key" ON "operator_tasks"("organizationId", "requestId");

-- CreateIndex
CREATE INDEX "operator_tasks_organizationId_status_idx" ON "operator_tasks"("organizationId", "status");

-- CreateIndex
CREATE INDEX "operator_tasks_organizationId_correlationId_idx" ON "operator_tasks"("organizationId", "correlationId");

-- CreateIndex
CREATE INDEX "operator_tasks_sensitivePayloadAvailable_sensitivePayloadExpiresAt_idx" ON "operator_tasks"("sensitivePayloadAvailable", "sensitivePayloadExpiresAt");

-- AddForeignKey
ALTER TABLE "operator_tasks" ADD CONSTRAINT "operator_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
