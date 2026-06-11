-- Migration: copilot_followup_get_tester_apps_enriched_hardened
-- Deployed: 2026-05-31 via Supabase MCP (apply_migration)
-- Reason: Copilot PR #144 fixes:
--   1. Add in-function ownership authz: caller must own the p_tester_id row
--      (service_role bypasses the check; service_role = NULL auth.uid()).
--   2. Pin search_path to pg_catalog (prevents name shadowing).
--   3. COMMENT now includes explicit (uuid) signature per SQL best practice.

CREATE OR REPLACE FUNCTION public.get_tester_apps_enriched(p_tester_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
BEGIN
  -- service_role (auth.uid() IS NULL) is trusted and bypasses the check.
  IF v_caller_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.mushi_testers
       WHERE id = p_tester_id
         AND auth_user_id = v_caller_id
    ) THEN
      RETURN '[]'::jsonb;
    END IF;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'published_at') DESC NULLS LAST), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id',               a.id,
        'slug',             a.slug,
        'name',             a.name,
        'tagline',          a.tagline,
        'description',      a.description,
        'hero_url',         a.hero_url,
        'screenshots_urls', a.screenshots_urls,
        'platforms',        a.platforms,
        'web_url',          a.web_url,
        'app_store_url',    a.app_store_url,
        'play_store_url',   a.play_store_url,
        'published_at',     a.published_at,
        'country_codes',     COALESCE(tgt.country_codes, '{}'),
        'languages',         COALESCE(tgt.languages, '{}'),
        'expertise_tags',    COALESCE(tgt.expertise_tags, '{}'),
        'reputation_min',    COALESCE(tgt.reputation_min, 0),
        'bounty_schedule',  COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
              'action',                 b.action,
              'points_per_event',       b.points_per_event,
              'daily_cap',              b.daily_cap,
              'lifetime_cap_per_tester',b.lifetime_cap_per_tester
            ) ORDER BY b.points_per_event DESC)
           FROM public.published_app_bounties b
           WHERE b.app_id = a.id AND b.enabled = true
          ), '[]'::jsonb
        ),
        'max_bounty_points', COALESCE(
          (SELECT MAX(b.points_per_event)
           FROM public.published_app_bounties b
           WHERE b.app_id = a.id AND b.enabled = true
          ), 0
        ),
        'joined',           (sub.status = 'active'),
        'joined_at',        sub.joined_at,
        'accepted_30d', COALESCE(
          (SELECT COUNT(*) FROM public.tester_submissions ts
           WHERE ts.app_id = a.id AND ts.status = 'accepted'
             AND ts.created_at >= now() - interval '30 days'), 0
        ),
        'submitted_30d', COALESCE(
          (SELECT COUNT(*) FROM public.tester_submissions ts
           WHERE ts.app_id = a.id
             AND ts.created_at >= now() - interval '30 days'), 0
        ),
        'last_accepted_at', (
          SELECT MAX(ts.accepted_at) FROM public.tester_submissions ts
          WHERE ts.app_id = a.id AND ts.status = 'accepted'
        ),
        'avg_response_hours', (
          SELECT ROUND(
            EXTRACT(epoch FROM
              PERCENTILE_CONT(0.5) WITHIN GROUP (
                ORDER BY (ts.accepted_at - ts.created_at)
              )
            ) / 3600.0,
            1
          )
          FROM (
            SELECT ts.accepted_at, ts.created_at
            FROM public.tester_submissions ts
            WHERE ts.app_id = a.id AND ts.status = 'accepted'
              AND ts.accepted_at IS NOT NULL
            ORDER BY ts.accepted_at DESC
            LIMIT 50
          ) ts
        ),
        'my_submissions', COALESCE(
          (SELECT COUNT(*) FROM public.tester_submissions ts
           WHERE ts.app_id = a.id AND ts.tester_id = p_tester_id), 0
        ),
        'my_accepted', COALESCE(
          (SELECT COUNT(*) FROM public.tester_submissions ts
           WHERE ts.app_id = a.id AND ts.tester_id = p_tester_id
             AND ts.status = 'accepted'), 0
        ),
        'my_points_earned', COALESCE(
          (SELECT SUM(ts.points_awarded) FROM public.tester_submissions ts
           WHERE ts.app_id = a.id AND ts.tester_id = p_tester_id
             AND ts.status = 'accepted'), 0
        ),
        'meets_reputation_gate', (
          COALESCE(tgt.reputation_min, 0) = 0
          OR COALESCE(
            (SELECT rep.score FROM public.tester_reputation rep
             WHERE rep.tester_id = p_tester_id), 0
          ) >= COALESCE(tgt.reputation_min, 0)
        ),
        'my_reputation_score', COALESCE(
          (SELECT rep.score FROM public.tester_reputation rep
           WHERE rep.tester_id = p_tester_id), 0
        )
      ) AS row_data
      FROM public.published_apps a
      LEFT JOIN public.published_app_targeting tgt ON tgt.app_id = a.id
      LEFT JOIN public.tester_app_subscriptions sub
        ON sub.app_id = a.id AND sub.tester_id = p_tester_id
      WHERE a.visibility = 'public'
    ) enriched
  );
END;
$$;

COMMENT ON FUNCTION public.get_tester_apps_enriched(uuid) IS
  'Aggregates published-app data + tester-personal stats into one JSON array. '
  'SECURITY DEFINER + in-function ownership check: returns [] when the caller '
  'is not the owner of p_tester_id (service_role bypasses the check).';

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
