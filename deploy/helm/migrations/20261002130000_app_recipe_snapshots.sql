-- ============================================================================
-- 20261002130000_app_recipe_snapshots
--
-- Plan 019 (docs/execplans/app-recipe-control-plane.md §5.1, migration 1),
-- Phase 1b. One row per ingest of a project's mushi.recipe.json and the DTCG
-- token files it lists, read from the repo at a pinned commit.
--
--   manifest           the validated mushi.recipe.json (null when absent or
--                      rejected; validation_errors says why)
--   tokens             {version, active, sets[]}: every set (the active one,
--                      sibling directions, the read-only export) normalized
--                      to DTCG 2025.10 by _shared/dtcg.ts
--   tokens_hash        sha256 hex of manifest + normalized sets; an unchanged
--                      refresh only bumps captured_at on the current row
--   components         [{name, file}] from design.components.globs
--   organization_id    denormalized for the portfolio rollup (Phase P1);
--                      always copied from projects by the trigger below
--
-- RLS: project members read (private.is_project_member, the org-aware
-- helper); only the service role writes.
-- ============================================================================

create table if not exists public.app_recipe_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  organization_id    uuid references public.organizations(id) on delete set null,
  commit_sha         text,
  source             text not null default 'repo_file',
  manifest           jsonb,
  tokens             jsonb not null default '{}'::jsonb,
  tokens_hash        text not null,
  components         jsonb not null default '[]'::jsonb,
  validation_errors  jsonb not null default '[]'::jsonb,
  is_current         boolean not null default false,
  captured_at        timestamptz not null default now(),
  constraint app_recipe_snapshots_source_check
    check (source in ('repo_file', 'ci_ingest', 'derived', 'connector')),
  constraint app_recipe_snapshots_tokens_hash_len
    check (char_length(tokens_hash) = 64)
);

create unique index if not exists app_recipe_snapshots_one_current
  on public.app_recipe_snapshots (project_id)
  where is_current;

create index if not exists app_recipe_snapshots_project_captured
  on public.app_recipe_snapshots (project_id, captured_at desc);

create index if not exists app_recipe_snapshots_org
  on public.app_recipe_snapshots (organization_id)
  where organization_id is not null;

create or replace function public.app_recipe_snapshots_set_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.organization_id into new.organization_id
    from public.projects p
   where p.id = new.project_id;
  return new;
end;
$$;

revoke all on function public.app_recipe_snapshots_set_org() from public, anon, authenticated;

drop trigger if exists app_recipe_snapshots_set_org on public.app_recipe_snapshots;
create trigger app_recipe_snapshots_set_org
  before insert or update of project_id on public.app_recipe_snapshots
  for each row execute function public.app_recipe_snapshots_set_org();

alter table public.app_recipe_snapshots enable row level security;

drop policy if exists app_recipe_snapshots_member_select on public.app_recipe_snapshots;
create policy app_recipe_snapshots_member_select
  on public.app_recipe_snapshots for select
  to authenticated
  using ((select private.is_project_member(project_id)));

drop policy if exists app_recipe_snapshots_service_write on public.app_recipe_snapshots;
create policy app_recipe_snapshots_service_write
  on public.app_recipe_snapshots for all
  to service_role
  using (true) with check (true);

revoke all on table public.app_recipe_snapshots from anon;
grant select on table public.app_recipe_snapshots to authenticated;

comment on table public.app_recipe_snapshots is
  'Plan 019 Phase 1b: ingested mushi.recipe.json + normalized DTCG token sets per project, '
  'read from the repo at commit_sha. One is_current row per project. Written only by the '
  'api / recipe-collector edge functions (service role).';
