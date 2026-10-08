-- ============================================================================
-- 20261006100000_project_groups
--
-- Plan 021 Phase 2. ADDITIVE: apply BEFORE deploying the api function.
--
-- Named groups of projects inside one organization ("Kensaurus apps",
-- "Client work"), used to filter the portfolio and the project switcher.
-- A project can sit in several groups. Groups never cross organizations:
-- the composite foreign keys make a cross-org membership impossible, not
-- just unlikely (ADR 0016 rolls everything up per organization).
--
-- Writes go through the api (owner/admin checked there with
-- private.has_org_role); members read through RLS.
--
-- Verify after apply:
--   select relname, relrowsecurity from pg_class
--    where relname in ('project_groups','project_group_members');      -- both t
--   select conname from pg_constraint where conname = 'projects_id_organization_key';
-- ============================================================================

-- Target of the composite FK below. id is already unique, so this cannot fail.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_id_organization_key') then
    alter table public.projects add constraint projects_id_organization_key unique (id, organization_id);
  end if;
end $$;

create table if not exists public.project_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  color text check (color is null or color in ('brand', 'accent', 'info', 'ok', 'warn', 'danger', 'neutral')),
  sort integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (id, organization_id)
);

create table if not exists public.project_group_members (
  group_id uuid not null,
  project_id uuid not null,
  organization_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (group_id, project_id),
  foreign key (group_id, organization_id)
    references public.project_groups (id, organization_id) on delete cascade,
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);
create index if not exists project_group_members_project on public.project_group_members (project_id);

alter table public.project_groups enable row level security;
alter table public.project_group_members enable row level security;

drop policy if exists project_groups_member_select on public.project_groups;
create policy project_groups_member_select on public.project_groups
  for select to authenticated using ((select private.is_org_member(organization_id)));
drop policy if exists project_groups_service_write on public.project_groups;
create policy project_groups_service_write on public.project_groups
  for all to service_role using (true) with check (true);

drop policy if exists project_group_members_member_select on public.project_group_members;
create policy project_group_members_member_select on public.project_group_members
  for select to authenticated using ((select private.is_org_member(organization_id)));
drop policy if exists project_group_members_service_write on public.project_group_members;
create policy project_group_members_service_write on public.project_group_members
  for all to service_role using (true) with check (true);

revoke all on table public.project_groups, public.project_group_members from anon;
grant select on table public.project_groups, public.project_group_members to authenticated;

comment on table public.project_groups is
  'Plan 021: named groups of projects inside one organization, for the portfolio filter and project switcher.';
comment on table public.project_group_members is
  'Plan 021: which projects are in which group. Composite FKs keep group and project in the same organization.';

notify pgrst, 'reload schema';
