-- ============================================================================
-- 20261002120000_reporter_loop_v2_report_columns
--
-- Plan 018 (docs/execplans/reporter-loop-v2.md §6.1, migration 1).
--
-- reports gains the columns the reporter-facing status table reads:
--   closed_reason        why a dismissed report was closed (shown to the reporter)
--   fixed_in_version     "Fixed in v1.4", set when a release lists the report
--   fixed_release_id     the release that shipped the fix
--   admin_seen_at        console unread dot (last_reporter_reply_at > admin_seen_at)
--   awaiting_reporter_at "Waiting on you" — the developer asked a question
--
-- The (project_id, reporter_token_hash, created_at desc) index the spec asks
-- for already exists as reports_reporter_history_idx (20260430000000), so no
-- second copy is created here.
--
-- reporter_report_follows: when a report is grouped under, or closed as a
-- duplicate of, a canonical report, its reporter follows the canonical one so
-- updates there reach them too. Service role only.
-- ============================================================================

alter table public.reports
  add column if not exists closed_reason text,
  add column if not exists fixed_in_version text,
  add column if not exists fixed_release_id uuid references public.releases(id) on delete set null,
  add column if not exists admin_seen_at timestamptz,
  add column if not exists awaiting_reporter_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_closed_reason_check') then
    alter table public.reports
      add constraint reports_closed_reason_check check (
        closed_reason is null
        or closed_reason in ('duplicate', 'not_reproducible', 'wont_fix', 'working_as_intended', 'spam')
      );
  end if;
end $$;

create index if not exists reports_fixed_release_id_idx
  on public.reports (fixed_release_id)
  where fixed_release_id is not null;

create index if not exists reports_awaiting_reporter_idx
  on public.reports (project_id, awaiting_reporter_at)
  where awaiting_reporter_at is not null;

create table if not exists public.reporter_report_follows (
  report_id uuid not null references public.reports(id) on delete cascade,
  reporter_token_hash text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- The reporter's own report that led to the follow (the duplicate).
  source_report_id uuid references public.reports(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, reporter_token_hash)
);

create index if not exists reporter_report_follows_reporter_idx
  on public.reporter_report_follows (project_id, reporter_token_hash);

create index if not exists reporter_report_follows_source_idx
  on public.reporter_report_follows (source_report_id)
  where source_report_id is not null;

alter table public.reporter_report_follows enable row level security;

drop policy if exists reporter_report_follows_deny_all on public.reporter_report_follows;
create policy reporter_report_follows_deny_all on public.reporter_report_follows
  as restrictive for all
  using (false);

revoke all on public.reporter_report_follows from anon, authenticated;

comment on table public.reporter_report_follows is
  'Reporter subscriptions carried to a canonical report when theirs is grouped or closed as a duplicate. Service-role only.';

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
