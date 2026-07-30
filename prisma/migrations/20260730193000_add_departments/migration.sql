CREATE TYPE "DepartmentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workforceInstanceId" TEXT NOT NULL,
    "parentDepartmentId" TEXT,
    "managerEmployeeId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "DepartmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "departments_workforceInstanceId_code_key"
ON "departments"("workforceInstanceId", "code");

CREATE INDEX "departments_organizationId_idx" ON "departments"("organizationId");
CREATE INDEX "departments_workforceInstanceId_idx" ON "departments"("workforceInstanceId");
CREATE INDEX "departments_parentDepartmentId_idx" ON "departments"("parentDepartmentId");
CREATE INDEX "departments_managerEmployeeId_idx" ON "departments"("managerEmployeeId");

ALTER TABLE "departments"
ADD CONSTRAINT "departments_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "departments"
ADD CONSTRAINT "departments_workforceInstanceId_fkey"
FOREIGN KEY ("workforceInstanceId") REFERENCES "workforce_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "departments"
ADD CONSTRAINT "departments_parentDepartmentId_fkey"
FOREIGN KEY ("parentDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "departments"
ADD CONSTRAINT "departments_managerEmployeeId_fkey"
FOREIGN KEY ("managerEmployeeId") REFERENCES "digital_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
