-- ============================================================================
-- 20261002180300_portfolio_resources
--
-- Plan 019 §5.1 migration 6 (Phase P2, gate struck by ADR 0017).
-- ADDITIVE: apply BEFORE deploying the api and recipe-collector functions.
--
--   projects.kind               app | site | service | library | other (nullable;
--                               until set, the portfolio infers it and says so)
--   portfolio_resources         shared things (auth provider, Supabase project,
--                               Stripe account, domain, bundle id, Slack channel…)
--   portfolio_resource_uses     which projects use each resource, and how
--   portfolio_findings          rules that are genuinely cross-project
--   portfolio_repeated_findings open gate findings grouped by rule across an
--                               organization (security_invoker, so RLS applies)
--
-- "Open" (Plan 019 §3b): from the latest completed gate_run per (project, gate),
-- not allowlisted; info findings are left out, matching the recipe card.
--
-- Verify after apply:
--   select column_name from information_schema.columns where table_name='projects' and column_name='kind';
--   select relname, relrowsecurity from pg_class where relname in
--     ('portfolio_resources','portfolio_resource_uses','portfolio_findings');    -- all t
--   select reloptions from pg_class where relname='portfolio_repeated_findings'; -- {security_invoker=true}
--   -- and run get_advisors (security): no new security_definer_view lint.
-- ============================================================================

alter table public.projects
  add column if not exists kind text check (kind is null or kind in ('app', 'site', 'service', 'library', 'other'));

create table if not exists public.portfolio_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in (
    'auth_provider', 'supabase_project', 'stripe_account', 'domain', 'deep_link_domain', 'bundle_id',
    'push_channel', 'slack_channel', 'posthog_project', 'sentry_project', 'repo', 'legacy_system',
    'revenuecat_project'
  )),
  external_id text not null check (char_length(external_id) between 1 and 300),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, kind, external_id)
);

create table if not exists public.portfolio_resource_uses (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.portfolio_resources(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null check (char_length(role) between 1 and 60),
  source text not null check (source in ('manifest', 'connector', 'csv', 'inferred')),
  observed_at timestamptz not null default now(),
  unique (resource_id, project_id, role)
);
create index if not exists portfolio_resource_uses_project on public.portfolio_resource_uses (project_id);

create table if not exists public.portfolio_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id text not null,
  severity text not null check (severity in ('info', 'warn', 'error')),
  project_ids uuid[] not null default '{}',
  resource_id uuid references public.portfolio_resources(id) on delete set null,
  resource_key text,
  message text not null,
  evidence jsonb not null default '{}'::jsonb,
  suggested_fix jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'allowlisted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists portfolio_findings_org_open on public.portfolio_findings (organization_id) where status = 'open';
-- One open finding per (org, rule, resource) — the collector upserts on it.
create unique index if not exists portfolio_findings_one_open
  on public.portfolio_findings (organization_id, rule_id, coalesce(resource_key, ''), project_ids)
  where status = 'open';

alter table public.portfolio_resources enable row level security;
alter table public.portfolio_resource_uses enable row level security;
alter table public.portfolio_findings enable row level security;

drop policy if exists portfolio_resources_member_select on public.portfolio_resources;
create policy portfolio_resources_member_select on public.portfolio_resources
  for select to authenticated using ((select private.is_org_member(organization_id)));
drop policy if exists portfolio_resources_service_write on public.portfolio_resources;
create policy portfolio_resources_service_write on public.portfolio_resources
  for all to service_role using (true) with check (true);

drop policy if exists portfolio_resource_uses_member_select on public.portfolio_resource_uses;
create policy portfolio_resource_uses_member_select on public.portfolio_resource_uses
  for select to authenticated using ((select private.is_project_member(project_id)));
drop policy if exists portfolio_resource_uses_service_write on public.portfolio_resource_uses;
create policy portfolio_resource_uses_service_write on public.portfolio_resource_uses
  for all to service_role using (true) with check (true);

drop policy if exists portfolio_findings_member_select on public.portfolio_findings;
create policy portfolio_findings_member_select on public.portfolio_findings
  for select to authenticated using ((select private.is_org_member(organization_id)));
drop policy if exists portfolio_findings_service_write on public.portfolio_findings;
create policy portfolio_findings_service_write on public.portfolio_findings
  for all to service_role using (true) with check (true);

revoke all on table public.portfolio_resources, public.portfolio_resource_uses, public.portfolio_findings from anon;
grant select on table public.portfolio_resources, public.portfolio_resource_uses, public.portfolio_findings to authenticated;

create or replace view public.portfolio_repeated_findings
with (security_invoker = true)
as
with latest as (
  select distinct on (r.project_id, r.gate) r.id, r.project_id, r.gate
    from public.gate_runs r
   where r.status not in ('queued', 'running')
     and not (r.gate = 'design_drift' and coalesce(r.summary->>'phase', '') = 'refresh')
   order by r.project_id, r.gate, r.started_at desc
)
select p.organization_id,
       f.rule_id,
       l.gate,
       count(*)::int as finding_count,
       count(distinct f.project_id)::int as project_count,
       array_agg(distinct f.project_id) as project_ids,
       max(case f.severity when 'error' then 3 when 'warn' then 2 else 1 end) as max_severity_rank
  from latest l
  join public.gate_findings f on f.gate_run_id = l.id
  join public.projects p on p.id = f.project_id
 where f.allowlisted = false
   and f.severity <> 'info'
   and p.organization_id is not null
 group by p.organization_id, f.rule_id, l.gate
having count(distinct f.project_id) >= 2;

revoke all on public.portfolio_repeated_findings from anon;
grant select on public.portfolio_repeated_findings to authenticated;

comment on view public.portfolio_repeated_findings is
  'Plan 019 §3b: a rule open in 2+ projects of one organization (latest completed run per project and gate, '
  'not allowlisted, info excluded). security_invoker: callers see only projects RLS lets them see.';

notify pgrst, 'reload schema';
