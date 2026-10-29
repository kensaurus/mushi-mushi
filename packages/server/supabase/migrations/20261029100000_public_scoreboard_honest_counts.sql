-- =============================================================================
-- /proof counted Mushi's own reports as reports "from users" (2026-10-29).
--
-- public_scoreboard() took every widget report of the owner's complimentary
-- organizations as a user report. Most were not: 281 came from a backlog
-- import (each with its own reporter token, so "314 people" was mostly that
-- import), 243 from the AI audit loop, 74 from an automated console sweep, and
-- more from automated browsers, test reports and auto-captured errors. Only
-- about 30 came from people on real devices. It also counted the demo project
-- ("Mushi demo (sample data)") as one of the apps.
--
-- Now:
--   apps            the owner's apps, without demo projects (name contains
--                   "demo", the rule the console already uses)
--   user_reports    in-app reports sent by people on real devices (the owner's
--                   own testing included), not filed by Mushi or its agents
--   reporters       distinct reporter tokens among those
--   other_reports   every other report in the window: filed in the console or
--                   API, AI audits and sweeps, imports, Sentry, site checks
--   fixes_merged    unchanged: every merged fix PR, whatever found the bug
--   merged_from_users  merged fixes whose report is a user report
--   median_hours_to_merged_fix  report to first merged fix, any source
--   reviews / reviews_hold / weekly_merged  unchanged
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_scoreboard(p_days integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH window_start AS (
    SELECT now() - make_interval(days => greatest(1, least(coalesce(p_days, 60), 365))) AS t
  ),
  own AS (
    SELECT p.id
      FROM public.projects p
      JOIN public.organizations o ON o.id = p.organization_id
     WHERE o.billing_mode = 'complimentary'
       AND p.name !~* 'demo'
  ),
  window_reports AS (
    SELECT r.id,
           r.reporter_token_hash,
           -- A person on a real device: the in-app widget, not a Mushi
           -- importer, audit, sweep or automated browser, not a test report
           -- and not an error the SDK captured on its own.
           (r.source = 'widget'
             AND coalesce(r.environment->>'userAgent', '') !~* '(mushi-|headless|playwright|puppeteer|console sweep)'
             AND coalesce(r.custom_metadata->>'source', '') !~* '(audit|sweep|import|fresh|admin_test_report|admin_file|captureexception)'
           ) AS from_user
      FROM public.reports r
     WHERE r.project_id IN (SELECT id FROM own)
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
    'user_reports', (SELECT count(*) FROM window_reports WHERE from_user),
    'reporters', (SELECT count(DISTINCT reporter_token_hash) FROM window_reports WHERE from_user),
    'other_reports', (SELECT count(*) FROM window_reports WHERE NOT from_user),
    'fixes_merged', (SELECT count(*) FROM merged),
    'merged_from_users', (SELECT count(*) FROM merged m JOIN window_reports w ON w.id = m.report_id WHERE w.from_user),
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
$function$;

REVOKE ALL ON FUNCTION public.public_scoreboard(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_scoreboard(integer) TO service_role;
