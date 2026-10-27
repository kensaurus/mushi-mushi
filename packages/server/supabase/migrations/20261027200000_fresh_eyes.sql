-- ============================================================================
-- 20261027200000_fresh_eyes
--
-- Fresh-eyes runs (ADR 0051): `mushi-ux fresh-eyes` tries one goal as a
-- first-time visitor and mirrors the run to the console.
--
--   synthetic_accounts   accounts POST /v1/admin/fresh-eyes/test-account made
--                        for Mushi's own runs (email_confirm, app_metadata.
--                        synthetic). Each is also a row in operator_users, the
--                        list company_funnel_weekly() and lifecycle-emails
--                        already exclude. retention-sweep deletes the user, and
--                        the projects and organizations it alone owns, after
--                        expires_at. Service role only.
--   ux_runs              kind ('loop' | 'fresh_eyes') and the fresh-eyes columns:
--                        goal, start_url, timeline (sessions and steps),
--                        ttfv_seconds, steps, reached, stalled_at, findings,
--                        dry_run, has_account
--   reports.source       appends 'fresh_eyes' to the live list
--   is_synthetic_subject a service-role check emitProductEvent runs so a
--                        synthetic user or its project never writes server
--                        product events
--
-- metric_series gets fresh_eyes.ttfv_seconds and fresh_eyes.steps rows from
-- the api (dimension = the run's local id, one row per run); no schema change.
--
-- ADDITIVE: new table, new nullable or defaulted columns, a widened CHECK.
-- Apply BEFORE deploying api-ext, retention-sweep and the functions that
-- import _shared/product-events.ts.
--
-- Verify after apply:
--   select relrowsecurity from pg_class where relname = 'synthetic_accounts';      -- t
--   select column_name from information_schema.columns
--    where table_name = 'ux_runs' and column_name in ('kind', 'timeline', 'ttfv_seconds');
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'reports_source_check'; -- lists fresh_eyes
--   select has_function_privilege('authenticated', 'public.is_synthetic_subject(uuid, uuid)', 'execute'); -- f
-- ============================================================================

-- ── synthetic_accounts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.synthetic_accounts (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  purpose     text NOT NULL DEFAULT 'fresh_eyes' CHECK (purpose IN ('fresh_eyes')),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

COMMENT ON TABLE public.synthetic_accounts IS
  'Accounts made for fresh-eyes runs (ADR 0051). Flagged in app_metadata.synthetic, listed in operator_users so every company count and lifecycle email skips them, never write server product events, and are deleted with the projects and organizations they alone own once expires_at passes (retention-sweep). Service role only.';

CREATE INDEX IF NOT EXISTS idx_synthetic_accounts_expires ON public.synthetic_accounts (expires_at);

ALTER TABLE public.synthetic_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS synthetic_accounts_service_all ON public.synthetic_accounts;
CREATE POLICY synthetic_accounts_service_all ON public.synthetic_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.synthetic_accounts FROM anon, authenticated;

COMMENT ON TABLE public.operator_users IS
  'auth.users ids excluded from company counts and lifecycle emails: founders and staff (mirror of the MUSHI_OPERATOR_USER_IDS edge secret, which is the operator gate) and synthetic fresh-eyes accounts (synthetic_accounts, ADR 0051). Membership grants nothing. Service role only.';

-- ── ux_runs: fresh-eyes columns ─────────────────────────────────────────────
ALTER TABLE public.ux_runs
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'loop' CHECK (kind IN ('loop', 'fresh_eyes')),
  ADD COLUMN IF NOT EXISTS goal text CHECK (goal IS NULL OR char_length(goal) <= 300),
  ADD COLUMN IF NOT EXISTS start_url text CHECK (start_url IS NULL OR char_length(start_url) <= 500),
  ADD COLUMN IF NOT EXISTS timeline jsonb,
  ADD COLUMN IF NOT EXISTS ttfv_seconds numeric CHECK (ttfv_seconds IS NULL OR ttfv_seconds >= 0),
  ADD COLUMN IF NOT EXISTS steps integer CHECK (steps IS NULL OR steps >= 0),
  ADD COLUMN IF NOT EXISTS reached integer CHECK (reached IS NULL OR reached >= 0),
  ADD COLUMN IF NOT EXISTS stalled_at jsonb,
  ADD COLUMN IF NOT EXISTS findings jsonb,
  ADD COLUMN IF NOT EXISTS dry_run boolean,
  ADD COLUMN IF NOT EXISTS has_account boolean;

COMMENT ON COLUMN public.ux_runs.kind IS
  'loop: a mushi-ux run of the coding agent over every screen (ADR 0020). fresh_eyes: a first-time visitor trying one goal (ADR 0051); goal, start_url, timeline, ttfv_seconds, steps, reached, stalled_at, findings, dry_run and has_account are its columns.';
COMMENT ON COLUMN public.ux_runs.ttfv_seconds IS
  'Fresh-eyes: median time to first value over sessions that reached the goal, app time plus reading time, never the model''s think time. NULL when no session reached it.';

CREATE INDEX IF NOT EXISTS ux_runs_project_kind_started ON public.ux_runs (project_id, kind, started_at DESC);

-- ── reports.source: append 'fresh_eyes' to the live list ────────────────────
DO $$
DECLARE
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['fresh_eyes'];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.reports'::regclass
     AND conname = 'reports_source_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'reports_source_check not found; refusing to guess the allowed sources';
  END IF;
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of reports_source_check: %', v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.reports DROP CONSTRAINT reports_source_check';
  EXECUTE format(
    'ALTER TABLE public.reports ADD CONSTRAINT reports_source_check CHECK (source IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
END $$;

-- ── is_synthetic_subject ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_synthetic_subject(p_user_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.synthetic_accounts s WHERE s.user_id = p_user_id)
      OR EXISTS (
        SELECT 1
          FROM public.projects p
          JOIN public.synthetic_accounts s ON s.user_id = p.owner_id
         WHERE p.id = p_project_id
      );
$$;

COMMENT ON FUNCTION public.is_synthetic_subject(uuid, uuid) IS
  'True when the user, or the owner of the project, is a synthetic fresh-eyes account (ADR 0051). emitProductEvent skips such events. Service role only.';

REVOKE ALL ON FUNCTION public.is_synthetic_subject(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_synthetic_subject(uuid, uuid) TO service_role;
