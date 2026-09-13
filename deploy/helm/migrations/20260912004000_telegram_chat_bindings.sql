/*
FILE: 20260912004000_telegram_chat_bindings.sql
PURPOSE: Telegram voice inbox — chat-to-project binding + webhook secret
         (plan docs/execplans/dead-code-voice-agent-loop.md, C1 "Telegram").

OVERVIEW:
- telegram_bind_codes: one-time 6-char codes minted from the console
  (POST /v1/admin/telegram/bind-code). The user sends `/start <code>` to the
  project's bot; the telegram-webhook function consumes the code (used_at)
  and inserts a telegram_chat_bindings row. 10-minute TTL, single use.
- telegram_chat_bindings: which Telegram chats may drive which project.
  (chat_id, project_id) is the key — a group chat may be bound to several
  projects, each behind its own bot/webhook URL.
- project_settings.telegram_webhook_secret_hash: sha256 of the `secret_token`
  passed to Telegram `setWebhook`; the webhook compares it in constant time
  against `X-Telegram-Bot-Api-Secret-Token`. The raw secret is never stored.

RLS: mirrors project_settings — project members (org membership via
     private.is_project_member) can SELECT; only the service role writes.

DEPENDENCIES:
- public.projects, public.project_settings
- private.is_project_member(uuid)   (20260428000000_organizations.sql)

Idempotent: safe to re-run.
*/

-- ── project_settings ───────────────────────────────────────────────────────

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS telegram_webhook_secret_hash text;

COMMENT ON COLUMN public.project_settings.telegram_webhook_secret_hash IS
  'sha256 hex of the Telegram setWebhook secret_token; verified by the telegram-webhook edge function. Raw secret is never persisted.';

-- ── telegram_bind_codes ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.telegram_bind_codes (
  code        text PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  CONSTRAINT telegram_bind_codes_code_format CHECK (code ~ '^[A-Z0-9]{6}$')
);

COMMENT ON TABLE public.telegram_bind_codes IS
  'One-time /start codes that bind a Telegram chat to a project (10 min TTL, single use).';

CREATE INDEX IF NOT EXISTS telegram_bind_codes_project_expires_idx
  ON public.telegram_bind_codes (project_id, expires_at);

-- Sweep target: expired or consumed codes older than a day are garbage.
CREATE INDEX IF NOT EXISTS telegram_bind_codes_expires_at_idx
  ON public.telegram_bind_codes (expires_at);

ALTER TABLE public.telegram_bind_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_bind_codes_member_select ON public.telegram_bind_codes;
CREATE POLICY telegram_bind_codes_member_select ON public.telegram_bind_codes
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

REVOKE ALL ON public.telegram_bind_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.telegram_bind_codes TO authenticated;

-- ── telegram_chat_bindings ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.telegram_chat_bindings (
  chat_id                    text NOT NULL,
  project_id                 uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  bound_by_telegram_user_id  text,
  bound_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, project_id)
);

COMMENT ON TABLE public.telegram_chat_bindings IS
  'Telegram chats allowed to submit voice/text intake for a project. Written only by the telegram-webhook function (/start <code>) and the console DELETE route.';

CREATE INDEX IF NOT EXISTS telegram_chat_bindings_project_idx
  ON public.telegram_chat_bindings (project_id, bound_at DESC);

ALTER TABLE public.telegram_chat_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_chat_bindings_member_select ON public.telegram_chat_bindings;
CREATE POLICY telegram_chat_bindings_member_select ON public.telegram_chat_bindings
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

REVOKE ALL ON public.telegram_chat_bindings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.telegram_chat_bindings TO authenticated;
