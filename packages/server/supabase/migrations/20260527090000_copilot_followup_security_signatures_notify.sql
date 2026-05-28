-- ============================================================================
-- Copilot follow-up — security, signatures, NOTIFY, and trigger metadata fix
-- ============================================================================
-- Addresses review comments from PRs #144 / #135 / #136 (May 2026 release).
-- All historical migrations stay byte-identical; this migration applies the
-- fixes in a forward-compatible way (CREATE OR REPLACE, GRANT, NOTIFY, etc.).
--
-- Sections:
--   1. Re-grant EXECUTE on accept_invitation (over-revoked by 20260527050000)
--   2. Pin search_path to start with pg_catalog on SECURITY DEFINER RPCs
--   3. Add authz guards inside SECURITY DEFINER RPCs that previously trusted
--      the p_*_id argument blindly (get_org_feature_flags, get_tester_apps_enriched)
--   4. Re-COMMENT functions with explicit signatures (best-practice; previous
--      statements succeeded only because the functions were unique-signature)
--   5. Make the tester auto-provision trigger tolerant of both
--      raw_app_meta_data (admin API) AND raw_user_meta_data (signInWithOtp)
--   6. Fix the misleading "pg_net moved out of public" claim in the schema
--      comment from 20260527020000 (pg_net is in fact still in public)
--   7. NOTIFY PostgREST to flush schema + privilege cache
-- ============================================================================


-- ────────────────────────────────────────────────────────────
-- 1. Re-grant EXECUTE on accept_invitation to authenticated
-- ────────────────────────────────────────────────────────────
-- Migration 20260527050000 revoked EXECUTE on accept_invitation(text) from
-- PUBLIC, anon, and authenticated, but it is invoked via
--   getUserClient(authHeader).rpc('accept_invitation', { p_token: token })
-- in packages/server/supabase/functions/api/routes/organizations.ts, which
-- uses the caller's JWT (authenticated role). Without this GRANT, the
-- invitation-accept flow returns 42501 (insufficient_privilege).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'accept_invitation'
      AND pg_get_function_identity_arguments(p.oid) = 'p_token text'
  ) THEN
    GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 2 + 3. Re-create get_org_feature_flags with hardened search_path
--        AND in-function authz (caller must be a member of the org)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_org_feature_flags(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_flags     jsonb;
BEGIN
  -- service_role calls have auth.uid() = NULL and bypass the membership
  -- check; service_role is trusted and used by edge functions.
  IF v_caller_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.organization_members
       WHERE organization_id = p_organization_id
         AND user_id = v_caller_id
    ) THEN
      RETURN '{}'::jsonb;
    END IF;
  END IF;

  SELECT COALESCE(pp.feature_flags, '{}'::jsonb)
    INTO v_flags
    FROM public.organizations o
    JOIN public.pricing_plans pp ON pp.id = o.plan_id
   WHERE o.id = p_organization_id
   LIMIT 1;

  RETURN COALESCE(v_flags, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_org_feature_flags(uuid) IS
  'Returns the feature_flags jsonb from pricing_plans for the given org. '
  'SECURITY DEFINER + in-function membership check: returns {} for callers '
  'that are not a member of the org (service_role bypasses the check).';


-- ────────────────────────────────────────────────────────────
-- 3b. Re-create get_tester_apps_enriched with in-function authz
--     (caller must own the p_tester_id row OR be service_role)
-- ────────────────────────────────────────────────────────────

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


-- ────────────────────────────────────────────────────────────
-- 4. Re-COMMENT private.recompute_tester_reputation with explicit signature
-- ────────────────────────────────────────────────────────────
-- The previous COMMENT in 20260523060000 succeeded only because the function
-- has a single signature; adding the (uuid) signature is best-practice and
-- avoids breakage if an overload is ever introduced.

COMMENT ON FUNCTION private.recompute_tester_reputation(uuid) IS
  'SQL helper for on-demand single-tester recompute. Invoke with '
  'SELECT private.recompute_tester_reputation(p_tester_id). The daily batch '
  'recompute runs via the recompute-tester-reputation edge function cron job.';


-- ────────────────────────────────────────────────────────────
-- 5. Tester auto-provision trigger: accept signup_intent from either
--    raw_app_meta_data (set by server-side admin API) OR raw_user_meta_data
--    (set by client-side supabase.auth.signInWithOtp options.data).
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.handle_new_tester_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $$
DECLARE
  v_intent text;
BEGIN
  v_intent := COALESCE(
    NEW.raw_app_meta_data  ->> 'signup_intent',
    NEW.raw_user_meta_data ->> 'signup_intent'
  );

  IF v_intent = 'tester' THEN
    INSERT INTO public.mushi_testers (auth_user_id, marketing_opt_in)
    VALUES (NEW.id, false)
    ON CONFLICT (auth_user_id) DO NOTHING;

    INSERT INTO public.mushi_tester_profiles (tester_id)
    SELECT id FROM public.mushi_testers WHERE auth_user_id = NEW.id
    ON CONFLICT (tester_id) DO NOTHING;

    INSERT INTO public.tester_balances (tester_id, current_points, total_points_lifetime, total_points_30d)
    SELECT id, 0, 0, 0 FROM public.mushi_testers WHERE auth_user_id = NEW.id
    ON CONFLICT (tester_id) DO NOTHING;

    INSERT INTO public.tester_reputation (tester_id, score)
    SELECT id, 0 FROM public.mushi_testers WHERE auth_user_id = NEW.id
    ON CONFLICT (tester_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 6. Schema comment correction — pg_net is still in public
-- ────────────────────────────────────────────────────────────

COMMENT ON SCHEMA public IS
  'Mushi Mushi v2 — public schema. Security advisor remediation '
  'applied 2026-05-27 (migrations 20260527020000 + 20260527090000): '
  'security_invoker on public leaderboard view, search_path pinned on '
  'flagged functions, redundant service_role RLS policies dropped, '
  'EXECUTE revoked from anon/authenticated on trigger/cron functions, '
  'and SELECT revoked from anon on PII/financial tables (RLS still applies). '
  'pg_net remains in public — non-relocatable on Supabase; tracked as a '
  'WARN-level advisor that requires platform support to address.';


-- ────────────────────────────────────────────────────────────
-- 7. NOTIFY PostgREST to flush schema + privilege caches
-- ────────────────────────────────────────────────────────────
-- Required because the changes above (CREATE OR REPLACE FUNCTION, GRANT,
-- COMMENT) alter the surface PostgREST exposes via /rpc and /. Without
-- these NOTIFYs, callers can see stale 4xx (`function does not exist` /
-- `column does not exist`) for up to several minutes after deploy.

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
