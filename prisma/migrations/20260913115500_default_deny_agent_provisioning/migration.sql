-- Default-deny provisioning for governed engineering agents.
-- Existing rows are intentionally untouched; only defaults for future inserts change.
ALTER TABLE "agent_providers"
  ALTER COLUMN "status" SET DEFAULT 'DISABLED';

ALTER TABLE "provider_capabilities"
  ALTER COLUMN "isEnabled" SET DEFAULT false;

ALTER TABLE "digital_employee_capabilities"
  ALTER COLUMN "isEnabled" SET DEFAULT false;
