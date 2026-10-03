-- ============================================================================
-- 20261003180200_spend_ledger_import_history
--
-- ADDITIVE: apply AFTER 20261003180000_spend_ledger and BEFORE deploying the
-- api function that writes spend_bill_import_rows.
--
-- Bill imports reconcile (gap #22). spend_ledger_entries holds one row per
-- (app, vendor, day, service, unit), owned by the newest import that has that
-- key. Until now an older import's figures were overwritten and lost, so
-- deleting the newer import silently dropped days the older one had supplied
-- while the older import stayed listed. Each import now keeps its own rows in
-- spend_bill_import_rows; deleting an import hands each day it owned back to
-- the next newest import that has it, or removes it when none does.
--
-- RLS is narrowed to the apps a member can see:
--   spend_ledger_entries, spend_bill_import_rows   is_project_member(project_id)
--   spend_bill_imports                             is_project_member(project_id)
--                                                  when the import is for one app;
--                                                  is_org_member(organization_id)
--                                                  when rows were matched by an app column
-- The api applies the same rule when it lists imports.
--
-- Verify after apply:
--   select relrowsecurity from pg_class where oid = 'public.spend_bill_import_rows'::regclass;  -- t
--   select tablename, policyname, qual from pg_policies
--    where tablename in ('spend_bill_imports', 'spend_ledger_entries', 'spend_bill_import_rows');
-- ============================================================================

create table if not exists public.spend_bill_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.spend_bill_imports(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  vendor text not null check (vendor in ('vercel', 'aws', 'supabase', 'other')),
  service text not null default '' check (char_length(service) <= 120),
  unit text not null default '' check (char_length(unit) <= 60),
  day date not null,
  amount_usd numeric(14, 4) not null default 0,
  quantity numeric,
  unique (import_id, project_id, day, service, unit)
);
-- The fallback read on delete: earlier imports of the same team, vendor and apps.
create index if not exists spend_bill_import_rows_fallback
  on public.spend_bill_import_rows (organization_id, vendor, project_id, day);

alter table public.spend_bill_import_rows enable row level security;

drop policy if exists spend_bill_import_rows_member_select on public.spend_bill_import_rows;
create policy spend_bill_import_rows_member_select
  on public.spend_bill_import_rows for select
  to authenticated
  using ((select private.is_project_member(project_id)));

drop policy if exists spend_bill_import_rows_service_write on public.spend_bill_import_rows;
create policy spend_bill_import_rows_service_write
  on public.spend_bill_import_rows for all
  to service_role
  using (true) with check (true);

revoke all on table public.spend_bill_import_rows from anon;
grant select on table public.spend_bill_import_rows to authenticated;

-- Ledger rows: members of the app, as for ci_workflow_runs.
drop policy if exists spend_ledger_entries_member_select on public.spend_ledger_entries;
create policy spend_ledger_entries_member_select
  on public.spend_ledger_entries for select
  to authenticated
  using ((select private.is_project_member(project_id)));

-- Imports: one-app imports to members of that app; app-column imports to the team.
drop policy if exists spend_bill_imports_member_select on public.spend_bill_imports;
create policy spend_bill_imports_member_select
  on public.spend_bill_imports for select
  to authenticated
  using (
    case
      when project_id is null then (select private.is_org_member(organization_id))
      else (select private.is_project_member(project_id))
    end
  );

comment on table public.spend_bill_import_rows is
  'Gap #22: each bill import''s own aggregated rows, kept so deleting a newer import hands its days back to the next newest import. Written only by the api.';
