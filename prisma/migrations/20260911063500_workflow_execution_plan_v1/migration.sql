-- Workflow Execution Plan v1
-- Server-owned, tenant-scoped binding from a persisted engineering workflow step
-- type to an existing provider-independent EngineeringCapability code.

CREATE TABLE "workflow_execution_plan_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "stepType" "EngineeringStepType" NOT NULL,
    "capabilityCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_execution_plan_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_execution_plan_entries_org_run_step_key"
    ON "workflow_execution_plan_entries"("organizationId", "workflowRunId", "stepType");

CREATE INDEX "workflow_execution_plan_entries_org_run_idx"
    ON "workflow_execution_plan_entries"("organizationId", "workflowRunId");

CREATE INDEX "workflow_execution_plan_entries_org_capability_idx"
    ON "workflow_execution_plan_entries"("organizationId", "capabilityCode");

ALTER TABLE "workflow_execution_plan_entries"
    ADD CONSTRAINT "workflow_execution_plan_entries_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_execution_plan_entries"
    ADD CONSTRAINT "workflow_execution_plan_entries_workflowRunId_fkey"
    FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
