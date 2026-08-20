-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('CREATED', 'RUNNING', 'WAITING_FOR_HUMAN', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowStepStatus" AS ENUM ('PENDING', 'READY', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EngineeringStepType" AS ENUM ('PLAN', 'BUILD', 'TEST', 'PACKAGE', 'RED_TEAM', 'PARSE_VERDICT', 'CORRECTION', 'VERIFY', 'HUMAN_RELEASE_GATE', 'RELEASE_EXECUTION', 'REMOTE_VERIFY');

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT,
    "workflowDefinitionCode" TEXT NOT NULL,
    "workflowDefinitionVersion" TEXT NOT NULL,
    "assuranceLevel" TEXT NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'CREATED',
    "currentStepType" "EngineeringStepType",
    "correctionLoopCount" INTEGER NOT NULL DEFAULT 0,
    "maxCorrectionLoops" INTEGER NOT NULL DEFAULT 3,
    "correlationId" TEXT NOT NULL,
    "blockReasonCode" TEXT,
    "failureReasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_step_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "stepType" "EngineeringStepType" NOT NULL,
    "status" "WorkflowStepStatus" NOT NULL DEFAULT 'PENDING',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "causationId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_step_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_runs_organizationId_idx" ON "workflow_runs"("organizationId");

-- CreateIndex
CREATE INDEX "workflow_runs_organizationId_status_idx" ON "workflow_runs"("organizationId", "status");

-- CreateIndex
CREATE INDEX "workflow_runs_organizationId_correlationId_idx" ON "workflow_runs"("organizationId", "correlationId");

-- CreateIndex
CREATE INDEX "workflow_runs_correlationId_idx" ON "workflow_runs"("correlationId");

-- CreateIndex
CREATE INDEX "workflow_step_runs_organizationId_idx" ON "workflow_step_runs"("organizationId");

-- CreateIndex
CREATE INDEX "workflow_step_runs_workflowRunId_idx" ON "workflow_step_runs"("workflowRunId");

-- CreateIndex
CREATE INDEX "workflow_step_runs_organizationId_workflowRunId_idx" ON "workflow_step_runs"("organizationId", "workflowRunId");

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
