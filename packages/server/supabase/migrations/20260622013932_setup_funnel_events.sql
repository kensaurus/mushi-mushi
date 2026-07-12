/*
FILE: 20260622100000_setup_funnel_events.sql
PURPOSE: Setup-funnel event log for observing drop-offs in the CLI/console onboarding flow.

OVERVIEW:
  Records every meaningful step in the SDK setup journey — from CLI auth start through
  first SDK heartbeat — so operators can see exactly where users drop off and how
  long each step takes. Complements the derived checklist from `project_api_keys` /
  `reports` with actual event timestamps.

  Events are emitted from three surfaces:
    - Edge functions (cli-auth routes): cli_auth_started, cli_auth_approved, …
    - Edge functions (heartbeat): sdk_first_heartbeat
    - CLI (POST /v1/sync/funnel-event): wizard_env_written

  All writes use INSERT … ON CONFLICT DO NOTHING (idempotent) so retry-safe CLI
  calls and re-triggered edge functions never double-count.

TABLE: setup_funnel_events
  - user_id     : the authenticated user performing setup
  - project_id  : NULL before a project is created (cli_auth_started)
  - event_name  : one of the enum values enforced by the CHECK below
  - dedup_key   : natural dedup identifier for this (user, event) pair
  - source      : 'cli' | 'console' | 'api'
  - metadata    : arbitrary JSON for context (ip_hint, sdk_version, …)
  - created_at  : first time this event was recorded

SECURITY:
  - RLS is RESTRICTIVE deny-all; only the edge function (service role) reads/writes.
  - UNIQUE constraint on (user_id, event_name, dedup_key) enforces idempotency.

DATA-PIPELINE NOTES:
  - At-least-once delivery: emitters fire-and-forget; the UNIQUE constraint absorbs dupes.
  - Never increment counters: each row is one event, not a running total.
  - pg_cron overlap guard: the cli_auth_expired emitter uses pg_try_advisory_lock.
*/

CREATE TABLE IF NOT EXISTS public.setup_funnel_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL for cli_auth_started events (public endpoint, no user_id available yet)
  user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id   uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  event_name   text        NOT NULL
                           CHECK (event_name IN (
                             'cli_auth_started',
                             'cli_auth_approved',
                             'cli_auth_denied',
                             'cli_auth_expired',
                             'cli_auth_token_claimed',
                             'cli_project_created',
                             'cli_key_minted',
                             'wizard_env_written',
                             'sdk_first_heartbeat'
                           )),
  dedup_key    text        NOT NULL,
  source       text        NOT NULL DEFAULT 'api'
                           CHECK (source IN ('cli', 'console', 'api')),
  metadata     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Dedup target is (event_name, dedup_key). The dedup_key is globally unique
  -- per event (e.g. the cli_auth_requests row id, or the project id), so user_id
  -- is intentionally NOT part of the conflict target. cli_auth_started carries no
  -- user_id and dedups on (event_name, dedup_key) like every other event. Every
  -- ON CONFLICT clause below MUST reference (event_name, dedup_key) to match this.
  UNIQUE (event_name, dedup_key)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- Funnel dropoff query: most recent event per user
CREATE INDEX IF NOT EXISTS setup_funnel_events_user_event_idx
  ON public.setup_funnel_events (user_id, event_name, created_at DESC);

-- Project-scoped funnel (for per-project operator view)
CREATE INDEX IF NOT EXISTS setup_funnel_events_project_idx
  ON public.setup_funnel_events (project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

-- Time-range scans for the 7-day funnel panel
CREATE INDEX IF NOT EXISTS setup_funnel_events_created_idx
  ON public.setup_funnel_events (created_at DESC);

-- ── RLS — deny-all; only service role (edge functions) may read/write ────────
ALTER TABLE public.setup_funnel_events ENABLE ROW LEVEL SECURITY;

-- DROP-then-CREATE so a re-apply (db reset / out-of-band remote apply) never
-- fails on an already-existing policy. CREATE POLICY is not IF-NOT-EXISTS-able.
DROP POLICY IF EXISTS "deny_all_setup_funnel_events" ON public.setup_funnel_events;
CREATE POLICY "deny_all_setup_funnel_events"
  ON public.setup_funnel_events
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

-- ── Helper: idempotent upsert (used by edge functions) ───────────────────────
CREATE OR REPLACE FUNCTION public.upsert_setup_funnel_event(
  p_user_id    uuid,      -- NULL allowed for cli_auth_started
  p_project_id uuid,
  p_event_name text,
  p_dedup_key  text,
  p_source     text DEFAULT 'api',
  p_metadata   jsonb DEFAULT '{}'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.setup_funnel_events
    (user_id, project_id, event_name, dedup_key, source, metadata)
  VALUES
    (p_user_id, p_project_id, p_event_name, p_dedup_key, p_source, p_metadata)
  ON CONFLICT (event_name, dedup_key) DO NOTHING;
END;
$$;

-- ── pg_cron: mark expired cli_auth_requests as funnel events ─────────────────
-- Uses pg_try_advisory_lock so overlapping runs skip gracefully (at-most-once
-- per 5-minute window) without blocking each other.
--
-- This is a best-effort emit: if the lock is held we skip; the next cron run
-- will catch any remaining expired rows. We intentionally keep it simple rather
-- than adding a complex "already emitted" flag — the UNIQUE constraint on
-- (event_name, dedup_key) means a duplicate cron run is harmless.
--
-- NOTE on dollar-quoting: three nesting levels need three DISTINCT tags
-- ($schedule$ / $cron$ / $inner$). Re-using $$ at every level would let the
-- first inner $$ prematurely close the outer block and break the migration.
DO $schedule$
DECLARE
  v_job_id bigint;
BEGIN
  -- Only schedule if pg_cron is available. cron.schedule() upserts by name, so
  -- re-running this migration simply refreshes the job (idempotent).
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT cron.schedule(
      'setup-funnel-cli-auth-expired',
      '*/5 * * * *',
      $cron$
      DO $inner$
      BEGIN
        IF pg_try_advisory_lock(987654321) THEN
          BEGIN
            INSERT INTO public.setup_funnel_events
              (user_id, project_id, event_name, dedup_key, source, metadata)
            SELECT
              user_id,
              NULL,
              'cli_auth_expired',
              id::text,
              'api',
              jsonb_build_object('user_code', user_code)
            FROM public.cli_auth_requests
            WHERE status = 'expired'
              AND user_id IS NOT NULL
            ON CONFLICT (event_name, dedup_key) DO NOTHING;
          EXCEPTION WHEN OTHERS THEN
            NULL; -- never block the cron
          END;
          PERFORM pg_advisory_unlock(987654321);
        END IF;
      END;
      $inner$;
      $cron$
    ) INTO v_job_id;
  END IF;
END;
$schedule$;

COMMENT ON TABLE public.setup_funnel_events IS
  'Immutable event log for SDK onboarding steps. Each row records when a user reached a setup milestone. '
  'Used to compute time-to-first-heartbeat, identify drop-off points, and drive the operator funnel panel.';

-- ── Operator funnel query (last 7 days) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_setup_funnel_counts_7d()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_object_agg(event_name, cnt)
  FROM (
    SELECT event_name, COUNT(DISTINCT COALESCE(user_id::text, dedup_key)) AS cnt
    FROM setup_funnel_events
    WHERE created_at > now() - interval '7 days'
    GROUP BY event_name
  ) t;
$$;
