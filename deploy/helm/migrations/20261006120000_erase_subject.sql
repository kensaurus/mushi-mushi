-- ============================================================================
-- 20261006120000_erase_subject
--
-- Server-side erasure of one end user ("subject") of a project, for host apps
-- that delete accounts (GDPR Art. 17, Google Play / App Store account
-- deletion). Caller: POST /v1/sdk/erase-subject (api/routes/erase-subject.ts),
-- authenticated by an erase token signed with the project's identity secret.
--
-- DELETE /v1/sdk/me (20260922000015_end_user_erasure) is the end user's own
-- self-service route and only UNLINKS reports (reports.end_user_id ON DELETE
-- SET NULL): the report text, screenshot, console / network logs and device
-- data stay. A deleted account needs them gone, so this erases, within ONE
-- project:
--
--   - reports the subject filed: by end_user_id, by reporter_user_id = sub
--     (legacy unsigned link), and by the reporter-token digests of the
--     subject's own identified sessions / reports in this project (the same
--     device's anonymous reports). Cascades remove comments on them,
--     notifications, follows, embeddings, fix attempts and queue rows.
--     Screenshots are deleted by the route BEFORE this runs (rows are the
--     only record of the storage keys), via erase_subject_targets().
--   - the subject's reporter-side rows in this project keyed by token digest
--     or end_user_id: their comments on other reports, notification prefs
--     (notification email), push subscriptions, reputation, votes,
--     anti-gaming events, support tickets, assistant messages, sessions +
--     page views, product events, activity, experiment assignments and
--     release credits; their token digests are removed from reporter_devices.
--
-- end_users is ORGANIZATION-scoped and an org can hold several apps. Only
-- when the host says the person is gone everywhere (p_erase_identity) is the
-- org-level identity erased too, through the existing erase_end_user().
--
-- Service role only. Nothing here stores the subject id: the audit row has
-- counts only.
-- ============================================================================

-- ── 1. who the subject is inside one project ───────────────────────────────
create or replace function public.erase_subject_scope(p_project_id uuid, p_external_user_id text)
returns table (end_user_id uuid, token_hashes text[])
language sql
stable
security definer
set search_path = public
as $fn$
  with eu as (
    select e.id
      from public.end_users e
      join public.projects p on p.organization_id = e.organization_id
     where p.id = p_project_id
       and e.external_user_id = p_external_user_id
  )
  select (select id from eu),
         coalesce(array(
           select distinct x.t from (
             select s.reporter_token_hash as t
               from public.end_user_sessions s
              where s.project_id = p_project_id
                and s.end_user_id = (select id from eu)
             union
             select r.reporter_token_hash
               from public.reports r
              where r.project_id = p_project_id
                and (r.end_user_id = (select id from eu) or r.reporter_user_id = p_external_user_id)
           ) x
          where x.t is not null
         ), '{}'::text[]);
$fn$;

-- ── 2. storage objects to delete before the rows go ────────────────────────
create or replace function public.erase_subject_targets(p_project_id uuid, p_external_user_id text)
returns table (report_id uuid, screenshot_path text)
language sql
stable
security definer
set search_path = public
as $fn$
  with s as (select * from public.erase_subject_scope(p_project_id, p_external_user_id))
  select r.id, r.screenshot_path
    from public.reports r, s
   where r.project_id = p_project_id
     and r.screenshot_path is not null
     and (r.end_user_id = s.end_user_id
          or r.reporter_user_id = p_external_user_id
          or r.reporter_token_hash = any(s.token_hashes));
$fn$;

-- ── 3. erasure ──────────────────────────────────────────────────────────────
create or replace function public.erase_subject(
  p_project_id uuid,
  p_external_user_id text,
  p_erase_identity boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $fn$
declare
  v_eu      uuid;
  v_tokens  text[];
  v_n       integer;
  v_total   integer := 0;
  v_out     jsonb := '{}'::jsonb;
  v_ident   jsonb;
begin
  if p_project_id is null or coalesce(btrim(p_external_user_id), '') = '' then
    raise exception 'project id and subject are required' using errcode = '22004';
  end if;

  select s.end_user_id, s.token_hashes into v_eu, v_tokens
    from public.erase_subject_scope(p_project_id, p_external_user_id) s;
  v_tokens := coalesce(v_tokens, '{}'::text[]);

  delete from public.reports r
   where r.project_id = p_project_id
     and (r.end_user_id = v_eu
          or r.reporter_user_id = p_external_user_id
          or r.reporter_token_hash = any(v_tokens));
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('reports', v_n); v_total := v_total + v_n;

  delete from public.report_comments c
   where c.project_id = p_project_id and c.author_kind = 'reporter'
     and c.reporter_token_hash = any(v_tokens);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('report_comments', v_n); v_total := v_total + v_n;

  delete from public.reporter_report_follows f
   where f.project_id = p_project_id and f.reporter_token_hash = any(v_tokens);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('report_follows', v_n); v_total := v_total + v_n;

  delete from public.reporter_notifications n
   where n.project_id = p_project_id and n.reporter_token_hash = any(v_tokens);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('reporter_notifications', v_n); v_total := v_total + v_n;

  delete from public.notification_deliveries d
   where d.project_id = p_project_id and d.reporter_token_hash = any(v_tokens);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('notification_deliveries', v_n); v_total := v_total + v_n;

  delete from public.reporter_notification_prefs p
   where p.project_id = p_project_id
     and (p.end_user_id = v_eu or p.reporter_token_hash = any(v_tokens));
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('notification_prefs', v_n); v_total := v_total + v_n;

  delete from public.reporter_push_subscriptions p
   where p.project_id = p_project_id and p.reporter_token_hash = any(v_tokens);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('push_subscriptions', v_n); v_total := v_total + v_n;

  delete from public.reporter_reputation p
   where p.project_id = p_project_id and p.reporter_token_hash = any(v_tokens);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('reputation', v_n); v_total := v_total + v_n;

  delete from public.feature_request_reporter_votes v
   where v.project_id = p_project_id and v.reporter_token_hash = any(v_tokens);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('feature_votes', v_n); v_total := v_total + v_n;

  delete from public.anti_gaming_events a
   where a.project_id = p_project_id and a.reporter_token_hash = any(v_tokens);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('anti_gaming_events', v_n); v_total := v_total + v_n;

  delete from public.support_tickets t
   where t.project_id = p_project_id and t.reporter_token_hash = any(v_tokens);
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('support_tickets', v_n); v_total := v_total + v_n;

  -- A device row lists every token digest seen on it. Drop the row when all
  -- of them are the subject's; otherwise remove only the subject's digests.
  delete from public.reporter_devices d
   where d.project_id = p_project_id
     and cardinality(coalesce(d.reporter_tokens, '{}')) > 0
     and d.reporter_tokens <@ v_tokens;
  get diagnostics v_n = row_count;
  update public.reporter_devices d
     set reporter_tokens = array(select t from unnest(d.reporter_tokens) t where t <> all(v_tokens)),
         updated_at = now()
   where d.project_id = p_project_id
     and d.reporter_tokens && v_tokens;
  v_out := v_out || jsonb_build_object('devices', v_n); v_total := v_total + v_n;

  delete from public.sdk_assistant_messages m
   where m.project_id = p_project_id
     and (m.end_user_id = v_eu or m.reporter_token_hash = any(v_tokens));
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('assistant_messages', v_n); v_total := v_total + v_n;

  delete from public.session_page_views pv
   using public.end_user_sessions s
   where s.project_id = p_project_id
     and pv.project_id = s.project_id
     and pv.session_id = s.session_id
     and (s.end_user_id = v_eu or s.reporter_token_hash = any(v_tokens));
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('page_views', v_n); v_total := v_total + v_n;

  delete from public.end_user_sessions s
   where s.project_id = p_project_id
     and (s.end_user_id = v_eu or s.reporter_token_hash = any(v_tokens));
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('sessions', v_n); v_total := v_total + v_n;

  delete from public.product_events e
   where e.project_id = p_project_id
     and (e.end_user_id = v_eu or e.anon_id = any(v_tokens));
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('product_events', v_n); v_total := v_total + v_n;

  if v_eu is not null then
    delete from public.end_user_activity a
     where a.project_id = p_project_id and a.end_user_id = v_eu;
    get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('activity', v_n); v_total := v_total + v_n;

    delete from public.experiment_assignments x
     using public.experiments ex
     where x.experiment_id = ex.id and ex.project_id = p_project_id
       and x.end_user_id = v_eu;
    get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('experiment_assignments', v_n); v_total := v_total + v_n;

    delete from public.release_credits rc
     using public.releases rl
     where rc.release_id = rl.id and rl.project_id = p_project_id
       and rc.end_user_id = v_eu;
    get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('release_credits', v_n); v_total := v_total + v_n;
  end if;

  -- Org-level identity: only when the host says the person is gone
  -- everywhere. Another app in the org keeps its link otherwise.
  if p_erase_identity and v_eu is not null then
    v_ident := public.erase_end_user(v_eu);
    v_out := v_out || jsonb_build_object('identity', v_ident);
    v_total := v_total + coalesce((v_ident->>'end_users')::int, 0);
  else
    v_out := v_out || jsonb_build_object('identity', null);
  end if;

  if v_total > 0 then
    insert into public.audit_logs (project_id, actor_id, actor_email, actor_type, action,
                                   resource_type, resource_id, metadata)
    values (p_project_id, '00000000-0000-0000-0000-000000000000', 'erase-subject@mushi-mushi',
            'system', 'compliance.erase_subject', 'end_user', null,
            jsonb_build_object('erased', v_out, 'erase_identity', p_erase_identity));
  end if;

  return v_out || jsonb_build_object('subject_known', v_eu is not null or v_total > 0);
end;
$fn$;

revoke all on function public.erase_subject_scope(uuid, text) from public, anon, authenticated;
revoke all on function public.erase_subject_targets(uuid, text) from public, anon, authenticated;
revoke all on function public.erase_subject(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.erase_subject_targets(uuid, text) to service_role;
grant execute on function public.erase_subject(uuid, text, boolean) to service_role;

comment on function public.erase_subject(uuid, text, boolean) is
  'Service role only (POST /v1/sdk/erase-subject). Deletes one end user''s reports and reporter data in one project; erases the org-level end_users identity only when p_erase_identity. Returns per-table counts.';
