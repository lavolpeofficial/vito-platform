CREATE TABLE "workflow_verifications" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workflowRunId" TEXT NOT NULL,
  "workflowStepRunId" TEXT NOT NULL,
  "stepType" TEXT NOT NULL,
  "ruleCode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_verifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_verifications_status_check" CHECK ("status" IN ('VERIFIED','FAILED','INCONCLUSIVE','BLOCKED')),
  CONSTRAINT "workflow_verifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workflow_verifications_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workflow_verifications_workflowStepRunId_fkey" FOREIGN KEY ("workflowStepRunId") REFERENCES "workflow_step_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workflow_verifications_org_step_rule_key"
  ON "workflow_verifications"("organizationId", "workflowStepRunId", "ruleCode");
CREATE INDEX "workflow_verifications_org_run_status_idx"
  ON "workflow_verifications"("organizationId", "workflowRunId", "status");
CREATE INDEX "workflow_verifications_org_step_idx"
  ON "workflow_verifications"("organizationId", "workflowStepRunId");
