CREATE TYPE "PositionStatus" AS ENUM ('DRAFT', 'OPEN', 'OCCUPIED', 'VACANT', 'ARCHIVED');

CREATE TABLE "positions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workforceInstanceId" TEXT NOT NULL,
  "departmentId" TEXT,
  "teamId" TEXT,
  "organizationRoleId" TEXT NOT NULL,
  "managerPositionId" TEXT,
  "occupantEmployeeId" TEXT,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "PositionStatus" NOT NULL DEFAULT 'DRAFT',
  "isLeadership" BOOLEAN NOT NULL DEFAULT false,
  "budgetResponsibility" DECIMAL(18,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "positions_occupantEmployeeId_key" ON "positions"("occupantEmployeeId");
CREATE UNIQUE INDEX "positions_workforceInstanceId_code_key" ON "positions"("workforceInstanceId", "code");
CREATE INDEX "positions_organizationId_idx" ON "positions"("organizationId");
CREATE INDEX "positions_workforceInstanceId_idx" ON "positions"("workforceInstanceId");
CREATE INDEX "positions_departmentId_idx" ON "positions"("departmentId");
CREATE INDEX "positions_teamId_idx" ON "positions"("teamId");
CREATE INDEX "positions_organizationRoleId_idx" ON "positions"("organizationRoleId");
CREATE INDEX "positions_managerPositionId_idx" ON "positions"("managerPositionId");

ALTER TABLE "positions" ADD CONSTRAINT "positions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "positions" ADD CONSTRAINT "positions_workforceInstanceId_fkey" FOREIGN KEY ("workforceInstanceId") REFERENCES "workforce_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "positions" ADD CONSTRAINT "positions_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "positions" ADD CONSTRAINT "positions_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "positions" ADD CONSTRAINT "positions_organizationRoleId_fkey" FOREIGN KEY ("organizationRoleId") REFERENCES "organization_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "positions" ADD CONSTRAINT "positions_managerPositionId_fkey" FOREIGN KEY ("managerPositionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "positions" ADD CONSTRAINT "positions_occupantEmployeeId_fkey" FOREIGN KEY ("occupantEmployeeId") REFERENCES "digital_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
