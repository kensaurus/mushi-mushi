-- ============================================================================
-- 20261002180100_connectors
--
-- Plan 019 §5.1 migration 7 (Phase 2, gate struck by ADR 0017), plus the
-- snapshot store the connector collector and the spend ledger read.
-- ADDITIVE: apply BEFORE deploying the api, recipe-collector and radar-scan
-- functions that read and write these tables.
--
--   connector_instances  one credentialed source per organization (project_id
--                        null = shared by several projects). Credentials are
--                        Vault refs (`vault://<uuid>`); read and write refs are
--                        separate and the write ref stays null unless propose
--                        or act is enabled. Members can read every column
--                        EXCEPT the two refs (column grants).
--   connector_bindings   which projects (and external ids) an instance serves.
--   connector_snapshots  the latest validated snapshot per (connector, project),
--                        kept for drift (prev vs next) and the spend ledger.
--
-- Verify after apply:
--   select table_name from information_schema.tables where table_schema='public'
--     and table_name in ('connector_instances','connector_bindings','connector_snapshots');  -- 3 rows
--   select relname, relrowsecurity from pg_class where relname in
--     ('connector_instances','connector_bindings','connector_snapshots');                    -- all t
--   select has_column_privilege('authenticated','public.connector_instances','read_credential_ref','select');  -- f
--   select has_column_privilege('authenticated','public.connector_instances','status','select');               -- t
--   select has_table_privilege('anon','public.connector_instances','select');                                  -- f
-- ============================================================================

create table if not exists public.connector_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  kind text not null check (kind in (
    'github', 'supabase', 'sentry', 'http', 'public_probe', 'app_store_connect',
    'play_console', 'llm_usage', 'revenuecat', 'vercel', 'eas', 'stripe', 'posthog'
  )),
  display_name text not null check (char_length(display_name) between 1 and 120),
  read_credential_ref text check (read_credential_ref is null or read_credential_ref like 'vault://%'),
  write_credential_ref text check (write_credential_ref is null or write_credential_ref like 'vault://%'),
  granted_scopes text[] not null default '{}',
  enabled_capabilities text[] not null default '{snapshot,drift}'
    check (enabled_capabilities <@ array['snapshot','drift','propose','act']::text[]),
  config jsonb not null default '{}'::jsonb,
  status text not null default 'unknown'
    check (status in ('connected', 'not_connected', 'blocked', 'error', 'unknown')),
  status_reason text,
  last_probe_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- act needs a write credential; enabling act without one is refused here too.
  constraint connector_act_needs_write check (not ('act' = any(enabled_capabilities)) or write_credential_ref is not null)
);

create index if not exists connector_instances_org on public.connector_instances (organization_id);
create index if not exists connector_instances_project on public.connector_instances (project_id) where project_id is not null;

create table if not exists public.connector_bindings (
  id uuid primary key default gen_random_uuid(),
  connector_instance_id uuid not null references public.connector_instances(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  external_id text not null check (char_length(external_id) between 1 and 300),
  role text not null default 'primary' check (char_length(role) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (connector_instance_id, project_id, role)
);

create index if not exists connector_bindings_project on public.connector_bindings (project_id);

create table if not exists public.connector_snapshots (
  id uuid primary key default gen_random_uuid(),
  connector_instance_id uuid references public.connector_instances(id) on delete cascade,
  kind text not null,
  project_id uuid references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ok boolean not null,
  error text,
  snapshot jsonb,
  is_current boolean not null default true,
  observed_at timestamptz not null default now()
);

-- One current snapshot per (connector or legacy kind, project).
create unique index if not exists connector_snapshots_one_current
  on public.connector_snapshots (coalesce(connector_instance_id::text, kind), coalesce(project_id::text, organization_id::text))
  where is_current;
create index if not exists connector_snapshots_project on public.connector_snapshots (project_id, observed_at desc);
create index if not exists connector_snapshots_org on public.connector_snapshots (organization_id, observed_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.connector_instances enable row level security;
alter table public.connector_bindings enable row level security;
alter table public.connector_snapshots enable row level security;

drop policy if exists connector_instances_member_select on public.connector_instances;
create policy connector_instances_member_select on public.connector_instances
  for select to authenticated using ((select private.is_org_member(organization_id)));
drop policy if exists connector_instances_service_write on public.connector_instances;
create policy connector_instances_service_write on public.connector_instances
  for all to service_role using (true) with check (true);

drop policy if exists connector_bindings_member_select on public.connector_bindings;
create policy connector_bindings_member_select on public.connector_bindings
  for select to authenticated using ((select private.is_project_member(project_id)));
drop policy if exists connector_bindings_service_write on public.connector_bindings;
create policy connector_bindings_service_write on public.connector_bindings
  for all to service_role using (true) with check (true);

drop policy if exists connector_snapshots_member_select on public.connector_snapshots;
create policy connector_snapshots_member_select on public.connector_snapshots
  for select to authenticated using ((select private.is_org_member(organization_id)));
drop policy if exists connector_snapshots_service_write on public.connector_snapshots;
create policy connector_snapshots_service_write on public.connector_snapshots
  for all to service_role using (true) with check (true);

revoke all on table public.connector_instances from anon, authenticated;
revoke all on table public.connector_bindings from anon;
revoke all on table public.connector_snapshots from anon;
-- Members see every column except the two credential refs.
grant select (id, organization_id, project_id, kind, display_name, granted_scopes, enabled_capabilities,
              config, status, status_reason, last_probe_at, last_ok_at, last_error, created_at, updated_at)
  on public.connector_instances to authenticated;
grant select on table public.connector_bindings to authenticated;
grant select on table public.connector_snapshots to authenticated;

comment on table public.connector_instances is
  'Plan 019 §2b connectors (ADR 0016/0017). Credentials are Vault refs, never values; '
  'members cannot select the *_credential_ref columns. Written only by the api (service role).';
comment on table public.connector_snapshots is
  'Latest validated ConnectorSnapshot per (connector, project); is_current marks the one the console shows.';

notify pgrst, 'reload schema';
