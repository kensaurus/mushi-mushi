-- Migration: 20260612000000_report_ingest_burst_rate_limit
-- Adds per-project burst rate limiting for POST /v1/reports, POST /v1/reports/batch,
-- and POST /v1/ingest/spans (introduced in Phase 4).
--
-- Design:
--   • Uses the existing scoped_rate_limits table (actor = project_id::uuid, scope text).
--   • scoped_rate_limit_claim already exists (20260423010000_wave_s_hardening).
--     We add a project-flavoured wrapper + configurable per-project cap.
--   • Default: 120 reports/minute per project (generous for real-use, prevents DDoS
--     via compromised/leaked SDK keys).
--   • Configurable via project_settings.report_ingest_max_per_minute (NULL = default).
--
-- The edge function calls:
--   SELECT public.report_ingest_rate_limit_claim(p_project_id, p_max_per_minute);
-- which raises 'rate_limit_exceeded' (P0001) on breach. The route catches it and
-- returns 429.

-- ── 1. Project-keyed burst-rate-limit wrapper ───────────────────────────────

CREATE OR REPLACE FUNCTION public.report_ingest_rate_limit_claim(
  p_project_id uuid,
  p_max_per_minute integer DEFAULT 120
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Delegate to the generic scoped_rate_limit_claim using the project_id as actor
  -- and a 1-minute sliding window.
  RETURN public.scoped_rate_limit_claim(
    p_project_id,
    'report_ingest',
    p_max_per_minute,
    INTERVAL '1 minute'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.report_ingest_rate_limit_claim(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_ingest_rate_limit_claim(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.report_ingest_rate_limit_claim(uuid, integer) IS
  'Per-project burst rate-limit for SDK report ingestion. Default cap: 120/min. '
  'Raises P0001 rate_limit_exceeded when the cap is breached.';

-- ── 2. Configurable per-project cap column ──────────────────────────────────

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS report_ingest_max_per_minute integer;

COMMENT ON COLUMN public.project_settings.report_ingest_max_per_minute IS
  'Override for the default 120-reports/minute burst cap on POST /v1/reports. '
  'NULL = use the platform default. Enterprise projects may raise this; hobby projects '
  'may lower it as an abuse-prevention measure.';

-- ── 3. Notify PostgREST of schema change ────────────────────────────────────
NOTIFY pgrst, 'reload schema';
