-- ============================================================================
-- 20261009170000_erase_subject_count_device_scrubs
--
-- erase_subject() (20261006120000_erase_subject) reported `devices` as the
-- DELETE's row count only. The UPDATE that strips the subject's token digests
-- from device rows shared with other reporters was never counted, so:
--   - the response under-reported what was erased, and
--   - a subject whose only data was those digests got v_total = 0, so the
--     compliance.erase_subject audit row was not written for a real erasure.
-- `devices` now counts deleted rows plus scrubbed rows. Body otherwise
-- unchanged; CREATE OR REPLACE keeps the existing grants.
-- ============================================================================

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
  v_m       integer;
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
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;
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
