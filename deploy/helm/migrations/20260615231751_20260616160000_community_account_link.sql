-- Migration: community_account_link
-- PURPOSE: Cross-app community layer for the Mushi SDK widget.
--   1. `mushi_link_reporter_token` — idempotent RPC that attaches an anonymous
--      reporter_token_hash history to the caller's mushi_testers identity,
--      setting reports.tester_id for all matching rows.
--   2. `mushi_get_my_cross_app_reports` — returns all reports filed by the
--      caller's tester identity, across all projects, grouped with app metadata.
--   3. `mushi_get_my_reputation` — returns the caller's global rank + points
--      from the tester_leaderboard_30d_public view.
--
-- Security contract: all three functions are SECURITY DEFINER, SET search_path,
-- and require an authenticated session (auth.uid() must resolve to a
-- mushi_testers row). They are NOT granted to anon.

-- ── 1. mushi_link_reporter_token ──────────────────────────────────────────────
-- Links all reports with reporter_token_hash = hash(p_reporter_token) to the
-- caller's mushi_testers.id. The hash must be computed by the caller using the
-- same SHA-256 algorithm the SDK uses, to avoid storing raw tokens server-side.
-- Idempotent: repeated calls with the same token are no-ops.
CREATE OR REPLACE FUNCTION public.mushi_link_reporter_token(p_reporter_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tester_id uuid;
  v_updated   integer;
BEGIN
  -- Resolve tester from the caller's auth identity
  SELECT id INTO v_tester_id
  FROM public.mushi_testers
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_tester_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_tester');
  END IF;

  -- Claim all matching reports that are unlinked or already linked to this tester
  UPDATE public.reports
  SET    tester_id = v_tester_id
  WHERE  reporter_token_hash = p_reporter_token_hash
    AND  (tester_id IS NULL OR tester_id = v_tester_id);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'linked', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mushi_link_reporter_token(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mushi_link_reporter_token(text) FROM anon, PUBLIC;

COMMENT ON FUNCTION public.mushi_link_reporter_token IS
  'Attaches anonymous reporter_token_hash history to the caller''s mushi_testers identity. '
  'Idempotent — safe to call on every Mushi tester sign-in.';

-- ── 2. mushi_get_my_cross_app_reports ────────────────────────────────────────
-- Returns all reports filed by the caller's mushi_tester identity, across all
-- projects, enriched with app display name and project slug.
CREATE OR REPLACE FUNCTION public.mushi_get_my_cross_app_reports(
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tester_id uuid;
  v_rows      jsonb;
BEGIN
  SELECT id INTO v_tester_id
  FROM public.mushi_testers
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_tester_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_tester', 'reports', '[]'::jsonb);
  END IF;

  SELECT jsonb_agg(row_to_json(q)) INTO v_rows
  FROM (
    SELECT
      r.id,
      r.short_id,
      r.title,
      r.category,
      r.status,
      r.created_at,
      r.updated_at,
      p.id   AS project_id,
      p.name AS app_name,
      p.slug AS app_slug
    FROM public.reports r
    LEFT JOIN public.projects p ON p.id = r.project_id
    WHERE r.tester_id = v_tester_id
    ORDER BY r.created_at DESC
    LIMIT  LEAST(p_limit, 200)
    OFFSET p_offset
  ) q;

  RETURN jsonb_build_object(
    'ok',      true,
    'reports', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mushi_get_my_cross_app_reports(integer, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mushi_get_my_cross_app_reports(integer, integer) FROM anon, PUBLIC;

COMMENT ON FUNCTION public.mushi_get_my_cross_app_reports IS
  'Returns all reports filed by the caller''s tester identity across all projects. '
  'Pagination via p_limit / p_offset.';

-- ── 3. mushi_get_my_reputation ───────────────────────────────────────────────
-- Returns the caller's global rank, points, and display info.
-- IMPORTANT: Queries the PRIVATE tester_leaderboard_30d view (which has tester_id)
-- instead of tester_leaderboard_30d_public (which strips tester_id for privacy).
-- This function is SECURITY DEFINER so querying the private view is safe.
CREATE OR REPLACE FUNCTION public.mushi_get_my_reputation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tester_id uuid;
  v_row       jsonb;
BEGIN
  SELECT id INTO v_tester_id
  FROM public.mushi_testers
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_tester_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_tester');
  END IF;

  -- Use the private view that includes tester_id; map to widget-friendly shape.
  SELECT jsonb_build_object(
    'tester_id',     lb.tester_id,
    'public_handle', lb.public_handle,
    'display_name',  lb.display_name,
    'rank',          lb.rank,
    'total_points',  lb.total_points_lifetime,
    'points_30d',    lb.total_points_30d
  ) INTO v_row
  FROM public.tester_leaderboard_30d lb
  WHERE lb.tester_id = v_tester_id
  LIMIT 1;

  IF v_row IS NULL THEN
    -- Tester exists but has no leaderboard entry yet.
    SELECT jsonb_build_object(
      'tester_id',     mt.id,
      'public_handle', mt.public_handle,
      'display_name',  mt.display_name,
      'rank',          NULL,
      'total_points',  0,
      'points_30d',    0
    ) INTO v_row
    FROM public.mushi_testers mt
    WHERE mt.id = v_tester_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'reputation', v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mushi_get_my_reputation() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mushi_get_my_reputation() FROM anon, PUBLIC;

COMMENT ON FUNCTION public.mushi_get_my_reputation IS
  'Returns the caller''s global rank and points from the tester leaderboard. '
  'Returns zeros + null rank for testers with no activity yet.';
