/*
FILE: 20260912009000_publish_voice_intake_sessions_realtime.sql
PURPOSE: Make the console's voice session list actually live-update.

OVERVIEW:
`apps/admin/src/pages/VoicePage.tsx:80` calls
`useRealtimeReload(['voice_intake_sessions'], reload, …)`, but
20260912002000_voice_intake_sessions.sql never added the table to the
`supabase_realtime` publication. The subscription is created, the channel
joins, and no row event ever arrives — the list only refreshes when the
operator presses Refresh. Nothing errors, which is why it went unnoticed.

This is the same omission 20260520930000_publish_synthetic_runs_realtime.sql
fixed for `synthetic_runs`. Confirmed against production on 2026-09-12:
`supabase_realtime` carried 16 tables and `voice_intake_sessions` was not one
of them.

The subscription filters on project_id, so only the active project's rows fan
out to each connected admin session. RLS on the table still applies to realtime
delivery, so publishing it does not widen who can read what.

DEPENDENCIES: public.voice_intake_sessions, publication supabase_realtime

Idempotent: re-adding a published table raises 42710, so this checks
pg_publication_tables first (the synthetic_runs migration only guarded on the
table existing, which is not re-runnable).
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'voice_intake_sessions'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'voice_intake_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_intake_sessions;
  END IF;
END;
$$;
