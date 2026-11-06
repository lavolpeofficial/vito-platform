-- PRIVATE DESIGN PROPOSAL ONLY, NOT EXECUTED. Independent owner/schema gate.
-- This is a per-message handling receipt, NOT a VITO task/workflow database.
BEGIN;
CREATE TABLE vito_control_bus_v1.time_inbox_receipts (
  message_id bigint PRIMARY KEY REFERENCES vito_control_bus_v1.messages(id),
  organization_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('CLAIMED','HANDLED','REVIEW_REQUIRED','UNKNOWN')),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  evidence_ref text,
  CHECK (evidence_ref IS NULL OR length(evidence_ref) BETWEEN 8 AND 160)
);
-- No RLS policy is given here; closed by default until a separately audited role/policy exists.
ALTER TABLE vito_control_bus_v1.time_inbox_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vito_control_bus_v1.time_inbox_receipts FORCE ROW LEVEL SECURITY;
COMMIT;
-- Future atomic claim must use INSERT ... ON CONFLICT(message_id) DO NOTHING RETURNING message_id.
-- No receiver may perform actions without a fresh owner-approved VITO task and audit proof.
