-- ============================================================
-- Daily-rollup RPC for the /billing sparkline.
--
-- The /v1/admin/billing endpoint renders a 30-day per-project
-- sparkline of `reports_ingested` events on every page load.
-- Until 2026-05-08 it pulled raw rows from `usage_events` and
-- aggregated client-side, which Copilot flagged as a hot-spot:
-- chatty projects (>10k events/day) shipped tens of thousands of
-- rows over the wire to produce 30 daily counts. For a 30-project
-- workspace at p99 ingestion that's a multi-MB payload + extra
-- CPU per request.
--
-- This RPC pushes the aggregation into Postgres. With the existing
-- `idx_usage_events_project_event (project_id, event_name,
-- occurred_at)` index, the query is an index range scan + GROUP BY
-- and returns at most `len(p_project_ids) × 30` rows regardless of
-- the underlying event volume.
--
-- Call shape (used by billing-projects-queue-graph.ts):
--   const { data } = await db.rpc(
--     'billing_reports_ingested_daily_rollup',
--     { p_project_ids: projectIds, p_since: thirtyAgo.toISOString() }
--   )
-- → [{ project_id, day_utc, total }, ...]
-- ============================================================

CREATE OR REPLACE FUNCTION public.billing_reports_ingested_daily_rollup(
  p_project_ids uuid[],
  p_since timestamptz
)
RETURNS TABLE (
  project_id uuid,
  day_utc    date,
  total      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- We do NOT filter by user/org here because the caller
  -- (billing-projects-queue-graph.ts) has already applied
  -- ownership filtering via `ownedProjectIds(db, userId)` before
  -- it builds `p_project_ids`. That pattern matches every other
  -- billing-side RPC in this repo (cf. `billing_usage_unsynced_summary`
  -- in 20260418001800_billing.sql, which is also SECURITY DEFINER
  -- and trusts the service-role caller to have authorised the
  -- inputs).
  --
  -- date_trunc('day', occurred_at AT TIME ZONE 'UTC') is the
  -- canonical form for "what UTC day did this event land on?". We
  -- cast the truncated timestamp back to `date` so the FE gets
  -- a stable YYYY-MM-DD key it can join with the pre-seeded
  -- 30-entry sparkline domain on the backend.
  SELECT
    ue.project_id,
    (date_trunc('day', ue.occurred_at AT TIME ZONE 'UTC'))::date AS day_utc,
    SUM(ue.quantity)::bigint AS total
  FROM public.usage_events ue
  WHERE ue.project_id = ANY (p_project_ids)
    AND ue.event_name = 'reports_ingested'
    AND ue.occurred_at >= p_since
  GROUP BY 1, 2
  ORDER BY 1, 2
$$;

-- Service-role only — admin endpoints invoke via the service client.
-- Authenticated users hit /v1/admin/billing through the gateway,
-- which already authorises them and then calls this with the
-- already-filtered project list.
REVOKE ALL ON FUNCTION public.billing_reports_ingested_daily_rollup(uuid[], timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_reports_ingested_daily_rollup(uuid[], timestamptz)
  TO service_role, postgres;

COMMENT ON FUNCTION public.billing_reports_ingested_daily_rollup(uuid[], timestamptz) IS
  'Per-project per-UTC-day SUM(quantity) of reports_ingested events since p_since. Returns at most n_projects × n_days rows. Used by /v1/admin/billing to drive the per-project sparkline without dragging raw events over the wire.';

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
