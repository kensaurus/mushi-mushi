-- Migration: 20260612020000_backend_spans
--
-- Adds the backend_spans table for the OTel trace-correlation feature (Phase 4).
-- The mushi Node SDK middleware posts spans here via POST /v1/ingest/spans so that
-- the admin console can correlate a frontend bug report (which carries a W3C
-- traceparent + x-mushi-session header) with the corresponding backend span.
--
-- Volume management:
--   • 14-day TTL enforced by a daily pg_cron job (mushi-backend-spans-ttl-sweep).
--   • Hard cap of 10 000 spans / 24 h per project enforced in the edge function.
--   • Index on (project_id, trace_id) for O(1) lookup from the report-detail view.

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.backend_spans (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  trace_id      text        NOT NULL,    -- 32-char lowercase hex (W3C)
  session_id    text,                    -- x-mushi-session value (nullable; set by node SDK)
  span_json     jsonb       NOT NULL,    -- { spanId, parentSpanId, name, status, duration_ms, attributes }
  ingested_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backend_spans_project_trace
  ON public.backend_spans (project_id, trace_id);

CREATE INDEX IF NOT EXISTS idx_backend_spans_ingested_at
  ON public.backend_spans (ingested_at DESC);

ALTER TABLE public.backend_spans ENABLE ROW LEVEL SECURITY;

-- Authenticated admin users can read spans for projects they are members of.
DROP POLICY IF EXISTS "backend_spans_member_select" ON public.backend_spans;
CREATE POLICY "backend_spans_member_select"
  ON public.backend_spans FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p
      JOIN public.project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = auth.uid()
    )
  );

-- SDK ingest via service_role (edge function apiKeyAuth → service client).
DROP POLICY IF EXISTS "backend_spans_service_write" ON public.backend_spans;
CREATE POLICY "backend_spans_service_write"
  ON public.backend_spans FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── TTL sweep ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mushi_sweep_backend_spans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.backend_spans
  WHERE ingested_at < now() - INTERVAL '14 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.mushi_sweep_backend_spans() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mushi_sweep_backend_spans() TO service_role;

COMMENT ON FUNCTION public.mushi_sweep_backend_spans() IS
  'Deletes backend_spans older than 14 days. Invoked daily by pg_cron.';

-- Schedule TTL sweep at 02:17 UTC (off-peak, staggered from other crons).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove stale job if it exists under an old name.
    PERFORM cron.unschedule(jobname)
    FROM cron.job
    WHERE jobname = 'mushi-backend-spans-ttl-sweep';

    PERFORM cron.schedule(
      'mushi-backend-spans-ttl-sweep',
      '17 2 * * *',
      $cronq$
        SELECT public.mushi_sweep_backend_spans();
      $cronq$
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed; skipping backend_spans TTL sweep schedule.';
  END IF;
END;
$$;

COMMENT ON TABLE public.backend_spans IS
  'Short-lived backend spans posted by the mushi Node SDK middleware. Each span '
  'carries a W3C trace_id matching the traceparent header injected by the web SDK, '
  'allowing the admin console to correlate a bug report''s failed network entry with '
  'the backend execution that served it. Hard TTL: 14 days.';

-- ── Notify PostgREST ─────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
