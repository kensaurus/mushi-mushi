-- =============================================================================
-- Free Production Check + public scoreboard (docs/plan-gtm-november-2026.md §6).
--
-- 1. production_checks: one row per check of a stranger's live site, run on
--    Mushi's own Firecrawl key from public pages only
--    (POST /v1/public/production-check, api/routes/production-check.ts).
--    Service role only: no policy for anon or authenticated, so every read
--    and write goes through the api-ext routes. The raw IP is never stored,
--    only a salted SHA-256 (ip_hash). The email is kept only when given and
--    cleared once the report email went out. retention-sweep deletes rows
--    after 90 days.
-- 2. production_check_begin(): the per-origin claim. Under a transaction lock
--    on the origin it returns the check of that origin from the last 24 h
--    (finished, or still running for under 2 minutes), or inserts a new one.
--    Two concurrent POSTs for one site cannot both spend Firecrawl credits.
-- 3. public_scoreboard(): aggregates only, for GET /v1/public/scoreboard. The
--    owner's own apps are the projects of organizations with
--    billing_mode = 'complimentary'. No app names, report text or user data
--    leave the function; reporters are counted, never listed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.production_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin      text NOT NULL CHECK (char_length(origin) <= 300),
  url         text NOT NULL CHECK (char_length(url) <= 2048),
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  findings    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Pages checked (path + HTTP status), headers seen, link and script counts.
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text CHECK (error IS NULL OR char_length(error) <= 300),
  email       text CHECK (email IS NULL OR char_length(email) <= 254),
  email_sent_at timestamptz,
  src         text CHECK (src IS NULL OR char_length(src) <= 64),
  ip_hash     text CHECK (ip_hash IS NULL OR char_length(ip_hash) <= 64),
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_production_checks_origin_created
  ON public.production_checks (origin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_checks_created
  ON public.production_checks (created_at);

ALTER TABLE public.production_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS production_checks_service_all ON public.production_checks;
CREATE POLICY production_checks_service_all ON public.production_checks
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.production_checks FROM anon, authenticated;

COMMENT ON TABLE public.production_checks IS
  'Free Production Check of a public site (docs site /check). Service role only; ip_hash is a salted SHA-256, never the IP; email only when given and cleared after the one report email; deleted after 90 days by retention-sweep.';

CREATE OR REPLACE FUNCTION public.production_check_begin(
  p_origin  text,
  p_url     text,
  p_ip_hash text,
  p_email   text,
  p_src     text
) RETURNS TABLE (check_id uuid, cached boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('production_check:' || p_origin, 0));

  SELECT pc.id INTO v_id
    FROM public.production_checks pc
   WHERE pc.origin = p_origin
     AND pc.created_at > now() - interval '24 hours'
     AND (pc.status = 'done' OR (pc.status = 'running' AND pc.created_at > now() - interval '2 minutes'))
   ORDER BY pc.created_at DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true;
    RETURN;
  END IF;

  INSERT INTO public.production_checks (origin, url, ip_hash, email, src)
  VALUES (p_origin, p_url, p_ip_hash, p_email, p_src)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.production_check_begin(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_check_begin(text, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.public_scoreboard(p_days integer DEFAULT 60)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH window_start AS (
    SELECT now() - make_interval(days => greatest(1, least(coalesce(p_days, 60), 365))) AS t
  ),
  own AS (
    SELECT p.id
      FROM public.projects p
      JOIN public.organizations o ON o.id = p.organization_id
     WHERE o.billing_mode = 'complimentary'
  ),
  user_reports AS (
    SELECT r.reporter_token_hash
      FROM public.reports r
     WHERE r.project_id IN (SELECT id FROM own)
       AND r.source = 'widget'
       AND r.created_at >= (SELECT t FROM window_start)
  ),
  merged AS (
    SELECT fa.report_id, fa.merged_at
      FROM public.fix_attempts fa
     WHERE fa.project_id IN (SELECT id FROM own)
       AND fa.merged_at >= (SELECT t FROM window_start)
  ),
  first_merge AS (
    SELECT DISTINCT ON (m.report_id) m.merged_at, rep.created_at AS reported_at
      FROM merged m
      JOIN public.reports rep ON rep.id = m.report_id
     ORDER BY m.report_id, m.merged_at
  ),
  reviews AS (
    SELECT fr.verdict
      FROM public.fix_reviews fr
     WHERE fr.project_id IN (SELECT id FROM own)
       AND fr.status = 'completed'
       AND fr.completed_at >= (SELECT t FROM window_start)
  ),
  weeks AS (
    SELECT generate_series(
      date_trunc('week', (SELECT t FROM window_start)),
      date_trunc('week', now()),
      interval '1 week'
    ) AS week_start
  )
  SELECT jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 60), 365)),
    'apps', (SELECT count(*) FROM own),
    'user_reports', (SELECT count(*) FROM user_reports),
    'reporters', (SELECT count(DISTINCT reporter_token_hash) FROM user_reports),
    'fixes_merged', (SELECT count(*) FROM merged),
    'reviews', (SELECT count(*) FROM reviews),
    'reviews_hold', (SELECT count(*) FROM reviews WHERE verdict = 'hold'),
    'median_hours_to_merged_fix', (
      SELECT round((percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM fm.merged_at - fm.reported_at) / 3600.0
      ))::numeric, 1)
        FROM first_merge fm
    ),
    'weekly_merged', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'week_start', to_char(w.week_start, 'YYYY-MM-DD'),
        'merged', (SELECT count(*) FROM merged m
                    WHERE m.merged_at >= w.week_start AND m.merged_at < w.week_start + interval '1 week')
      ) ORDER BY w.week_start), '[]'::jsonb)
        FROM weeks w
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.public_scoreboard(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_scoreboard(integer) TO service_role;

COMMENT ON FUNCTION public.public_scoreboard(integer) IS
  'Aggregate numbers for the public /proof page: the owner''s own apps (organizations.billing_mode = complimentary), last p_days days. Counts and a median only; service role only.';
