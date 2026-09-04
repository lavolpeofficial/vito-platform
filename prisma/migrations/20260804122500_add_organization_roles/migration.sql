CREATE TYPE "OrganizationRoleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED', 'ARCHIVED');

CREATE TABLE "organization_roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "OrganizationRoleStatus" NOT NULL DEFAULT 'DRAFT',
    "responsibilities" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_roles_organizationId_code_key"
ON "organization_roles"("organizationId", "code");

CREATE INDEX "organization_roles_organizationId_idx"
ON "organization_roles"("organizationId");

ALTER TABLE "organization_roles"
ADD CONSTRAINT "organization_roles_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
