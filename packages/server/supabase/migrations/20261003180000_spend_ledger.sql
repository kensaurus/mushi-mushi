-- ============================================================================
-- 20261003180000_spend_ledger
--
-- ADDITIVE: apply BEFORE deploying the api function that reads and writes
-- these tables (GET/POST/DELETE /v1/admin/orgs/:orgId/spend…).
--
-- The per-app spend ledger (gap #22, Plan 020 §6). The ledger itself is
-- computed on read from tables that already exist (llm_invocations,
-- connector_snapshots for llm_usage, ci_workflow_runs). What is new is the
-- place to keep bills Mushi cannot read through an API: an operator uploads a
-- Vercel, AWS or Supabase cost CSV and the rows land here, one row per
-- (app, vendor, day, service, unit).
--
--   spend_bill_imports    one row per upload: who, which vendor, how many rows
--                         were read, imported and skipped, the period covered.
--   spend_ledger_entries  the imported amounts. Re-importing the same bill
--                         overwrites the same days (upsert on the natural key),
--                         so an import never double-counts.
--
-- RLS: organization members read; only the service role (the api) writes.
--
-- Verify after apply:
--   select count(*) from information_schema.tables where table_schema = 'public'
--     and table_name in ('spend_bill_imports', 'spend_ledger_entries');          -- 2
--   select relname, relrowsecurity from pg_class
--    where relname in ('spend_bill_imports', 'spend_ledger_entries');           -- t, t
--   select tablename, policyname, roles from pg_policies
--    where tablename in ('spend_bill_imports', 'spend_ledger_entries');
-- ============================================================================

create table if not exists public.spend_bill_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Set when every row went to one app; null when rows were matched by an app column.
  project_id uuid references public.projects(id) on delete set null,
  vendor text not null check (vendor in ('vercel', 'aws', 'supabase', 'other')),
  filename text check (filename is null or char_length(filename) <= 200),
  -- Which header layout was recognised: focus, aws_cur, generic.
  format text not null check (format in ('focus', 'aws_cur', 'generic')),
  rows_read integer not null default 0 check (rows_read >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  rows_skipped integer not null default 0 check (rows_skipped >= 0),
  total_usd numeric(14, 4) not null default 0,
  period_start date,
  period_end date,
  imported_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists spend_bill_imports_org on public.spend_bill_imports (organization_id, created_at desc);

create table if not exists public.spend_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  vendor text not null check (vendor in ('vercel', 'aws', 'supabase', 'other')),
  service text not null default '' check (char_length(service) <= 120),
  unit text not null default '' check (char_length(unit) <= 60),
  day date not null,
  amount_usd numeric(14, 4) not null default 0,
  quantity numeric,
  -- The latest import that wrote this day owns it; deleting that import removes it.
  import_id uuid references public.spend_bill_imports(id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique (project_id, vendor, day, service, unit)
);
create index if not exists spend_ledger_entries_org_day on public.spend_ledger_entries (organization_id, day desc);
create index if not exists spend_ledger_entries_import on public.spend_ledger_entries (import_id);

alter table public.spend_bill_imports enable row level security;
alter table public.spend_ledger_entries enable row level security;

drop policy if exists spend_bill_imports_member_select on public.spend_bill_imports;
create policy spend_bill_imports_member_select
  on public.spend_bill_imports for select
  to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists spend_bill_imports_service_write on public.spend_bill_imports;
create policy spend_bill_imports_service_write
  on public.spend_bill_imports for all
  to service_role
  using (true) with check (true);

drop policy if exists spend_ledger_entries_member_select on public.spend_ledger_entries;
create policy spend_ledger_entries_member_select
  on public.spend_ledger_entries for select
  to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists spend_ledger_entries_service_write on public.spend_ledger_entries;
create policy spend_ledger_entries_service_write
  on public.spend_ledger_entries for all
  to service_role
  using (true) with check (true);

revoke all on table public.spend_bill_imports from anon;
revoke all on table public.spend_ledger_entries from anon;
grant select on table public.spend_bill_imports to authenticated;
grant select on table public.spend_ledger_entries to authenticated;

comment on table public.spend_bill_imports is
  'Gap #22: one row per bill CSV an owner or admin uploaded (Vercel, AWS, Supabase or other). Written only by the api.';
comment on table public.spend_ledger_entries is
  'Gap #22: imported bill amounts per app, vendor, day, service and unit. Re-imports overwrite the same days. Written only by the api.';
