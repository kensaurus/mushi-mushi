-- FILE: 20260714050000_activity_dashboard_advisor_remediation.sql
--
-- Follow-up remediation for the security advisor findings raised against the
-- Activity dashboard / session tracking migrations (20260714035033,
-- 20260714041056, 20260714041554):
--
--   • project_activity_summary / org_portfolio_summary are SECURITY DEFINER
--     RPCs only ever called from the jwtAuth-gated /v1/admin/activity and
--     /v1/admin/portfolio edge function routes via the service-role client.
--     No browser code calls them with the anon key, so anon execute is a
--     pure privilege-escalation surface (same pattern as
--     20260511120500_revoke_anon_security_definer.sql).
--   • Both functions carried their default PUBLIC EXECUTE grant (never
--     explicitly revoked in the RPC migration), which anon inherits via
--     implicit PUBLIC membership — a plain `REVOKE ... FROM anon` is a
--     no-op against that. Revoke from PUBLIC and grant explicitly instead.
--   • end_user_sessions.end_user_id lacked a covering index for its FK.

REVOKE EXECUTE ON FUNCTION public.project_activity_summary(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.org_portfolio_summary(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.project_activity_summary(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_portfolio_summary(uuid) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS end_user_sessions_end_user_id_idx
  ON public.end_user_sessions (end_user_id);
