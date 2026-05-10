-- ============================================================
-- Invitation reminders v1 — automated nudges to recover dormant
-- invites without operator effort.
--
-- Background: even after the v1.2 polish (preview screen, copy
-- link, manual resend), production data shows ~28% of invites
-- expire without acceptance. The dominant failure mode is the
-- one we don't currently fix: the invitee opened the email,
-- meant to come back to it later, and never did. Manual resend
-- works for invites the inviter remembers; the silent ones are
-- the ones we leave on the floor.
--
-- This migration adds:
--
--   1. `invitations.last_reminded_at` — the system-driven analog
--      of `last_resent_at`. Kept separate so audit logs can tell
--      "the inviter resent" from "the cron nudged" — operators
--      asked us not to conflate these because they imply
--      different next actions for support.
--
--   2. A `dispatch_invitation_reminders()` Postgres function that
--      pg_net-pokes the new `invitation-reminders` edge function.
--      The edge function does the actual selection + email send
--      (richer error handling than SQL); this function exists
--      only so pg_cron has something to schedule.
--
--   3. A pg_cron entry that runs the dispatcher every hour. Hourly
--      cadence is the right floor: an email reminder lands within
--      ~60 minutes of crossing the day-3 threshold, but the cron
--      itself only generates 24 net.http_post calls per day no
--      matter how many invites are in flight.
--
-- Reminder windows are intentionally implemented in the edge
-- function, not here, because the edge function can take advantage
-- of `auth.admin.inviteUserByEmail` and structured rejection
-- handling that's awkward in plpgsql. SQL stays a thin scheduler.
-- ============================================================

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;

COMMENT ON COLUMN public.invitations.last_reminded_at IS
  'Most recent timestamp at which the system (NOT the inviter) sent an automated reminder email for this invite. Kept distinct from last_resent_at so audit logs can attribute "system nudge" vs "inviter clicked Resend".';

-- The dispatcher: a thin wrapper around net.http_post so pg_cron
-- has something to schedule. The edge function is responsible for
-- choosing which invites to remind on this tick.
CREATE OR REPLACE FUNCTION public.dispatch_invitation_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_url  text;
  v_auth text;
BEGIN
  v_url  := public.mushi_runtime_supabase_url();
  v_auth := public.mushi_internal_auth_header();

  IF v_url IS NULL OR v_url = '' THEN
    RAISE WARNING 'dispatch_invitation_reminders: mushi_runtime_config.supabase_url missing';
    RETURN;
  END IF;
  IF v_auth IS NULL THEN
    -- Without an internal caller token the edge function would
    -- 401 on every cron tick. Fail closed and surface the gap to
    -- ops via the cron_runs audit instead of silently spinning.
    RAISE WARNING 'dispatch_invitation_reminders: mushi_internal_caller_token missing in mushi_runtime_config';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/invitation-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', v_auth
    ),
    body    := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_invitation_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_invitation_reminders() TO service_role, postgres;

COMMENT ON FUNCTION public.dispatch_invitation_reminders() IS
  'Cron-only entrypoint. Pings the invitation-reminders edge function with the internal caller token. The edge function selects which invites need a nudge and sends the actual emails. Idempotent: re-running this within the same hour is harmless because the edge function de-dupes via last_reminded_at.';

-- Hourly schedule, offset by 23 minutes to stay clear of the
-- top-of-hour congestion that other system crons (queue recovery,
-- pipeline reconciliation) live on. cron.schedule is idempotent
-- on the same job name.
SELECT cron.schedule(
  'dispatch_invitation_reminders',
  '23 * * * *',
  $$ SELECT public.dispatch_invitation_reminders(); $$
);
