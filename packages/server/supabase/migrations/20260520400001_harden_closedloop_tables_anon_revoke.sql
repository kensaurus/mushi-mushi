-- FILE: 20260520400000_harden_closedloop_tables_anon_revoke.sql
-- PURPOSE: Revoke direct anon + authenticated SELECT access on all closed-loop
--   admin tables introduced in the 20260520 migration batch.
--
--   These tables are admin-only surfaces (PDCA runs, drift findings, experiments,
--   anomaly detections, cost records, etc.). The only authorised read path is via
--   service-role edge functions (the `api` function with JWT auth). Granting
--   SELECT to `anon` and `authenticated` via the REST/GraphQL API is unnecessary
--   and surfaces internal data in the Supabase GraphQL schema.
--
--   The service_role policies on each table remain intact — edge functions that
--   use the service-role client key are unaffected.

REVOKE SELECT ON TABLE public.mistake_clusters          FROM anon, authenticated;
REVOKE SELECT ON TABLE public.report_cluster_membership FROM anon, authenticated;
REVOKE SELECT ON TABLE public.lessons                   FROM anon, authenticated;
REVOKE SELECT ON TABLE public.releases                  FROM anon, authenticated;
REVOKE SELECT ON TABLE public.release_credits           FROM anon, authenticated;
REVOKE SELECT ON TABLE public.pdca_runs                 FROM anon, authenticated;
REVOKE SELECT ON TABLE public.pdca_iterations           FROM anon, authenticated;
REVOKE SELECT ON TABLE public.contract_snapshots        FROM anon, authenticated;
REVOKE SELECT ON TABLE public.drift_findings            FROM anon, authenticated;
REVOKE SELECT ON TABLE public.experiments               FROM anon, authenticated;
REVOKE SELECT ON TABLE public.experiment_variants       FROM anon, authenticated;
REVOKE SELECT ON TABLE public.experiment_assignments    FROM anon, authenticated;
REVOKE SELECT ON TABLE public.metric_series             FROM anon, authenticated;
REVOKE SELECT ON TABLE public.anomaly_detections        FROM anon, authenticated;
REVOKE SELECT ON TABLE public.llm_cost_usd              FROM anon, authenticated;

-- match_lessons is a SECURITY DEFINER function used by the MCP tool
-- (authenticated callers via the mcp edge function). Revoke from anon only.
REVOKE EXECUTE ON FUNCTION public.match_lessons(
  extensions.vector, double precision, integer, uuid
) FROM anon;
