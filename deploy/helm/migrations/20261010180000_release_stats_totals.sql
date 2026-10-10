-- ============================================================================
-- 20261010180000_release_stats_totals
--
-- GET /v1/admin/releases/stats (and the sidebar counters through nav-meta)
-- summed fixed_report_ids / credited_reporter_ids by reading every release
-- row page by page, then counted release_credits with `.in(release_id, …)`
-- holding up to 500 UUIDs per page. The work grew with release history on
-- every banner hit, and the id list made a very long query string.
--
-- release_stats_totals() returns the same six totals from one SQL pass. The
-- route falls back to the paged read until this migration is applied.
-- ============================================================================

create or replace function public.release_stats_totals(p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $rst$
  select jsonb_build_object(
    'total_fixes_linked', coalesce((
      select sum(coalesce(cardinality(r.fixed_report_ids), 0)) from public.releases r
       where r.project_id = p_project_id
    ), 0),
    'total_contributors', coalesce((
      select sum(coalesce(cardinality(r.credited_reporter_ids), 0)) from public.releases r
       where r.project_id = p_project_id
    ), 0),
    'draft_fixes', coalesce((
      select sum(coalesce(cardinality(r.fixed_report_ids), 0)) from public.releases r
       where r.project_id = p_project_id and r.status = 'draft'
    ), 0),
    'draft_contributors', coalesce((
      select sum(coalesce(cardinality(r.credited_reporter_ids), 0)) from public.releases r
       where r.project_id = p_project_id and r.status = 'draft'
    ), 0),
    'total_credits', (
      select count(*) from public.release_credits c
        join public.releases r on r.id = c.release_id
       where r.project_id = p_project_id
    ),
    'credits_notified', (
      select count(*) from public.release_credits c
        join public.releases r on r.id = c.release_id
       where r.project_id = p_project_id and c.notified_at is not null
    )
  );
$rst$;

comment on function public.release_stats_totals(uuid) is
  'Release array totals and credit counts for one project, for GET /v1/admin/releases/stats. Service role only.';

revoke all on function public.release_stats_totals(uuid) from public, anon, authenticated;
grant execute on function public.release_stats_totals(uuid) to service_role;
