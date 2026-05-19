-- =============================================================================
-- Phase 2: Releases + reporter attribution (closed-loop evolution)
-- Migration: 20260520100000_releases.sql
-- =============================================================================

-- release_status enum
do $$ begin create type release_status as enum ('draft','published'); exception when duplicate_object then null; end $$;

-- releases
create table if not exists releases (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references projects(id) on delete cascade,
  version               text not null,
  title                 text not null,
  body_md               text not null default '',
  status                release_status not null default 'draft',
  published_at          timestamptz,
  fixed_report_ids      uuid[] not null default '{}',
  credited_reporter_ids uuid[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_releases_project_status
  on releases (project_id, status, published_at desc);

alter table releases enable row level security;

create policy "service_role_all_releases" on releases for all using (true) with check (true);

create policy "org_members_read_releases" on releases for select
  using (
    exists (
      select 1 from projects p
        join organization_members om on om.organization_id = p.organization_id
       where p.id = project_id
         and om.user_id = (select auth.uid())
    )
  );

create policy "org_members_write_releases" on releases for all
  using (
    exists (
      select 1 from projects p
        join organization_members om on om.organization_id = p.organization_id
       where p.id = project_id
         and om.user_id = (select auth.uid())
    )
  ) with check (
    exists (
      select 1 from projects p
        join organization_members om on om.organization_id = p.organization_id
       where p.id = project_id
         and om.user_id = (select auth.uid())
    )
  );

create or replace trigger trg_releases_updated_at
  before update on releases
  for each row execute function set_updated_at();

-- release_contribution_type enum
do $$ begin create type release_contribution_type as enum ('reporter','first_reproducer','top_voter'); exception when duplicate_object then null; end $$;

-- release_credits
create table if not exists release_credits (
  id                    uuid primary key default gen_random_uuid(),
  release_id            uuid not null references releases(id) on delete cascade,
  end_user_id           uuid references end_users(id) on delete set null,
  report_id             uuid references reports(id) on delete set null,
  contribution_type     release_contribution_type not null default 'reporter',
  display_name_at_time  text,
  notified_at           timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists idx_release_credits_release on release_credits (release_id);
create index if not exists idx_release_credits_user   on release_credits (end_user_id);

alter table release_credits enable row level security;

create policy "service_role_all_release_credits" on release_credits for all using (true) with check (true);

-- End users can see credits that mention them (for SDK widget toast)
create policy "end_user_read_own_credits" on release_credits for select
  using (end_user_id is not null);
