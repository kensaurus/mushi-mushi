-- Release trains (ADR 0044): the merge queue batches an app's approved fix
-- PRs into one branch, one pull request, one CI run and one merge, so a batch
-- ships as one deploy, one OTA update and one changelog.

alter table public.project_settings
  add column if not exists release_mode text not null default 'train',
  add column if not exists train_interval_minutes integer not null default 360,
  add column if not exists train_max_members integer not null default 15;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_settings_release_mode_check') then
    alter table public.project_settings add constraint project_settings_release_mode_check check (release_mode in ('train', 'each'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_settings_train_interval_check') then
    alter table public.project_settings add constraint project_settings_train_interval_check check (train_interval_minutes between 15 and 10080);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_settings_train_max_members_check') then
    alter table public.project_settings add constraint project_settings_train_max_members_check check (train_max_members between 1 and 50);
  end if;
end $$;

comment on column public.project_settings.release_mode is
  'How the merge queue ships approved fixes (ADR 0044): train = batch them into one PR per interval (default), each = merge each PR on its own (ADR 0041).';

create table if not exists public.release_trains (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- owner/name, lower case: one active train per repo.
  repo text not null,
  branch text not null,
  base_ref text not null,
  pr_number integer,
  head_sha text,
  state text not null default 'building' check (state in ('building', 'testing', 'merged', 'failed', 'abandoned')),
  -- [{ rowId, fixAttemptId, prNumber, headSha }]
  members jsonb not null default '[]'::jsonb,
  attempt integer not null default 1,
  detail text,
  merge_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  merged_at timestamptz
);

create unique index if not exists uq_release_trains_one_active
  on public.release_trains (repo) where state in ('building', 'testing');
create index if not exists idx_release_trains_project on public.release_trains (project_id, created_at desc);

alter table public.release_trains enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'release_trains' and policyname = 'release_trains_member_select') then
    create policy release_trains_member_select on public.release_trains
      for select to authenticated using ((select private.is_project_member(project_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'release_trains' and policyname = 'release_trains_service_write') then
    create policy release_trains_service_write on public.release_trains
      for all to service_role using (true) with check (true);
  end if;
end $$;

revoke all on table public.release_trains from anon;
revoke insert, update, delete, truncate on table public.release_trains from authenticated;
grant select on table public.release_trains to authenticated;

alter table public.fix_merge_queue
  add column if not exists train_id uuid references public.release_trains(id) on delete set null;
