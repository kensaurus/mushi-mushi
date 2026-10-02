-- ============================================================================
-- 20261002160500_org_funnel_definitions
--
-- Plan 020 Phase 3 (§8, ADR 0017). ADDITIVE: apply BEFORE deploying the api
-- function (GET/PUT /v1/admin/orgs/:orgId/funnel read and write this table).
--
-- One funnel definition per organization, applied to every app in it, so the
-- cross-app rollup compares like with like: the same event names in the same
-- order, the same conversion window. The rollup itself runs the existing
-- public.product_funnel RPC once per project (20260921000004); nothing else
-- changes. An organization with no row shows "not set up", never zeros.
--
-- Writes only through the api (owner/admin JWT). Members can SELECT.
--
-- Verify after apply:
--   select relrowsecurity from pg_class where oid = 'public.org_funnel_definitions'::regclass; -- t
--   select policyname, roles, cmd from pg_policies where tablename = 'org_funnel_definitions';
--     -- expect org_funnel_definitions_member_select (authenticated, SELECT)
--     --    and org_funnel_definitions_service_write (service_role, ALL)
--   select has_table_privilege('anon', 'public.org_funnel_definitions', 'select'); -- f
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.org_funnel_definitions'::regclass and contype = 'c';
-- ============================================================================

create table if not exists public.org_funnel_definitions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Event names in order; same vocabulary as product_events.event_name.
  steps text[] not null check (
    array_length(steps, 1) between 2 and 8
    and array_position(steps, null) is null
  ),
  conversion_window text not null default '7d' check (conversion_window in ('1d', '7d', '30d')),
  -- How many days back the rollup reads (the funnel's entry range).
  lookback_days smallint not null default 30 check (lookback_days between 1 and 365),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.org_funnel_definitions enable row level security;

drop policy if exists org_funnel_definitions_member_select on public.org_funnel_definitions;
create policy org_funnel_definitions_member_select
  on public.org_funnel_definitions for select
  to authenticated
  using ((select private.is_org_member(organization_id)));

drop policy if exists org_funnel_definitions_service_write on public.org_funnel_definitions;
create policy org_funnel_definitions_service_write
  on public.org_funnel_definitions for all
  to service_role
  using (true) with check (true);

revoke all on table public.org_funnel_definitions from anon;
grant select on table public.org_funnel_definitions to authenticated;

comment on table public.org_funnel_definitions is
  'Plan 020 §8: one funnel (event names in order + conversion window) per organization, '
  'run per app by the api over public.product_funnel for the cross-app rollup.';
