-- Migration: 20261004120000_llm_window_aggregates.sql
-- PURPOSE: SQL aggregates for the console's LLM health and billing numbers.
--
-- /v1/admin/health/stats and /health/llm computed latency from at most the
-- newest 500 llm_invocations rows, and /v1/admin/billing/stats summed the
-- month's LLM cost from an unbounded row read (PostgREST caps it at 1000).
-- Call counts now come from exact head counts in the API; these two functions
-- return what a count cannot: latency avg / p95 over the whole window, and
-- the cost total. Both are additive and read-only.
--
-- The API falls back (and says the latency is a sample) until this migration
-- is applied, so the deploy order does not matter.
--
-- Service role only: copied/created functions get EXECUTE for anon and
-- authenticated through default privileges, so revoke it explicitly.

CREATE OR REPLACE FUNCTION public.llm_latency_window_stats(
  p_project_ids uuid[],
  p_since timestamptz
)
RETURNS TABLE (total_calls bigint, avg_latency_ms integer, p95_latency_ms integer)
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    count(*)::bigint AS total_calls,
    COALESCE(round(avg(COALESCE(latency_ms, 0)))::integer, 0) AS avg_latency_ms,
    COALESCE(
      (percentile_disc(0.95) WITHIN GROUP (ORDER BY COALESCE(latency_ms, 0)))::integer,
      0
    ) AS p95_latency_ms
  FROM public.llm_invocations
  WHERE project_id = ANY (p_project_ids)
    AND created_at >= p_since
$function$;

COMMENT ON FUNCTION public.llm_latency_window_stats(uuid[], timestamptz) IS
  'Average and p95 LLM latency (ms) over every call in the window. Used by /v1/admin/health/stats and /health/llm.';

CREATE OR REPLACE FUNCTION public.llm_cost_usd_since(
  p_project_id uuid,
  p_since timestamptz
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(sum(cost_usd), 0)::numeric
  FROM public.llm_invocations
  WHERE project_id = p_project_id
    AND created_at >= p_since
    AND cost_usd IS NOT NULL
$function$;

COMMENT ON FUNCTION public.llm_cost_usd_since(uuid, timestamptz) IS
  'Total recorded LLM cost (USD) for one project since a timestamp. Used by /v1/admin/billing/stats.';

REVOKE EXECUTE ON FUNCTION public.llm_latency_window_stats(uuid[], timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.llm_cost_usd_since(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.llm_latency_window_stats(uuid[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.llm_cost_usd_since(uuid, timestamptz) TO service_role;
