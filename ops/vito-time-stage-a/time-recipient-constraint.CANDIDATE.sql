-- VITO x URTALI TIME · PRIVATE MIGRATION CANDIDATE. NEVER RUN WITHOUT OWNER GO.
-- Additive address extension only; all original sender/recipient labels retained.
-- No GRANT, RLS, worker or deployment. A DB constraint is not sender authentication.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE s text; r text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO s FROM pg_constraint c
   JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE n.nspname='vito_control_bus_v1' AND t.relname='messages' AND c.conname='messages_sender_check';
  SELECT pg_get_constraintdef(c.oid) INTO r FROM pg_constraint c
   JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE n.nspname='vito_control_bus_v1' AND t.relname='messages' AND c.conname='messages_recipient_check';
  IF s IS DISTINCT FROM $expected$CHECK ((sender = ANY (ARRAY['vito'::text, 'owner'::text, 'adoren'::text, 'emporio'::text, 'selecta'::text, 'urtali'::text, 'lavolpe'::text, 'bridge'::text, 'bob'::text, 'riccardo'::text])))$expected$
     OR r IS DISTINCT FROM $expected$CHECK ((recipient = ANY (ARRAY['vito'::text, 'owner'::text, 'adoren'::text, 'emporio'::text, 'selecta'::text, 'urtali'::text, 'lavolpe'::text, 'bridge'::text, 'bob'::text, 'riccardo'::text, 'all'::text])))$expected$
  THEN RAISE EXCEPTION 'TIME constraint preflight drift: review latest schema before migration'; END IF;
END
$guard$;
ALTER TABLE vito_control_bus_v1.messages
  DROP CONSTRAINT messages_sender_check,
  DROP CONSTRAINT messages_recipient_check,
  ADD CONSTRAINT messages_sender_check CHECK (sender IN (
    'vito','owner','adoren','emporio','selecta','urtali','lavolpe','bridge','bob','riccardo','time')) NOT VALID,
  ADD CONSTRAINT messages_recipient_check CHECK (recipient IN (
    'vito','owner','adoren','emporio','selecta','urtali','lavolpe','bridge','bob','riccardo','all','time')) NOT VALID;
ALTER TABLE vito_control_bus_v1.messages VALIDATE CONSTRAINT messages_sender_check;
ALTER TABLE vito_control_bus_v1.messages VALIDATE CONSTRAINT messages_recipient_check;
COMMIT;
-- Post-release gate: verify pg_constraint, test isolated TIME message, verify all old routes.
-- WARNING: this statement does NOT establish tenancy, auth, delivery, or processing.
