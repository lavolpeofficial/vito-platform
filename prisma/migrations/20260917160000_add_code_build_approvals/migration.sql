CREATE TABLE "code_build_approvals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "approvalRequestKey" TEXT NOT NULL,
    "approvalRequestHash" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "consumedByUserId" TEXT,
    "consumptionRequestKey" TEXT,
    "consumptionRequestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "code_build_approvals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "code_build_approvals_expiry_check" CHECK ("expiresAt" > "approvedAt"),
    CONSTRAINT "code_build_approvals_repository_check" CHECK ("repository" = 'lavolpeofficial/vito-platform'),
    CONSTRAINT "code_build_approvals_branch_check" CHECK ("branch" ~ '^feat/[a-z0-9][a-z0-9-]*$'),
    CONSTRAINT "code_build_approvals_revocation_check" CHECK (("revokedAt" IS NULL) = ("revokedByUserId" IS NULL)),
    CONSTRAINT "code_build_approvals_consumption_check" CHECK (("consumedAt" IS NULL AND "consumedByUserId" IS NULL AND "consumptionRequestKey" IS NULL AND "consumptionRequestHash" IS NULL) OR ("consumedAt" IS NOT NULL AND "consumedByUserId" IS NOT NULL AND "consumptionRequestKey" IS NOT NULL AND "consumptionRequestHash" IS NOT NULL))
);
CREATE UNIQUE INDEX "code_build_approvals_organizationId_approvalRequestKey_key" ON "code_build_approvals"("organizationId", "approvalRequestKey");
CREATE UNIQUE INDEX "code_build_approvals_organizationId_consumptionRequestKey_key" ON "code_build_approvals"("organizationId", "consumptionRequestKey");
CREATE INDEX "code_build_approvals_scope_idx" ON "code_build_approvals"("organizationId", "missionId", "repository", "branch");
CREATE INDEX "code_build_approvals_expiry_idx" ON "code_build_approvals"("organizationId", "expiresAt");
ALTER TABLE "code_build_approvals" ADD CONSTRAINT "code_build_approvals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "code_build_approvals" ADD CONSTRAINT "code_build_approvals_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "code_build_approvals" ADD CONSTRAINT "code_build_approvals_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "code_build_approvals" ADD CONSTRAINT "code_build_approvals_consumedByUserId_fkey" FOREIGN KEY ("consumedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
