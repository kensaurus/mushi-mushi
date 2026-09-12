/*
FILE: 20260912005000_user_push_subscriptions.sql
PURPOSE: Developer Web Push — per-user push subscriptions for the installed
         admin PWA (plan docs/execplans/dead-code-voice-agent-loop.md, C5
         "Developer Web Push is a new surface").

OVERVIEW:
- user_push_subscriptions: one row per (user, push endpoint). The admin PWA
  calls PushManager.subscribe() from a user gesture and POSTs the
  { endpoint, keys: { p256dh, auth } } tuple to POST /v1/push/subscriptions.
  `_shared/web-push.ts sendWebPushToUser()` fans a notification out to every
  row for a user; a 404/410 from the push service deletes the row, a success
  stamps last_success_at, anything else bumps failure_count / last_failure_at.
- project_id is optional context ("which project was active when the device
  subscribed") so the console can show per-project device lists later; the
  subscription itself belongs to the user, not the project.
- The endpoint host is allow-listed in the API before insert (FCM, Mozilla,
  Apple, WNS) so a stored row can never become an SSRF target for the sender.

RLS: owner-only — auth.uid() = user_id for SELECT / INSERT / DELETE. The
     service role (edge functions) bypasses RLS and does the actual writes;
     the policies exist so a future client-side reader stays scoped.

DEPENDENCIES:
- auth.users, public.projects

Idempotent: safe to re-run.
*/

CREATE TABLE IF NOT EXISTS public.user_push_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id       uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  endpoint         text NOT NULL,
  p256dh           text NOT NULL,
  auth             text NOT NULL,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  failure_count    integer NOT NULL DEFAULT 0,
  CONSTRAINT user_push_subscriptions_user_endpoint_key UNIQUE (user_id, endpoint),
  CONSTRAINT user_push_subscriptions_endpoint_https CHECK (endpoint ~ '^https://'),
  CONSTRAINT user_push_subscriptions_failure_count_nonneg CHECK (failure_count >= 0)
);

COMMENT ON TABLE public.user_push_subscriptions IS
  'Web Push subscriptions for signed-in console users (installed admin PWA). Written by POST /v1/push/subscriptions; consumed by _shared/web-push.ts sendWebPushToUser().';
COMMENT ON COLUMN public.user_push_subscriptions.endpoint IS
  'Push service URL from PushSubscription.endpoint. Host allow-listed at write time (fcm.googleapis.com, *.push.services.mozilla.com, *.push.apple.com, *.notify.windows.com).';
COMMENT ON COLUMN public.user_push_subscriptions.p256dh IS
  'Base64url client ECDH P-256 public key (PushSubscription.getKey(''p256dh'')).';
COMMENT ON COLUMN public.user_push_subscriptions.auth IS
  'Base64url 16-byte auth secret (PushSubscription.getKey(''auth'')).';
COMMENT ON COLUMN public.user_push_subscriptions.failure_count IS
  'Consecutive non-2xx, non-410 deliveries. Reset to 0 on success. 404/410 delete the row outright.';

CREATE INDEX IF NOT EXISTS user_push_subscriptions_user_idx
  ON public.user_push_subscriptions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_push_subscriptions_project_idx
  ON public.user_push_subscriptions (project_id)
  WHERE project_id IS NOT NULL;

ALTER TABLE public.user_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_push_subscriptions_owner_select ON public.user_push_subscriptions;
CREATE POLICY user_push_subscriptions_owner_select ON public.user_push_subscriptions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_push_subscriptions_owner_insert ON public.user_push_subscriptions;
CREATE POLICY user_push_subscriptions_owner_insert ON public.user_push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_push_subscriptions_owner_delete ON public.user_push_subscriptions;
CREATE POLICY user_push_subscriptions_owner_delete ON public.user_push_subscriptions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON public.user_push_subscriptions FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.user_push_subscriptions TO authenticated;
