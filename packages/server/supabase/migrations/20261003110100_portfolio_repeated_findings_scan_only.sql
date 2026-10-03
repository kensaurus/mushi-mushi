-- ADDITIVE: portfolio_repeated_findings reads only design_drift runs of phase
-- 'scan' (Plan 019 Phase 1b follow-up).
--
-- The view (20261002180300) took the latest design_drift run per project and
-- left out only phase 'refresh'. CI pushes now write their own phases:
--   ci_branch_scan     a pull-request (non-default-branch) push
--   ci_untrusted_scan  a default-branch push made with a public key
--   ci_scan            a push from a CLI older than the shared engine
-- None of them is the app's design state, and every other reader (design
-- state, /design/deviance, the trend, /recipe/drift, the portfolio rollup,
-- the auto-fix baseline) already filters on phase 'scan'. Without this, a PR
-- run became the "latest" design run and its findings showed up as
-- org-wide repeated findings.
--
-- Same columns, same security_invoker, grants and comment; idempotent
-- (create or replace). Other gates are unchanged.

create or replace view public.portfolio_repeated_findings
with (security_invoker = true)
as
with latest as (
  select distinct on (r.project_id, r.gate) r.id, r.project_id, r.gate
    from public.gate_runs r
   where r.status not in ('queued', 'running')
     and not (r.gate = 'design_drift' and coalesce(r.summary->>'phase', '') <> 'scan')
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
  'Plan 019 §3b: a rule open in 2+ projects of one organization (latest completed run per project and gate; '
  'for design_drift only phase scan runs, never CI branch, untrusted or legacy pushes; not allowlisted, info excluded). '
  'security_invoker: callers see only projects RLS lets them see.';

notify pgrst, 'reload schema';
