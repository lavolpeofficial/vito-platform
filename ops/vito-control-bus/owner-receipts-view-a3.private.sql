-- VITO ONE COCKPIT A3 · OWNER-only CONTROL BUS projection candidate.
-- PRIVATE / NOT EXECUTED. Owner must separately authorize DB migration & a
-- dedicated view-only login role; never run with the shared Neon owner.
-- The messages table has no organization_id. A general multi-tenant reader
-- is therefore UNSAFE. The API must require one explicit Owner org UUID.
--
-- SECURITY DEFINER behavior of a PostgreSQL view permits a role to SELECT
-- only the view, without SELECT on the underlying messages table. The view
-- emits no details JSON, tokens, idempotency keys, or arbitrary sender texts.
-- Role creation, GRANTs and schema publication require separate Owner GO.
--
-- CREATE OR REPLACE VIEW vito_control_bus_v1.owner_receipts_projection_v1
-- WITH (security_barrier = true) AS
WITH dispatches AS (
  SELECT id, recipient, topic, subject, created_at
  FROM vito_control_bus_v1.messages
  WHERE sender = 'vito'
    AND topic IN ('handoff', 'task')
    AND recipient IN ('emporio','adoren','urtali','bridge','selecta','lavolpe','bob','riccardo')
  ORDER BY id DESC
  LIMIT 100
)
SELECT
  d.id AS dispatch_id,
  d.recipient,
  d.topic,
  d.subject,
  d.created_at AS dispatched_at,
  latest.id AS receipt_id
FROM dispatches d
LEFT JOIN LATERAL (
  SELECT r.id
  FROM vito_control_bus_v1.messages r
  WHERE r.sender = d.recipient
    AND r.recipient = 'vito'
    AND r.topic = 'report'
    AND r.details ->> 'in_reply_to' = d.id::text
    AND r.details ->> 'receipt_state' = 'RECEIVED'
  ORDER BY r.id DESC
  LIMIT 1
) latest ON true
ORDER BY d.id DESC;
-- End SELECT body for private verification.
--
-- DEPLOY ONLY AFTER APPROVAL:
-- 1. Operator creates the above VIEW using a privileged schema owner.
-- 2. Create distinct unprivileged LOGIN role with random password and no
--    membership in owner/creator roles. REVOKE all direct table privileges.
-- 3. GRANT USAGE ON SCHEMA vito_control_bus_v1 TO <dedicated_reader_role>;
--    GRANT SELECT ON vito_control_bus_v1.owner_receipts_projection_v1
--      TO <dedicated_reader_role>;
-- 4. Confirm no INSERT, UPDATE, DELETE or SELECT on messages (directly),
--    and no other unneeded database grants. Configure TLS + connection_limit=1.
-- 5. Bind exact Owner organization UUID on the VITO API runtime and enable
--    VITO_CONTROL_BUS_READER_ENABLED only after negative tenant checks.
-- 6. Not a cryptographic receipt; source sender remains unverified.
