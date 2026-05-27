-- Migration: get_tester_apps_enriched
-- Returns a JSON array of enriched published-app rows for the tester portal.
-- Aggregates per-app bounty schedule, activity signals (30d accept rate,
-- response-time median, last accepted), tester-personal stats, and fit flags
-- into a single round trip. Replaces the N+1 fetch in /v1/tester/apps.

CREATE OR REPLACE FUNCTION public.get_tester_apps_enriched(p_tester_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'published_at') DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      -- core app fields
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

      -- targeting / eligibility
      'country_codes',     COALESCE(tgt.country_codes, '{}'),
      'languages',         COALESCE(tgt.languages, '{}'),
      'expertise_tags',    COALESCE(tgt.expertise_tags, '{}'),
      'reputation_min',    COALESCE(tgt.reputation_min, 0),

      -- bounty schedule (enabled tiers only)
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

      -- subscription / join status
      'joined',           (sub.status = 'active'),
      'joined_at',        sub.joined_at,

      -- activity signals (across all testers, last 30d)
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
      -- median response hours (accepted_at - created_at) over last 50 accepted
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

      -- tester-personal stats for this app
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

      -- fit flag: meets reputation gate?
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
  ) enriched;
$$;

GRANT EXECUTE ON FUNCTION public.get_tester_apps_enriched(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_tester_apps_enriched(uuid) FROM anon;

COMMENT ON FUNCTION public.get_tester_apps_enriched IS
  'Aggregates published app data, bounty schedule, 30d activity signals, tester-personal stats, and eligibility flags into a single JSON array. Used by GET /v1/tester/apps to eliminate N+1 round trips.';
