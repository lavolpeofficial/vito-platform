CREATE TABLE "workflow_agent_assignments" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "workflow_run_id" TEXT NOT NULL,
  "step_type" TEXT NOT NULL,
  "capability_code" TEXT NOT NULL,
  "digital_employee_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'APPROVED',
  "approved_by_user_id" TEXT NOT NULL,
  "approval_ref" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_agent_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_agent_assignments_status_check" CHECK ("status" IN ('APPROVED', 'REVOKED')),
  CONSTRAINT "workflow_agent_assignments_run_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workflow_agent_assignments_employee_fk" FOREIGN KEY ("digital_employee_id") REFERENCES "digital_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workflow_agent_assignments_org_run_step_key"
  ON "workflow_agent_assignments"("organization_id", "workflow_run_id", "step_type");

CREATE INDEX "workflow_agent_assignments_employee_idx"
  ON "workflow_agent_assignments"("organization_id", "digital_employee_id", "status");
