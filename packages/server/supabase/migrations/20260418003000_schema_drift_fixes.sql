-- =============================================================================
-- Schema drift fixes: align migration files with live DB columns referenced
-- by edge functions. Adds the missing `sentry_seer_token_ref` column needed
-- by the upcoming `sentry-seer-poll` edge function and idempotently re-declares
-- the Seer columns referenced at packages/server/supabase/functions/api/index.ts:3237
-- so a fresh `supabase db reset` matches production.
--
-- Idempotent: safe to re-run; uses `add column if not exists`.
-- =============================================================================

alter table project_settings
  add column if not exists sentry_org_slug         text,
  add column if not exists sentry_project_slug     text,
  add column if not exists sentry_auth_token_ref   text,
  add column if not exists sentry_seer_enabled     boolean default false,
  add column if not exists sentry_seer_token_ref   text,
  add column if not exists sentry_seer_last_polled_at  timestamptz;

comment on column project_settings.sentry_seer_enabled is
  'When true, the sentry-seer-poll cron pulls Seer root-cause analysis into matched reports.';
comment on column project_settings.sentry_seer_token_ref is
  'Vault ref for the Sentry auth token used by the Seer poller. Falls back to sentry_auth_token_ref when null.';
comment on column project_settings.sentry_seer_last_polled_at is
  'Last successful Seer poll. Used as a since-cursor by the poller.';

-- Add a partial index so the poller can cheaply select only enabled projects.
create index if not exists idx_project_settings_seer_enabled
  on project_settings(project_id)
  where sentry_seer_enabled = true;
