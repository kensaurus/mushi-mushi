-- ============================================================================
-- FILE: 20260921000005_lifecycle_emails.sql
-- PURPOSE: Lifecycle (activation) emails — docs/plan-gtm.md → Workstream B §3.
--   * lifecycle_email_sends   — idempotency ledger, one row per (user, email)
--   * lifecycle_email_optout  — signed-link / console-toggle opt-out
--   * mushi_runtime_config.lifecycle_emails_enabled = 'false' (kill switch)
--   * dispatch_lifecycle_emails() — pg_net poke of the lifecycle-emails edge
--     function, scheduled hourly at :37. Returns early while the kill switch
--     is off, so applying this migration is SAFE before RESEND_FROM_EMAIL
--     points at a verified sending domain. Flip with:
--       update public.mushi_runtime_config set value = 'true', updated_at = now()
--        where key = 'lifecycle_emails_enabled';
--
-- Pattern copied from 20260507160000_invitation_reminders.sql (dispatcher +
-- cron.schedule). Selection, windows and exits live in the edge function.
--
-- Idempotent: IF NOT EXISTS / ON CONFLICT / OR REPLACE throughout.
-- ============================================================================

-- ── 1. Send ledger ──────────────────────────────────────────────────────────
create table if not exists public.lifecycle_email_sends (
  user_id   uuid        not null references auth.users(id) on delete cascade,
  email_key text        not null
                        check (email_key in ('day0_welcome', 'day2_nudge', 'day7_stalled', 'day7_activated')),
  sent_at   timestamptz not null default now(),
  primary key (user_id, email_key)
);

comment on table public.lifecycle_email_sends is
  'One row per lifecycle email actually sent (or claimed) per user. The PK is the idempotency guarantee: the cron inserts before sending and skips on conflict. Service role only.';

alter table public.lifecycle_email_sends enable row level security;
revoke all on table public.lifecycle_email_sends from public, anon, authenticated;

-- ── 2. Opt-out ──────────────────────────────────────────────────────────────
create table if not exists public.lifecycle_email_optout (
  user_id uuid        primary key references auth.users(id) on delete cascade,
  at      timestamptz not null default now()
);

comment on table public.lifecycle_email_optout is
  'Users who unsubscribed from lifecycle emails (signed List-Unsubscribe link or the console toggle PUT /v1/admin/me/lifecycle-emails). Presence = opted out. Service role only.';

alter table public.lifecycle_email_optout enable row level security;
revoke all on table public.lifecycle_email_optout from public, anon, authenticated;

-- ── 3. Kill switch (off by default) ─────────────────────────────────────────
insert into public.mushi_runtime_config (key, value)
values ('lifecycle_emails_enabled', 'false')
on conflict (key) do nothing;

-- ── 4. Dispatcher ───────────────────────────────────────────────────────────
-- Thin wrapper around net.http_post so pg_cron has something to schedule.
-- Fails closed on every missing precondition and says why in a WARNING so
-- the gap is visible in the Postgres logs rather than as a silent no-op.
create or replace function public.dispatch_lifecycle_emails()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_enabled text;
  v_url     text;
  v_auth    text;
begin
  select value into v_enabled
    from public.mushi_runtime_config
   where key = 'lifecycle_emails_enabled';
  if coalesce(v_enabled, 'false') <> 'true' then
    -- Kill switch off (default). Safe to apply before the sender domain is
    -- verified. No warning: this is the expected state until launch.
    return;
  end if;

  v_url  := public.mushi_runtime_supabase_url();
  v_auth := public.mushi_internal_auth_header();

  if v_url is null or v_url = '' then
    raise warning 'dispatch_lifecycle_emails: mushi_runtime_config.supabase_url missing';
    return;
  end if;
  if v_auth is null then
    raise warning 'dispatch_lifecycle_emails: mushi_internal_caller_token missing in mushi_runtime_config';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/lifecycle-emails',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', v_auth
    ),
    body    := '{}'::jsonb
  );
end;
$fn$;

revoke all on function public.dispatch_lifecycle_emails() from public, anon, authenticated;
grant execute on function public.dispatch_lifecycle_emails() to service_role, postgres;

comment on function public.dispatch_lifecycle_emails() is
  'Cron-only entrypoint. Returns early unless mushi_runtime_config.lifecycle_emails_enabled = ''true''; otherwise pings the lifecycle-emails edge function with the internal caller token. Idempotent: the edge function de-dupes via lifecycle_email_sends.';

-- Hourly at :37 — clear of :00 (usage-alerts), :23 (invitation reminders) and
-- the other top-of-hour system crons. cron.schedule upserts by job name.
do $sched$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'dispatch_lifecycle_emails',
      '37 * * * *',
      $cron$ select public.dispatch_lifecycle_emails(); $cron$
    );
  end if;
end;
$sched$;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
