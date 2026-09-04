CREATE TYPE "TeamStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

CREATE TABLE "teams" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workforceInstanceId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "managerEmployeeId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "TeamStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "teams_departmentId_code_key" ON "teams"("departmentId", "code");
CREATE INDEX "teams_organizationId_idx" ON "teams"("organizationId");
CREATE INDEX "teams_workforceInstanceId_idx" ON "teams"("workforceInstanceId");
CREATE INDEX "teams_departmentId_idx" ON "teams"("departmentId");
CREATE INDEX "teams_managerEmployeeId_idx" ON "teams"("managerEmployeeId");

ALTER TABLE "teams" ADD CONSTRAINT "teams_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_workforceInstanceId_fkey" FOREIGN KEY ("workforceInstanceId") REFERENCES "workforce_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_managerEmployeeId_fkey" FOREIGN KEY ("managerEmployeeId") REFERENCES "digital_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
