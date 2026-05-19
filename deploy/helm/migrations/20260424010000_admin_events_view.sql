-- =============================================================================
-- 20260424010000_admin_events_view.sql
-- Wave T.5.8a (2026-04-24): unified event feed for chart annotations.
--
-- The admin charts (Health latency, Judge score trend, Dashboard KPIs) now
-- overlay "what changed" markers so a spike in error rate can be visually
-- correlated with the deploy / cron tick / BYOK rotation that caused it.
--
-- We union three event sources into a common shape:
--   occurred_at  — when the event happened
--   kind         — 'deploy' | 'cron' | 'byok'
--   label        — one-line human summary ("Deployed api@sha=abc1234")
--   href         — optional link into the source of truth (PR / cron row / key)
--   project_id   — nullable; deploy + cron rows are global, byok is scoped
--
-- The view uses SECURITY INVOKER so RLS on the underlying tables applies —
-- a viewer who can't read `byok_audit_log` for project X also won't see
-- BYOK events for project X in this feed, and cron_runs is filtered by its
-- existing "project owner" policy at read time.
-- =============================================================================

create or replace view admin_chart_events
with (security_invoker = true) as
-- Deploys land as `audit_logs` rows with `action = 'deploy'`. We pull the
-- SHA / PR number out of the metadata JSON so the label reads like a git
-- commit stub — what a reviewer actually wants to see under a chart dot.
select
  created_at                                             as occurred_at,
  'deploy'::text                                         as kind,
  coalesce(
    nullif(metadata->>'label', ''),
    'Deploy · ' || coalesce(substring(coalesce(metadata->>'sha', resource_id) from 1 for 7), 'unknown')
  )                                                      as label,
  metadata->>'href'                                      as href,
  project_id
from audit_logs
where action in ('deploy', 'deploy.release', 'release.published')

union all

-- Cron ticks — every non-success run lands here. We skip `success` rows
-- to avoid dotting every chart with 144 green markers/day; annotations
-- are for "something worth explaining", and a healthy tick is not.
select
  started_at                                             as occurred_at,
  'cron'::text                                           as kind,
  'Cron · ' || job_name || coalesce(' · ' || nullif(status, ''), '')
                                                         as label,
  null::text                                             as href,
  null::uuid                                             as project_id
from cron_runs
where status <> 'success'

union all

-- BYOK rotations — adds, removes, rotations (but not every "used" ping
-- because those fire per LLM call and would bury the chart).
select
  ts                                                     as occurred_at,
  'byok'::text                                           as kind,
  'BYOK · ' || provider || ' · ' || action               as label,
  null::text                                             as href,
  project_id
from byok_audit_log
where action in ('added', 'rotated', 'removed');

comment on view admin_chart_events is
  'Wave T.5.8a: unified event feed (deploys, cron anomalies, BYOK rotations) fed into chart annotation overlays on Health / Judge / Dashboard. SECURITY INVOKER — RLS on the underlying tables applies.';

-- Grant read to authenticated users so the admin Edge Function can
-- select from the view on behalf of the operator. RLS on the underlying
-- tables still gates visibility to the operator's own projects.
grant select on admin_chart_events to authenticated, service_role;
