-- ops_mutes.scope: a mute covers one alert, not the whole app (2026-11-20).
-- The Slack "Mute 24h" button muted every message of the app, payments and
-- releases included (ops-events.ts muteProject). It now mutes one alert: its
-- category, kind and fingerprint (ops-format.ts opsMuteScope, e.g.
-- `alerts:deploy.failed:fp:android 1.22.62 release failed`). The empty scope
-- stays the whole app, which is what the `mute <app> <2h|1d>` slash command
-- sets and what every row before this migration means.
--
-- The pair (organization_id, project_id) is no longer unique: one app can have
-- an app-wide mute and several one-alert mutes. The new key adds scope, so
-- `upsert(..., { onConflict: 'organization_id,project_id,scope' })` works.
-- The primary key stays `id` (20261118040000): a composite key of the two
-- foreign keys made PostgREST read the table as a junction (PGRST201).
--
-- Additive for readers: the code selects `*` and treats a missing scope as
-- app-wide, so it runs before and after this migration. Before it, a one-alert
-- mute answers "waiting for database update" and mutes nothing.
--
-- Verify:
--   select column_name, column_default, is_nullable from information_schema.columns
--     where table_name = 'ops_mutes' and column_name = 'scope';   -- '' , NO
--   select conname from pg_constraint where conrelid = 'public.ops_mutes'::regclass and contype = 'u';
--     -- ops_mutes_org_project_scope_key only
ALTER TABLE public.ops_mutes ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT '';
ALTER TABLE public.ops_mutes DROP CONSTRAINT IF EXISTS ops_mutes_scope_check;
ALTER TABLE public.ops_mutes ADD CONSTRAINT ops_mutes_scope_check CHECK (char_length(scope) <= 300);
ALTER TABLE public.ops_mutes DROP CONSTRAINT IF EXISTS ops_mutes_org_project_key;
ALTER TABLE public.ops_mutes DROP CONSTRAINT IF EXISTS ops_mutes_org_project_scope_key;
ALTER TABLE public.ops_mutes ADD CONSTRAINT ops_mutes_org_project_scope_key UNIQUE (organization_id, project_id, scope);

COMMENT ON COLUMN public.ops_mutes.scope IS
  'What the mute covers: '''' = every message of the app (slash command `mute <app>`); `<category>:<kind>:<fingerprint>` = one alert (the Slack Mute 24h option, ops-format.ts opsMuteScope).';

NOTIFY pgrst, 'reload schema';
