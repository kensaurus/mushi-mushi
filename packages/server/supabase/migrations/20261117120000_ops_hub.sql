-- ============================================================================
-- 20261117120000_ops_hub (docs/execplans/ops-hub-slack.md)
--
-- ADDITIVE: apply BEFORE deploying api, api-ext, webhooks-github-indexer and
-- site-watch-poll. Until it is applied the ops routes answer 409
-- MIGRATION_PENDING and the built-in sources skip (they read
-- ops_slack_settings first and treat a missing table as "off").
--
-- Mushi Mushi becomes the hub for an app's operational events: an app sends one
-- event (POST /v1/ops/events, key scope ops:write), Mushi Mushi stores it, shows
-- it on the console's Ops page and posts it to Slack with the team's own bot,
-- which threads follow-ups, takes button clicks and answers a slash command.
--
-- 1. ops_events: one row per event. `dedupe_key` makes a retried sender post
--    once; `thread_key` groups an incident with its follow-ups (a failed deploy
--    and the next good one); `parent_id` is the first event of that thread in
--    the same category (Slack threads live in one channel).
-- 2. ops_slack_settings: one row per organization. Secrets live in Vault; the
--    row holds only their ids. Service role only: the API answers "set / not
--    set", never a value.
-- 3. ops_mutes: an app muted until a time; events are stored, Slack skipped.
-- 4. project_api_keys.scopes gains 'ops:write' (server-side key for one app's
--    events). Every value the CHECK allowed before (20261027150000) is kept.
-- 5. ops_coverage(uuid): per app and category, the last event and the count in
--    7 days, plus the same for bug reports (last 90 days). Service role only.
--
-- Verify:
--   select relrowsecurity from pg_class where relname in ('ops_events','ops_slack_settings','ops_mutes'); -- t,t,t
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'project_api_keys_scopes_valid'; -- lists ops:write
--   select proname, prosecdef from pg_proc where proname = 'ops_coverage'; -- t
-- ============================================================================

-- ── project_api_keys.scopes: allow 'ops:write' ──────────────────────────────
ALTER TABLE public.project_api_keys
  DROP CONSTRAINT IF EXISTS project_api_keys_scopes_valid;

ALTER TABLE public.project_api_keys
  ADD CONSTRAINT project_api_keys_scopes_valid
  CHECK (
    scopes <@ array['report:write', 'mcp:read', 'mcp:write', 'activity:write', 'rewards:read', 'voice:write', 'runner:write', 'worker:run', 'ops:write']::text[]
    AND cardinality(scopes) > 0
  );

-- api_key_has_scope(text[], text) is unchanged: `ELSE p_required = ANY(p_scopes)`
-- grants 'ops:write' only when the key carries it. Refresh the comment only.
COMMENT ON FUNCTION public.api_key_has_scope(text[], text) IS
  'True iff p_scopes grants p_required. mcp:write implies mcp:read. Other scopes (activity:write, rewards:read, voice:write, runner:write, worker:run, ops:write) must be present verbatim.';

-- ── ops_events ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id       uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  category         text NOT NULL CHECK (category IN ('payments', 'releases', 'alerts')),
  severity         text NOT NULL CHECK (severity IN ('info', 'warn', 'urgent', 'resolved')),
  kind             text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$' AND char_length(kind) <= 60),
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 150),
  body             text CHECK (body IS NULL OR char_length(body) <= 600),
  facts            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(facts) = 'array' AND jsonb_array_length(facts) <= 8),
  url              text CHECK (url IS NULL OR (url ~ '^https://' AND char_length(url) <= 2000)),
  amount_minor     bigint,
  currency         text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  thread_key       text CHECK (thread_key IS NULL OR char_length(thread_key) BETWEEN 1 AND 200),
  dedupe_key       text CHECK (dedupe_key IS NULL OR char_length(dedupe_key) BETWEEN 1 AND 200),
  parent_id        uuid REFERENCES public.ops_events(id) ON DELETE SET NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  source           text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'github', 'sentry', 'uptime', 'mushi')),
  slack_channel    text CHECK (slack_channel IS NULL OR char_length(slack_channel) <= 40),
  slack_ts         text CHECK (slack_ts IS NULL OR char_length(slack_ts) <= 40),
  slack_thread_ts  text CHECK (slack_thread_ts IS NULL OR char_length(slack_thread_ts) <= 40),
  slack_error      text CHECK (slack_error IS NULL OR char_length(slack_error) <= 300),
  acked_by         text CHECK (acked_by IS NULL OR char_length(acked_by) <= 120),
  acked_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_events_amount_has_currency CHECK ((amount_minor IS NULL) = (currency IS NULL))
);

COMMENT ON TABLE public.ops_events IS
  'Operational events for the Ops hub (docs/execplans/ops-hub-slack.md): payments, releases and alerts from an app (POST /v1/ops/events, ops:write key) or from Mushi Mushi''s own sources (GitHub deployments, Sentry, edge canaries). Slack delivery state in slack_*; ack in acked_*. Service role writes; org members read.';

CREATE UNIQUE INDEX IF NOT EXISTS ops_events_org_dedupe_key
  ON public.ops_events (organization_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_events_org_time
  ON public.ops_events (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_events_org_thread
  ON public.ops_events (organization_id, thread_key) WHERE thread_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_events_project_category_time
  ON public.ops_events (project_id, category, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_events_parent
  ON public.ops_events (parent_id) WHERE parent_id IS NOT NULL;

ALTER TABLE public.ops_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_events_member_select ON public.ops_events;
CREATE POLICY ops_events_member_select ON public.ops_events
  FOR SELECT TO authenticated USING ((SELECT private.is_org_member(organization_id)));
DROP POLICY IF EXISTS ops_events_service_write ON public.ops_events;
CREATE POLICY ops_events_service_write ON public.ops_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.ops_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ops_events FROM authenticated;

-- ── ops_slack_settings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_slack_settings (
  organization_id             uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled                     boolean NOT NULL DEFAULT false,
  team_id                     text CHECK (team_id IS NULL OR team_id ~ '^T[A-Z0-9]{2,20}$'),
  bot_user_id                 text CHECK (bot_user_id IS NULL OR bot_user_id ~ '^[UW][A-Z0-9]{2,20}$'),
  bot_token_secret_id         uuid,
  signing_secret_id           uuid,
  payments_webhook_secret_id  uuid,
  releases_webhook_secret_id  uuid,
  alerts_webhook_secret_id    uuid,
  channel_payments            text CHECK (channel_payments IS NULL OR channel_payments ~ '^[CG][A-Z0-9]{2,20}$'),
  channel_releases            text CHECK (channel_releases IS NULL OR channel_releases ~ '^[CG][A-Z0-9]{2,20}$'),
  channel_alerts              text CHECK (channel_alerts IS NULL OR channel_alerts ~ '^[CG][A-Z0-9]{2,20}$'),
  command                     text NOT NULL DEFAULT '/mushi-ops' CHECK (command ~ '^/[a-z0-9][a-z0-9_-]{0,31}$'),
  icon_base_url               text CHECK (icon_base_url IS NULL OR (icon_base_url ~ '^https://' AND char_length(icon_base_url) <= 500)),
  updated_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ops_slack_settings IS
  'The organization''s own Slack bot for the Ops hub: Vault ids of the bot token, signing secret and optional per-channel incoming webhooks, the three channel ids and the slash command name. Service role only; GET /v1/admin/ops/slack-settings answers set / not set, never a secret.';

CREATE UNIQUE INDEX IF NOT EXISTS ops_slack_settings_team_key
  ON public.ops_slack_settings (team_id) WHERE team_id IS NOT NULL;

ALTER TABLE public.ops_slack_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_slack_settings_service_all ON public.ops_slack_settings;
CREATE POLICY ops_slack_settings_service_all ON public.ops_slack_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.ops_slack_settings FROM anon, authenticated;

-- ── ops_mutes ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_mutes (
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  until            timestamptz NOT NULL,
  muted_by         text CHECK (muted_by IS NULL OR char_length(muted_by) <= 120),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id)
);

COMMENT ON TABLE public.ops_mutes IS
  'An app whose Ops events skip Slack until `until` (Mute 24h button, `mute <app> <2h|1d>` command). Events are still stored. Service role writes; org members read.';

ALTER TABLE public.ops_mutes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_mutes_member_select ON public.ops_mutes;
CREATE POLICY ops_mutes_member_select ON public.ops_mutes
  FOR SELECT TO authenticated USING ((SELECT private.is_org_member(organization_id)));
DROP POLICY IF EXISTS ops_mutes_service_write ON public.ops_mutes;
CREATE POLICY ops_mutes_service_write ON public.ops_mutes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.ops_mutes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ops_mutes FROM authenticated;

-- ── ops_coverage(org) ───────────────────────────────────────────────────────
-- "Which app is silent": per app of the organization and per category (plus
-- 'bugs' from reports), the last time it reported and how often in 7 days.
CREATE OR REPLACE FUNCTION public.ops_coverage(p_organization_id uuid)
RETURNS TABLE (project_id uuid, category text, last_at timestamptz, count_7d bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.project_id, e.category, max(e.occurred_at) AS last_at,
         count(*) FILTER (WHERE e.occurred_at > now() - interval '7 days') AS count_7d
    FROM public.ops_events e
   WHERE e.organization_id = p_organization_id
     AND e.project_id IS NOT NULL
   GROUP BY e.project_id, e.category
  UNION ALL
  SELECT r.project_id, 'bugs'::text AS category, max(r.created_at) AS last_at,
         count(*) FILTER (WHERE r.created_at > now() - interval '7 days') AS count_7d
    FROM public.reports r
    JOIN public.projects p ON p.id = r.project_id
   WHERE p.organization_id = p_organization_id
     -- Bounded: a busy app has many reports; "last report" older than 90 days reads as never.
     AND r.created_at > now() - interval '90 days'
   GROUP BY r.project_id;
$$;

REVOKE ALL ON FUNCTION public.ops_coverage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_coverage(uuid) TO service_role;

COMMENT ON FUNCTION public.ops_coverage(uuid) IS
  'Per app and category (payments, releases, alerts, bugs): last event time and count over 7 days, for GET /v1/admin/ops/coverage. Service role only.';
