-- PRIVATE MIGRATION CANDIDATE ONLY. DO NOT EXECUTE IN PROD/STAGING.
-- VITO OWNER APPROVAL + backup + transaction + grants/RLS review required.
-- Based on actual pg_get_constraintdef on 2026-11-06.
-- This adds 'time' without altering existing addresses.
BEGIN;
ALTER TABLE vito_control_bus_v1.messages
  DROP CONSTRAINT messages_sender_check,
  ADD CONSTRAINT messages_sender_check
  CHECK (sender = ANY (ARRAY['vito','owner','adoren','emporio','selecta','urtali','lavolpe','bridge','bob','riccardo','time']::text[]));
ALTER TABLE vito_control_bus_v1.messages
  DROP CONSTRAINT messages_recipient_check,
  ADD CONSTRAINT messages_recipient_check
  CHECK (recipient = ANY (ARRAY['vito','owner','adoren','emporio','selecta','urtali','lavolpe','bridge','bob','riccardo','all','time']::text[]));
-- No grants added here. New actor requires least-privilege role and
-- preapproved org/scope and sender authenticity controls before GO.
-- The existing unique(sender,idempotency_key) and recipient/id index stay unchanged.
ROLLBACK; -- intentional dry-run template; never replace with COMMIT without approval
