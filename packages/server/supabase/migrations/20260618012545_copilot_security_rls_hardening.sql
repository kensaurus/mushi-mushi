-- Copilot burndown PR1: revoke feature-board anon exposure, harden SECURITY
-- DEFINER RPCs, add support_tickets category CHECK, flush PostgREST cache.

-- ── 1a. Feature board: revoke anon direct PostgREST access ─────────────────
-- All reads/writes go through the edge API (service role + jwtAuth).

DROP POLICY IF EXISTS anon_read_frv ON public.feature_request_votes;
DROP POLICY IF EXISTS anon_read_frc ON public.feature_request_comments;

REVOKE SELECT ON public.feature_request_votes FROM anon;
REVOKE SELECT ON public.feature_request_comments FROM anon;

-- ── 1b. get_org_feature_flags: membership gate + pinned search_path ────────
-- service_role callers (edge functions) bypass; authenticated must be a member.

CREATE OR REPLACE FUNCTION public.get_org_feature_flags(p_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(pp.feature_flags, '{}'::jsonb)
    FROM public.organizations o
    JOIN public.pricing_plans pp ON pp.id = o.plan_id
   WHERE o.id = p_organization_id
     AND (
       (SELECT auth.role()) = 'service_role'
       OR EXISTS (
         SELECT 1
           FROM public.organization_members om
          WHERE om.organization_id = p_organization_id
            AND om.user_id = (SELECT auth.uid())
       )
     )
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_org_feature_flags(uuid) IS
  'Returns pricing_plans.feature_flags for an org. service_role bypasses membership; '
  'authenticated callers must be organization_members. Returns NULL when denied.';

GRANT EXECUTE ON FUNCTION public.get_org_feature_flags(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_feature_flags(uuid) TO service_role;

-- ── 1b. get_tester_apps_enriched: caller must own p_tester_id ──────────────

CREATE OR REPLACE FUNCTION public.get_tester_apps_enriched(p_tester_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.mushi_testers t
       WHERE t.id = p_tester_id
         AND t.auth_user_id = (SELECT auth.uid())
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
  'Aggregates published app data for the tester portal. service_role bypasses identity; '
  'authenticated callers may only query their own mushi_testers.id.';

GRANT EXECUTE ON FUNCTION public.get_tester_apps_enriched(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_tester_apps_enriched(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tester_apps_enriched(uuid) TO service_role;

-- ── 1c. support_tickets.category bounded set ───────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'support_tickets_category_check'
       AND conrelid = 'public.support_tickets'::regclass
  ) THEN
    ALTER TABLE public.support_tickets
      ADD CONSTRAINT support_tickets_category_check
      CHECK (category IN ('billing', 'bug', 'feature', 'other'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
