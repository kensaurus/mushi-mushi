-- ============================================================================
-- 20261002180400_connector_actions_and_recipe_changes
--
-- Plan 019 §5.1 migrations 5 and 8 (Phase 3 / Plan 020 Phase 4; ADR 0017).
-- ADDITIVE: apply BEFORE deploying the api function that reads these tables.
--
--   connector_actions   every API mutation a connector can make (promote a
--                       Play track, change a rollout %) as a row a HUMAN must
--                       approve first. The approval binds the SHA-256 of the
--                       exact payload, expires after one hour, and is consumed
--                       once: execution flips approved → executing in one
--                       UPDATE guarded by status, hash and expiry, so two
--                       callers can never both run it. Approval is accepted
--                       only from a console JWT (enforced in the api route);
--                       an API key or MCP can request, never approve.
--                       Nothing here runs on a schedule.
--   recipe_change_jobs  draft-PR jobs for recipe edits (tokens, budgets, env
--                       declarations, store listings), one per repo; a
--                       portfolio "fix once" shares a batch_id.
--
-- Verify after apply:
--   select relname, relrowsecurity from pg_class where relname in ('connector_actions','recipe_change_jobs');  -- t, t
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.connector_actions'::regclass and contype = 'c';  -- status list, sha length 64
--   select has_table_privilege('authenticated','public.connector_actions','update');  -- f
-- ============================================================================

create table if not exists public.connector_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  connector_instance_id uuid not null references public.connector_instances(id) on delete cascade,
  action text not null check (char_length(action) between 1 and 60),
  payload jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  reason text check (reason is null or char_length(reason) <= 500),
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'rejected', 'executing', 'executed', 'failed', 'expired')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  expires_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  error text,
  constraint connector_actions_approved_has_expiry check (status not in ('approved', 'executing', 'executed') or (approved_by is not null and expires_at is not null))
);
create index if not exists connector_actions_org on public.connector_actions (organization_id, requested_at desc);
create index if not exists connector_actions_pending on public.connector_actions (organization_id) where status = 'pending_approval';

create table if not exists public.recipe_change_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  element text not null check (element in ('design', 'gates', 'env', 'routes', 'store', 'release')),
  status text not null default 'queued' check (status in ('queued', 'running', 'pr_opened', 'failed', 'rejected')),
  plan jsonb not null default '{}'::jsonb,
  pr_url text,
  pr_number integer,
  branch text,
  commit_sha text,
  error text,
  batch_id uuid,
  requested_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create unique index if not exists recipe_change_jobs_one_active
  on public.recipe_change_jobs (project_id, element) where status in ('queued', 'running');
create index if not exists recipe_change_jobs_batch on public.recipe_change_jobs (batch_id) where batch_id is not null;

drop trigger if exists recipe_change_jobs_set_org on public.recipe_change_jobs;
create trigger recipe_change_jobs_set_org before insert or update of project_id on public.recipe_change_jobs
  for each row execute function public.recipe_rows_set_org();

alter table public.connector_actions enable row level security;
alter table public.recipe_change_jobs enable row level security;

drop policy if exists connector_actions_member_select on public.connector_actions;
create policy connector_actions_member_select on public.connector_actions
  for select to authenticated using ((select private.is_org_member(organization_id)));
drop policy if exists connector_actions_service_write on public.connector_actions;
create policy connector_actions_service_write on public.connector_actions
  for all to service_role using (true) with check (true);

-- Service-role only, like sdk_upgrade_jobs.
drop policy if exists recipe_change_jobs_service_all on public.recipe_change_jobs;
create policy recipe_change_jobs_service_all on public.recipe_change_jobs
  for all to service_role using (true) with check (true);

revoke all on table public.connector_actions from anon, authenticated;
grant select on table public.connector_actions to authenticated;
revoke all on table public.recipe_change_jobs from anon, authenticated;

-- A job stuck in running for 15 minutes failed (the function stopped).
create or replace function public.recipe_change_jobs_reap()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  update public.recipe_change_jobs
     set status = 'failed', error = 'The job stopped before it finished.', finished_at = now(), updated_at = now()
   where status = 'running' and started_at < now() - interval '15 minutes';
  get diagnostics n = row_count;
  update public.connector_actions
     set status = 'expired'
   where status in ('pending_approval', 'approved')
     and ((status = 'approved' and expires_at < now()) or (status = 'pending_approval' and requested_at < now() - interval '7 days'));
  return n;
end;
$$;
revoke all on function public.recipe_change_jobs_reap() from public, anon, authenticated;
grant execute on function public.recipe_change_jobs_reap() to service_role;

notify pgrst, 'reload schema';
