-- ============================================================================
-- 20261021153000_review_followups
--
-- Review follow-up loop (ADR 0032). When the Opus review of a cloud agent's
-- PR (ADR 0030, fix_reviews) says "fix_first" on the PR's current head, Mushi
-- starts ONE new Cursor agent on that PR's branch with the review's findings,
-- and the push is reviewed again. At most one follow-up per (fix attempt,
-- reviewed head) and two per PR; never on "hold" or "merge"; only on PRs a
-- Mushi cloud agent opened.
--
-- ADDITIVE: six organizations columns (settings, off by default), one table,
-- one trigger on byok_keys (deleting the chosen key turns follow-ups off),
-- one appended fix_events.kind value ('followup'), one cron job.
-- Apply BEFORE deploying review-followup, agent-pr-review and the api function.
-- ============================================================================

-- Per-organization settings. OFF by default: an owner turns them on, and
-- review_followup_enabled_at records when (discovery reaches 3 days before it).
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS review_followup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_followup_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_followup_off_reason text,
  ADD COLUMN IF NOT EXISTS review_followup_key_id uuid REFERENCES public.byok_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_followup_model text
    CHECK (review_followup_model IS NULL OR char_length(review_followup_model) BETWEEN 1 AND 300),
  ADD COLUMN IF NOT EXISTS review_followup_daily_limit integer NOT NULL DEFAULT 30
    CHECK (review_followup_daily_limit BETWEEN 1 AND 200);

COMMENT ON COLUMN public.organizations.review_followup_enabled IS
  'Review follow-ups (ADR 0032): send each "fix_first" cloud-agent PR back to a new Cursor agent once, with the Opus findings. Default false.';
COMMENT ON COLUMN public.organizations.review_followup_enabled_at IS
  'When review follow-ups were last turned on; the worker considers fix_first reviews from 3 days before it.';
COMMENT ON COLUMN public.organizations.review_followup_off_reason IS
  'Why Mushi turned review follow-ups off on its own (the chosen Cursor key was deleted); cleared when they are turned on again.';
COMMENT ON COLUMN public.organizations.review_followup_key_id IS
  'Cursor byok_keys row follow-ups run on (a shared key of this organization, a key of one of its apps, or a universal key of one of its owners, ADR 0031). NULL = the key the app''s fixes use (ADR 0023). Deleting the key turns follow-ups off (trigger), never moves billing to another key.';
COMMENT ON COLUMN public.organizations.review_followup_model IS
  'Cursor model spec (id?param=value) for follow-ups, checked against GET /v1/models before each dispatch. NULL = the app''s Cursor model, else the account default.';
COMMENT ON COLUMN public.organizations.review_followup_daily_limit IS
  'Follow-ups dispatched per UTC day across the organization''s apps (1-200, default 30). The apps'' auto-fix caps apply too.';

CREATE INDEX IF NOT EXISTS idx_organizations_review_followup_key
  ON public.organizations (review_followup_key_id)
  WHERE review_followup_key_id IS NOT NULL;

-- Deleting the chosen key must not silently move follow-up billing to the
-- app keys: turn follow-ups off and say why. BEFORE DELETE, so it runs ahead
-- of the foreign key's ON DELETE SET NULL. It also fires when a universal
-- key (ADR 0031) goes because its owner's account is deleted (the
-- owner_user_id cascade). It only updates organizations and never touches
-- Vault, so it is independent of 20261021090000's AFTER DELETE trigger
-- trg_byok_keys_delete_vault_secret (which runs after the row is gone and
-- deletes the secret when nothing else uses it): BEFORE and AFTER row
-- triggers never interleave, whatever their names.
CREATE OR REPLACE FUNCTION private.review_followup_key_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.organizations
     SET review_followup_enabled = false,
         review_followup_key_id = NULL,
         review_followup_off_reason = 'The Cursor key chosen for review follow-ups was deleted. Pick a key and turn them on again.'
   WHERE review_followup_key_id = OLD.id;
  RETURN OLD;
END
$$;

REVOKE ALL ON FUNCTION private.review_followup_key_deleted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_review_followup_key_deleted ON public.byok_keys;
CREATE TRIGGER trg_review_followup_key_deleted
  BEFORE DELETE ON public.byok_keys
  FOR EACH ROW EXECUTE FUNCTION private.review_followup_key_deleted();

-- One row per (fix attempt, reviewed head). run_id is the claim token of the
-- worker tick that owns the row; every write of a tick is guarded on it.
CREATE TABLE IF NOT EXISTS public.fix_review_followups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fix_review_id    uuid NOT NULL REFERENCES public.fix_reviews(id) ON DELETE CASCADE,
  fix_attempt_id   uuid NOT NULL REFERENCES public.fix_attempts(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  report_id        uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  pr_url           text,
  -- The commit the fix_first review was about; the follow-up starts here.
  head_sha_before  text NOT NULL,
  status           text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'dispatched', 'running', 'completed', 'failed', 'skipped')),
  -- Why the row was skipped, or, while still queued, why the last tick waited.
  skip_reason      text,
  error            text,
  cursor_agent_id  text,
  cursor_run_id    text,
  cursor_agent_url text,
  key_id           uuid REFERENCES public.byok_keys(id) ON DELETE SET NULL,
  -- 'pool' (key_id) or 'legacy' (the app's Integrations key). A pool key
  -- deleted mid-run leaves key_id null with key_kind 'pool': the worker
  -- stops watching (key_removed) instead of using another key.
  key_kind         text CHECK (key_kind IS NULL OR key_kind IN ('pool', 'legacy')),
  model            text,
  findings_count   integer,
  -- Findings the safety screen kept out of the prompt (URL, command, file outside the PR).
  findings_dropped integer,
  prompt_chars     integer,
  run_id           uuid,
  claimed_at       timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  -- Cursor 5xx / 429 / network failures; the back-off counts these, not claims.
  cursor_failures  integer NOT NULL DEFAULT 0,
  -- The PR head after the agent finished; differs from head_sha_before when it pushed.
  head_sha_after   text,
  -- The agent's final message (agent-written: untrusted, capped).
  agent_result     text,
  -- The Opus verdict about head_sha_after, once that review completes.
  verdict_after    text CHECK (verdict_after IS NULL OR verdict_after IN ('merge', 'fix_first', 'hold')),
  queued_at        timestamptz NOT NULL DEFAULT now(),
  dispatched_at    timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fix_review_followups_once_per_head UNIQUE (fix_attempt_id, head_sha_before),
  CONSTRAINT fix_review_followups_dispatched_has_agent
    CHECK (status NOT IN ('dispatched', 'running') OR cursor_agent_id IS NOT NULL)
);

COMMENT ON TABLE public.fix_review_followups IS
  'Review follow-ups (ADR 0032): a new Cursor agent sent to a "fix_first" cloud-agent PR''s branch with the Opus findings, its key, model, run ids, the head before and after, and the verdict after. Written by review-followup (service role); read by the console and the spend-down scoreboard.';

CREATE INDEX IF NOT EXISTS idx_fix_review_followups_queue
  ON public.fix_review_followups (queued_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_fix_review_followups_active
  ON public.fix_review_followups (dispatched_at)
  WHERE status IN ('dispatched', 'running');
CREATE INDEX IF NOT EXISTS idx_fix_review_followups_project
  ON public.fix_review_followups (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fix_review_followups_project_dispatched
  ON public.fix_review_followups (project_id, dispatched_at)
  WHERE dispatched_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fix_review_followups_review
  ON public.fix_review_followups (fix_review_id);
CREATE INDEX IF NOT EXISTS idx_fix_review_followups_report
  ON public.fix_review_followups (report_id)
  WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fix_review_followups_key
  ON public.fix_review_followups (key_id)
  WHERE key_id IS NOT NULL;

-- RLS: project members read (the fix_reviews rule); writes only through the
-- service role.
ALTER TABLE public.fix_review_followups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fix_review_followups' AND policyname = 'fix_review_followups_member_select') THEN
    CREATE POLICY fix_review_followups_member_select ON public.fix_review_followups
      FOR SELECT TO authenticated
      USING (
        project_id IN (
          SELECT id FROM public.projects
          WHERE owner_id = (SELECT auth.uid())
        )
        OR private.is_project_member(project_id)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fix_review_followups' AND policyname = 'fix_review_followups_service_write') THEN
    CREATE POLICY fix_review_followups_service_write ON public.fix_review_followups
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE public.fix_review_followups FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.fix_review_followups FROM authenticated;
GRANT SELECT ON TABLE public.fix_review_followups TO authenticated;

-- fix_events.kind: append 'followup' to the live list, read from the live
-- constraint by name (as 20261020172855 does) so no value is dropped. The
-- constraint is added NOT VALID and then validated, but in the same
-- transaction, so the ACCESS EXCLUSIVE lock from DROP / ADD CONSTRAINT is
-- held throughout: no shorter lock. Fine at the table's size (about 5.7k
-- rows on 2026-10-21).
DO $$
DECLARE
  v_name text;
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['followup'];
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO v_name, v_def
    FROM pg_constraint
   WHERE conrelid = 'public.fix_events'::regclass
     AND contype = 'c'
     AND conname = 'fix_events_kind_check';
  IF v_def IS NULL THEN
    SELECT conname, pg_get_constraintdef(oid) INTO v_name, v_def
      FROM pg_constraint
     WHERE conrelid = 'public.fix_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ~* '\mkind\M'
     LIMIT 1;
  END IF;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix_events kind check not found; refusing to guess the allowed kinds';
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of %: %', v_name, v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.fix_events DROP CONSTRAINT %I', v_name);
  EXECUTE format(
    'ALTER TABLE public.fix_events ADD CONSTRAINT fix_events_kind_check CHECK (kind IN (%s)) NOT VALID',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
  EXECUTE 'ALTER TABLE public.fix_events VALIDATE CONSTRAINT fix_events_kind_check';
END $$;

-- Every 10 minutes at :06, :16, …, :56: after agent-pr-review (3-53/10) has
-- stored the verdicts, before spend-down (8-58/10).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-review-followup schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-review-followup';

  PERFORM cron.schedule(
    'mushi-review-followup',
    '6-56/10 * * * *',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/review-followup',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := '{"trigger":"cron"}'::jsonb
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );
END $$;
