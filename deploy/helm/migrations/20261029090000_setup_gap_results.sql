-- =============================================================================
-- The last setup-gaps answer per app (GET /v1/admin/setup-gaps).
--
-- The route cached each app's checks in isolate memory only, so most visits
-- landed on a cold isolate and waited 4–9 s for GitHub (console sweep #37,
-- measured 2026-10-29). This table keeps the last answer across isolates: an
-- answer under 10 minutes old is served as is, an older one (under a day) is
-- shown at once and re-checked in the background.
--
-- Service role only. `value` is the route's own response for one app (gap
-- lines in plain words; no tokens, keys or repository content).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.setup_gap_results (
  project_id  uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  value       jsonb NOT NULL,
  checked_at  timestamptz NOT NULL
);

ALTER TABLE public.setup_gap_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS setup_gap_results_service_all ON public.setup_gap_results;
CREATE POLICY setup_gap_results_service_all ON public.setup_gap_results
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.setup_gap_results FROM anon, authenticated;

COMMENT ON TABLE public.setup_gap_results IS
  'Last GET /v1/admin/setup-gaps answer per app, shared across edge isolates (sweep #37). Service role only.';
