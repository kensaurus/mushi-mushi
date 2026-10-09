/*
FILE: 20260912001000_voice_scope_settings_reports.sql
PURPOSE: Voice intake (plan docs/execplans/dead-code-voice-agent-loop.md, C1/C3/C6):
         the narrow `voice:write` API-key scope, per-project voice settings, and the
         report columns that carry a voice-originated report's provenance.

OVERVIEW:
- project_api_keys.scopes CHECK gains 'voice:write'. A key that lives on a phone
  (iOS Shortcut) must not be able to call every admin route, so the voice route
  accepts this scope only (plus a logged-in admin JWT). `api_key_has_scope` needs
  no change: its ELSE branch already answers `p_required = ANY(p_scopes)` for any
  scope other than mcp:read; only the comment is refreshed.
- project_settings: voice_intake_enabled (default off — voice is personal data),
  voice_audio_retention_days (0 = delete the audio object right after the
  transcript is persisted), voice_languages (STT hint list), telegram_bot_token_ref
  and github_user_token_ref (vault:// references, never raw secrets).
- reports: source (which inbox created the report), voice_transcript, the audio
  object path + sha256 (audit trail even when the object has been deleted) and
  the detected language.

DATA UPDATE: the final statement backfills reports.source = 'sentry' for rows that
the Sentry webhook created (custom_metadata->>'source' = 'sentry_webhook'). It is
kept separate and clearly marked so the operator can confirm it before applying.

Idempotent: safe to re-run.
*/

-- ── 1. project_api_keys.scopes: allow 'voice:write' ────────────────────────

ALTER TABLE public.project_api_keys
  DROP CONSTRAINT IF EXISTS project_api_keys_scopes_valid;

ALTER TABLE public.project_api_keys
  ADD CONSTRAINT project_api_keys_scopes_valid
  CHECK (
    scopes <@ array['report:write', 'mcp:read', 'mcp:write', 'activity:write', 'rewards:read', 'voice:write']::text[]
    AND cardinality(scopes) > 0
  );

-- api_key_has_scope(text[], text) is unchanged: `ELSE p_required = ANY(p_scopes)`
-- already grants 'voice:write' iff the key carries it. Refresh the comment only.
COMMENT ON FUNCTION public.api_key_has_scope(text[], text) IS
  'True iff p_scopes grants p_required. mcp:write implies mcp:read. Other scopes (activity:write, rewards:read, voice:write) must be present verbatim.';

-- ── 2. project_settings: voice intake toggles ──────────────────────────────

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS voice_intake_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_audio_retention_days  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_languages             text[]  NOT NULL DEFAULT array['en']::text[],
  ADD COLUMN IF NOT EXISTS telegram_bot_token_ref      text,
  ADD COLUMN IF NOT EXISTS github_user_token_ref       text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_settings_voice_audio_retention_days_range'
      AND conrelid = 'public.project_settings'::regclass
  ) THEN
    ALTER TABLE public.project_settings
      ADD CONSTRAINT project_settings_voice_audio_retention_days_range
      CHECK (voice_audio_retention_days >= 0 AND voice_audio_retention_days <= 365);
  END IF;
END $$;

COMMENT ON COLUMN public.project_settings.voice_intake_enabled IS
  'Master switch for POST /v1/intake/voice and the Slack/Telegram/PWA voice inboxes. Off by default: voice is personal data (GDPR / APPI).';
COMMENT ON COLUMN public.project_settings.voice_audio_retention_days IS
  '0 = delete the audio object from the voice-intake bucket as soon as the transcript is persisted. >0 = keep it that many days (retention-sweep deletes it).';
COMMENT ON COLUMN public.project_settings.voice_languages IS
  'BCP-47 language hints passed to speech-to-text (gpt-transcribe languages[]). First entry is the fallback model''s single `language`.';
COMMENT ON COLUMN public.project_settings.telegram_bot_token_ref IS
  'vault://<name> reference to the per-project Telegram bot token (from @BotFather). Never a raw token.';
COMMENT ON COLUMN public.project_settings.github_user_token_ref IS
  'vault://<name> reference to a user-to-server GitHub token (fine-grained PAT) for the GitHub cloud-agent adapter, which rejects installation tokens.';

-- ── 3. reports: provenance for voice-originated reports ────────────────────

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'widget',
  ADD COLUMN IF NOT EXISTS voice_transcript   text,
  ADD COLUMN IF NOT EXISTS voice_audio_path   text,
  ADD COLUMN IF NOT EXISTS voice_audio_sha256 text,
  ADD COLUMN IF NOT EXISTS voice_language     text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reports_source_check'
      AND conrelid = 'public.reports'::regclass
  ) THEN
    ALTER TABLE public.reports
      ADD CONSTRAINT reports_source_check
      CHECK (source IN ('widget', 'sdk', 'sentry', 'slack', 'voice', 'api', 'linear'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_project_source
  ON public.reports (project_id, source)
  WHERE source <> 'widget';

COMMENT ON COLUMN public.reports.source IS
  'Which inbox created the report: widget (SDK banner), sdk (programmatic), sentry (webhook), slack, voice (phone voice intake), api, linear.';
COMMENT ON COLUMN public.reports.voice_transcript IS
  'Sanitised, PII-scrubbed speech-to-text transcript for source = voice. The description column holds the same text; this column survives description edits.';
COMMENT ON COLUMN public.reports.voice_audio_path IS
  'Object path inside the voice-intake bucket while the audio is retained (voice_audio_retention_days > 0). NULL once deleted.';
COMMENT ON COLUMN public.reports.voice_audio_sha256 IS
  'sha256 of the original audio bytes — audit trail that outlives the (deleted) object.';
COMMENT ON COLUMN public.reports.voice_language IS
  'Language detected by speech-to-text (BCP-47), when the provider returned one.';

NOTIFY pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════
-- DATA UPDATE — REQUIRES OPERATOR CONFIRMATION BEFORE APPLYING
--
-- Backfill reports.source for rows the Sentry webhook created before the
-- column existed. Touches only rows still on the 'widget' default whose
-- custom_metadata says they came from the Sentry webhook.
-- ══════════════════════════════════════════════════════════════════════════
UPDATE public.reports
   SET source = 'sentry'
 WHERE source = 'widget'
   AND custom_metadata->>'source' = 'sentry_webhook';
