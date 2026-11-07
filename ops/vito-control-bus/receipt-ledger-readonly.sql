-- VITO CEG · CONTROL BUS read-receipt projection · PRIVATE OWNER-ONLY CANDIDATE
-- NO WRITES, NO TRUSTED AGENT ID, NO EXECUTION ACK, NO CUSTOMER DATA.
-- The underlying table has no organization_id / tenant ACL. Do not expose
-- this query to tenants or an unguarded public API.
WITH dispatches AS (
  SELECT m.id, m.recipient, m.topic, m.subject, m.created_at
  FROM vito_control_bus_v1.messages AS m
  WHERE m.sender = 'vito'
    AND m.recipient IN ('adoren','emporio','urtali','bridge','selecta','lavolpe','bob','riccardo')
    AND m.topic IN ('task','handoff')
),
recorded_receipts AS (
  SELECT
    d.id AS dispatch_id,
    r.id AS receipt_id,
    r.created_at AS receipt_created_at
  FROM dispatches AS d
  JOIN vito_control_bus_v1.messages AS r
    ON r.sender = d.recipient
   AND r.recipient = 'vito'
   AND r.topic = 'report'
   AND r.details ->> 'in_reply_to' = d.id::text
   AND r.details ->> 'receipt_state' = 'RECEIVED'
   -- Receipt format can vary; no cryptographic signer is assumed.
   -- The status below is ALWAYS unverified, even when a receipt row exists.
),
receipt_latest AS (
  SELECT dispatch_id, MAX(receipt_id) AS receipt_id
  FROM recorded_receipts
  GROUP BY dispatch_id
)
SELECT
  d.id AS dispatch_id,
  d.recipient AS fachbereich,
  d.topic,
  d.subject,
  d.created_at AS dispatched_at,
  r.receipt_id,
  CASE
    WHEN r.receipt_id IS NOT NULL THEN 'RECEIPT_REPORTED_UNVERIFIED_SENDER'
    ELSE 'DISPATCHED_NOT_ACKNOWLEDGED'
  END AS receipt_status,
  FALSE AS authenticated_agent_ack,
  FALSE AS execution_verified,
  FALSE AS owner_release_approved
FROM dispatches AS d
LEFT JOIN receipt_latest AS r ON r.dispatch_id = d.id
ORDER BY d.id DESC
LIMIT 100;
