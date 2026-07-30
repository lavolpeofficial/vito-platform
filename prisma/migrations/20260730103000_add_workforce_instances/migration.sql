-- CreateEnum
CREATE TYPE "WorkforceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "workforce_instances" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkforceStatus" NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "orchestratorEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workforce_instances_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "digital_employees" ADD COLUMN "workforceInstanceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "workforce_instances_organizationId_code_key" ON "workforce_instances"("organizationId", "code");
CREATE INDEX "workforce_instances_organizationId_idx" ON "workforce_instances"("organizationId");
CREATE INDEX "workforce_instances_orchestratorEmployeeId_idx" ON "workforce_instances"("orchestratorEmployeeId");
CREATE INDEX "digital_employees_workforceInstanceId_idx" ON "digital_employees"("workforceInstanceId");

-- AddForeignKey
ALTER TABLE "workforce_instances" ADD CONSTRAINT "workforce_instances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workforce_instances" ADD CONSTRAINT "workforce_instances_orchestratorEmployeeId_fkey" FOREIGN KEY ("orchestratorEmployeeId") REFERENCES "digital_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "digital_employees" ADD CONSTRAINT "digital_employees_workforceInstanceId_fkey" FOREIGN KEY ("workforceInstanceId") REFERENCES "workforce_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
