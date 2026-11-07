-- VITO ONE COCKPIT A4 · additive, Owner-only reports projection.
-- Applied on existing Neon staging-synthetic branch 07 Nov 2026.
-- No raw details JSON, passwords, idempotency keys or customer content.
-- No public/multi-tenant exposure: underlying messages have no organization_id.
CREATE VIEW vito_control_bus_v1.owner_specialist_reports_projection_v1
WITH (security_barrier=true)
AS
SELECT
  id AS report_id,
  sender AS specialist,
  LEFT(subject,160) AS subject,
  CASE WHEN COALESCE(details->>'status','') ~ '^[A-Z0-9_:-]{1,80}$'
       THEN details->>'status' ELSE NULL END AS reported_status,
  created_at AS reported_at
FROM vito_control_bus_v1.messages
WHERE recipient='vito' AND topic='report'
  AND sender IN ('adoren','emporio','urtali','bridge','selecta','lavolpe','bob','riccardo')
ORDER BY id DESC
LIMIT 50;

-- Explicitly scoped to the already proven view-only role.
GRANT SELECT ON vito_control_bus_v1.owner_specialist_reports_projection_v1
  TO vito_cockpit_reader_a3;

-- Required post-migration proof:
-- SELECT current_user, has_table_privilege(current_user,
--   'vito_control_bus_v1.owner_specialist_reports_projection_v1','SELECT');
-- Verify the reader still has no SELECT/INSERT/UPDATE/DELETE on messages.
-- A specialist's sender label / reported status is NOT authenticated proof.
