-- ============================================================================
-- 20260922000011_db_hygiene_initplan_grants
--
-- Database advisor findings from the 2026-09-21 audit (#52). No policy
-- changes who can see what; every statement is either a performance rewrite
-- with identical semantics or a revoke that RLS already made unreachable.
--
-- 1. 18 RLS policies called auth.uid() / auth.role() per row
--    (auth_rls_initplan). Wrapping the call in a scalar subquery lets Postgres
--    evaluate it once per statement. Same predicate, same result.
-- 2. Three functions had a role-mutable search_path. Their bodies reference
--    only built-ins, so the strictest setting ('') is safe.
-- 3. public.reports had two identical indexes; idx_reports_status_project is
--    dropped, reports_status_created_at_idx stays.
-- 4. anon held table grants on 27 tables whose RLS gives anon nothing: no
--    policy for anon, a deny-all policy, or a policy that requires a signed-in
--    member (auth.uid()). The grants only exposed the tables in the GraphQL
--    schema. Revoked from anon; authenticated grants are untouched. The
--    tester marketplace tables with deliberate public-read policies
--    (published_apps, published_app_bounties, published_app_targeting) and the
--    public leaderboard view keep their anon access.
-- 5. tester_leaderboard_30d is a materialized view (no RLS) that anon and
--    authenticated could read in full, including tester_id. The public view
--    tester_leaderboard_30d_public is security_invoker, so it needs the
--    caller to read the matview: grant only the columns it selects.
-- ============================================================================

-- ── 1. initplan-friendly policies ────────────────────────────────────────────
alter policy "Authenticated users can read agent_skills" on public.agent_skills
  using (((select auth.uid()) is not null) and (is_active = true));

alter policy backend_schema_snapshots_select on public.backend_schema_snapshots
  using (project_id in (
    select p.id from public.projects p
      join public.project_members pm on pm.project_id = p.id
     where pm.user_id = (select auth.uid())));

alter policy backend_spans_member_select on public.backend_spans
  using (project_id in (
    select p.id from public.projects p
      join public.project_members pm on pm.project_id = p.id
     where pm.user_id = (select auth.uid())));

alter policy cqi_all_service on public.content_quality_issues
  using ((select auth.role()) = 'service_role'::text)
  with check ((select auth.role()) = 'service_role'::text);

alter policy cqi_select_member on public.content_quality_issues
  using (project_id in (
    select pm.project_id from public.project_members pm where pm.user_id = (select auth.uid())
    union
    select p.id from public.projects p where p.owner_id = (select auth.uid())));

alter policy "owner read end_user_sessions" on public.end_user_sessions
  using (project_id in (
    select p.id from public.projects p
      join public.organization_members om on om.organization_id = p.organization_id
     where om.user_id = (select auth.uid())));

alter policy "owner read session_page_views" on public.session_page_views
  using (project_id in (
    select p.id from public.projects p
      join public.organization_members om on om.organization_id = p.organization_id
     where om.user_id = (select auth.uid())));

alter policy "Members can create pipeline runs" on public.skill_pipeline_runs
  with check (project_id in (
    select pm.project_id from public.project_members pm where pm.user_id = (select auth.uid())));

alter policy "Members can read their project pipeline runs" on public.skill_pipeline_runs
  using (project_id in (
    select pm.project_id from public.project_members pm where pm.user_id = (select auth.uid())));

alter policy "Members can update pipeline runs they created" on public.skill_pipeline_runs
  using (project_id in (
    select pm.project_id from public.project_members pm where pm.user_id = (select auth.uid())));

alter policy "Members can read step runs via run access" on public.skill_pipeline_step_runs
  using (run_id in (
    select spr.id from public.skill_pipeline_runs spr
     where spr.project_id in (
       select pm.project_id from public.project_members pm where pm.user_id = (select auth.uid()))));

alter policy "Members can update step runs via run access" on public.skill_pipeline_step_runs
  using (run_id in (
    select spr.id from public.skill_pipeline_runs spr
     where spr.project_id in (
       select pm.project_id from public.project_members pm where pm.user_id = (select auth.uid()))));

alter policy "Members can manage their project skill sources" on public.skill_sources
  using (project_id in (
    select pm.project_id from public.project_members pm where pm.user_id = (select auth.uid())));

alter policy "Members can read their project skill sources" on public.skill_sources
  using (project_id in (
    select pm.project_id from public.project_members pm where pm.user_id = (select auth.uid())));

alter policy "project members can read sourcemaps" on public.sourcemaps
  using (project_id in (
    select project_members.project_id from public.project_members
     where project_members.user_id = (select auth.uid())));

alter policy user_push_subscriptions_owner_select on public.user_push_subscriptions
  using ((select auth.uid()) = user_id);

alter policy user_push_subscriptions_owner_insert on public.user_push_subscriptions
  with check ((select auth.uid()) = user_id);

alter policy user_push_subscriptions_owner_delete on public.user_push_subscriptions
  using ((select auth.uid()) = user_id);

-- ── 2. fixed search_path ────────────────────────────────────────────────────
alter function public.get_db_epoch_ms() set search_path = '';
alter function public.set_feature_request_comments_updated_at() set search_path = '';
alter function private.tester_bounty_action(text, text) set search_path = '';

-- ── 3. duplicate index ──────────────────────────────────────────────────────
drop index if exists public.idx_reports_status_project;

-- ── 4. anon grants RLS never honoured ───────────────────────────────────────
revoke all on table
  public.backend_schema_snapshots,
  public.backend_spans,
  public.cli_auth_requests,
  public.codebase_analyze_jobs,
  public.codebase_chat_messages,
  public.codebase_chat_threads,
  public.console_knowledge_chunks,
  public.end_user_sessions,
  public.linear_oauth_states,
  public.mcp_tool_invocations,
  public.notification_deliveries,
  public.organization_integration_settings,
  public.project_codebase_domains,
  public.project_codebase_fingerprints,
  public.project_codebase_graph,
  public.project_codebase_knowledge_chunks,
  public.project_codebase_knowledge_graph,
  public.project_codebase_summaries,
  public.project_codebase_tours,
  public.project_codebase_wiki_sources,
  public.project_sdk_observations,
  public.reporter_notification_prefs,
  public.sdk_upgrade_jobs,
  public.session_page_views,
  public.setup_funnel_events,
  public.sourcemaps,
  public.wallet_debit_dead_letters
from anon;

-- ── 5. leaderboard matview: only the columns the public view reads ──────────
revoke all on public.tester_leaderboard_30d from anon, authenticated;
grant select (
  public_handle, display_name, expertise_tags, reputation_score, signal_pct, rank,
  total_points_30d, total_points_lifetime, submissions_30d, accepted_30d, apps_tested_30d
) on public.tester_leaderboard_30d to anon, authenticated;

notify pgrst, 'reload schema';
