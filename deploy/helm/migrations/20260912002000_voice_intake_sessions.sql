/*
FILE: 20260912002000_voice_intake_sessions.sql
PURPOSE: One row per voice/text request that entered the voice inbox
         (plan docs/execplans/dead-code-voice-agent-loop.md, C1/C3/C5).

OVERVIEW:
- Idempotency: (project_id, source, external_id) is unique. Telegram uses
  `telegram:<update_id>`, Slack `slack:<event_id>` / `slack:cmd:<trigger_id>`,
  the iOS Shortcut its Idempotency-Key, the PWA a client uuid.
- Confirmation gate: an `open_draft_pr` intent parks the row in
  `awaiting_confirm` with the sha256 of a single-use HMAC confirm token and a
  10-minute `expires_at`. `confirmed` → `dispatched` (fix_dispatch_jobs id in
  dispatch_id) → `notified` once the return path posted the PR link back into
  the originating channel (`channel` jsonb: Slack channel/thread, Telegram
  chat/message, or the admin user id for web push).
- `refused` records privileged-verb refusals (merge/deploy/delete… in EN + JA)
  with the verbatim transcript so the operator can audit false positives.
- Audio: `audio_path` points into the private `voice-intake` bucket only while
  the project retains audio; `audio_sha256` is the audit trail after deletion.

RLS: project members (private.is_project_member) can SELECT; only the service
     role writes. Mirrors telegram_chat_bindings / end_user_sessions.

DEPENDENCIES:
- public.projects, public.reports
- public.update_updated_at_column()  (20260416000000_phase0_initial_schema.sql)
- private.is_project_member(uuid)     (20260428000000_organizations.sql)

Idempotent: safe to re-run.
*/

CREATE TABLE IF NOT EXISTS public.voice_intake_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  report_id           uuid        REFERENCES public.reports(id) ON DELETE SET NULL,
  source              text        NOT NULL CHECK (source IN ('ios_shortcut', 'slack', 'telegram', 'pwa', 'api')),
  external_id         text        NOT NULL,
  status              text        NOT NULL DEFAULT 'received' CHECK (
    status IN (
      'received', 'transcribed', 'awaiting_confirm', 'confirmed', 'dispatched',
      'notified', 'refused', 'cancelled', 'failed', 'expired'
    )
  ),
  transcript          text,
  transcript_sha256   text,
  audio_path          text,
  audio_sha256        text,
  audio_duration_sec  numeric,
  language            text,
  action              text        CHECK (action IS NULL OR action IN ('create_report', 'open_draft_pr', 'unknown')),
  summary             text,
  refusal_reason      text,
  confirm_token_hash  text,
  expires_at          timestamptz,
  channel             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  requested_by        text,
  dispatch_id         uuid,
  pr_url              text,
  confirmed_at        timestamptz,
  confirmed_by        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_intake_sessions_external_key UNIQUE (project_id, source, external_id)
);

COMMENT ON TABLE public.voice_intake_sessions IS
  'Voice inbox ledger: one row per phone/Slack/Telegram/PWA request, from receipt through the confirmation gate to the PR link posted back to the phone.';
COMMENT ON COLUMN public.voice_intake_sessions.status IS
  'received → transcribed → (awaiting_confirm → confirmed) → dispatched → notified. Terminal: refused (privileged verb), cancelled, failed (refusal_reason holds the error), expired (confirm window passed). create_report intents go straight to confirmed.';
COMMENT ON COLUMN public.voice_intake_sessions.confirm_token_hash IS
  'sha256 of the single-use HMAC confirm token handed to the caller. Cleared on confirm/cancel; the raw token is never stored.';
COMMENT ON COLUMN public.voice_intake_sessions.channel IS
  'Where to reply: { slackChannelId, slackThreadTs, slackUserId } | { telegramChatId, telegramMessageId } | { userId } (web push). Adapters may add their own keys.';
COMMENT ON COLUMN public.voice_intake_sessions.refusal_reason IS
  'For status refused: the privileged verbs matched. For status failed: the error class (no secrets, no stack traces).';

CREATE INDEX IF NOT EXISTS voice_intake_sessions_project_created_idx
  ON public.voice_intake_sessions (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS voice_intake_sessions_report_idx
  ON public.voice_intake_sessions (report_id)
  WHERE report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS voice_intake_sessions_status_expires_idx
  ON public.voice_intake_sessions (status, expires_at);

-- Retention sweep target: retained audio objects older than the project's window.
CREATE INDEX IF NOT EXISTS voice_intake_sessions_audio_created_idx
  ON public.voice_intake_sessions (project_id, created_at)
  WHERE audio_path IS NOT NULL;

DROP TRIGGER IF EXISTS voice_intake_sessions_updated_at ON public.voice_intake_sessions;
CREATE TRIGGER voice_intake_sessions_updated_at
  BEFORE UPDATE ON public.voice_intake_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.voice_intake_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voice_intake_sessions_member_select ON public.voice_intake_sessions;
CREATE POLICY voice_intake_sessions_member_select ON public.voice_intake_sessions
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

REVOKE ALL ON public.voice_intake_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.voice_intake_sessions TO authenticated;

NOTIFY pgrst, 'reload schema';
