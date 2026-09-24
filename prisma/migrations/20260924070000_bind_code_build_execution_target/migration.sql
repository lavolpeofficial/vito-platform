-- Bind each consumed CODE_BUILD approval to the immutable server-resolved execution target.
-- Nullable columns preserve compatibility for existing approval rows and the non-dispatch consume endpoint.
ALTER TABLE "code_build_approvals"
  ADD COLUMN "executionTargetHash" TEXT,
  ADD COLUMN "executionTarget" JSONB;

CREATE INDEX "code_build_approvals_organizationId_executionTargetHash_idx"
  ON "code_build_approvals"("organizationId", "executionTargetHash");
