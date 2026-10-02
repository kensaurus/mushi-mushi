-- ============================================================================
-- 20261002120300_reporter_prefs_push_settings
--
-- Plan 018 (docs/execplans/reporter-loop-v2.md §6.1, migration 4).
--
-- reporter_notification_prefs gains what double opt-in email needs (Phase 3
-- writes them; nothing writes them yet):
--   email_verified_at, email_verify_token_hash, unsubscribed_at, end_user_id
-- project_settings gains the reporter-update controls:
--   reporter_updates_mode   'auto' (default) sends pipeline messages at once;
--                           'review' holds them in the console Outbox
--   reporter_templates      per-project copy overrides (Phase 3)
--   reporter_email_enabled / reporter_push_enabled  per-project channel gates
--
-- Reporter tables stay service-role only (RESTRICTIVE deny-all policies from
-- 20260613124411 are unchanged).
-- ============================================================================

alter table public.reporter_notification_prefs
  add column if not exists email_verified_at timestamptz,
  add column if not exists email_verify_token_hash text,
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists end_user_id uuid references public.end_users(id) on delete set null;

create index if not exists reporter_notification_prefs_end_user_idx
  on public.reporter_notification_prefs (end_user_id)
  where end_user_id is not null;

alter table public.project_settings
  add column if not exists reporter_updates_mode text not null default 'auto',
  add column if not exists reporter_templates jsonb not null default '{}'::jsonb,
  add column if not exists reporter_email_enabled boolean default false,
  add column if not exists reporter_push_enabled boolean default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_settings_reporter_updates_mode_check') then
    alter table public.project_settings
      add constraint project_settings_reporter_updates_mode_check
      check (reporter_updates_mode in ('auto', 'review'));
  end if;
end $$;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
