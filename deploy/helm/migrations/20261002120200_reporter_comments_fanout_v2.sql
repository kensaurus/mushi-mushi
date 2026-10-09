-- ============================================================================
-- 20261002120200_reporter_comments_fanout_v2
--
-- Plan 018 (docs/execplans/reporter-loop-v2.md §6.1, migration 3).
--
-- 1. report_comments_fanout_to_reporter() stays the guaranteed in-app writer.
--    The console inserts report_comments directly through supabase-js
--    (apps/admin/src/lib/reportComments.ts), bypassing every API helper, so
--    the trigger is the only place every admin reply passes through.
--    - Admin reply visible to the reporter: stamp last_admin_reply_at and
--      admin_seen_at, insert ONE in-app row (dedupe_key = comment id), then
--      ask the reporter-notify-fanout function for email / push. The enqueue
--      is wrapped so a missing mushi_runtime_config row or a pg_net error can
--      never roll back the reply itself; the failure is raised as a WARNING
--      (postgres logs) and the in-app row still exists.
--    - The row's type is 'info_requested' when the comment was posted through
--      mushi_request_reporter_info (transaction-local mushi.comment_kind),
--      otherwise 'comment_reply'. One row either way.
--    - A report without a reporter token gets no row (the old trigger raised a
--      NOT NULL violation there and rolled the comment back).
--    - Reporter reply: stamp last_reporter_reply_at and clear
--      awaiting_reporter_at.
-- 2. mushi_request_reporter_info(): "Ask for more info" as one transaction —
--    set awaiting_reporter_at, insert the visible question.
-- 3. reports_follow_canonical(): when a report is grouped under a canonical
--    report, or dismissed with closed_reason = 'duplicate', its reporter
--    follows the canonical report and gets exactly one duplicate_linked
--    notice (dedupe_key = canonical report id).
--
-- Verify after apply (PL/pgSQL errors only surface when a statement runs —
-- see the 2026-09-22 edge_function_post outage): insert one admin comment on
-- a test report and read postgres_logs / net._http_response.
-- ============================================================================

create or replace function public.report_comments_fanout_to_reporter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report record;
  v_kind text;
begin
  select id, project_id, reporter_token_hash
    into v_report
    from public.reports
   where id = NEW.report_id;

  if v_report.id is null then
    return NEW;
  end if;

  if NEW.author_kind = 'admin' and NEW.visible_to_reporter is true then
    update public.reports
       set last_admin_reply_at = now(),
           admin_seen_at = now()
     where id = NEW.report_id;

    if v_report.reporter_token_hash is not null then
      v_kind := case
        when coalesce(current_setting('mushi.comment_kind', true), '') = 'info_requested'
          then 'info_requested'
        else 'comment_reply'
      end;

      insert into public.reporter_notifications (
        project_id, report_id, reporter_token_hash, notification_type,
        channel, payload, sent_at, status, dedupe_key
      )
      values (
        v_report.project_id,
        v_report.id,
        v_report.reporter_token_hash,
        v_kind,
        'in_app',
        jsonb_build_object(
          'reportId', v_report.id,
          'commentId', NEW.id,
          'message', left(NEW.body, 500)
        ),
        now(),
        'sent',
        NEW.id::text
      )
      on conflict do nothing;

      begin
        perform mushi.edge_function_post(
          'reporter-notify-fanout',
          jsonb_build_object('comment_id', NEW.id, 'report_id', NEW.report_id)
        );
      exception when others then
        raise warning 'reporter_notify_fanout_enqueue_failed comment_id=% report_id=% err=%',
          NEW.id, NEW.report_id, sqlerrm;
      end;
    end if;
  elsif NEW.author_kind = 'admin' then
    -- An internal note still means a developer looked at the report.
    update public.reports
       set admin_seen_at = now()
     where id = NEW.report_id;
  elsif NEW.author_kind = 'reporter' then
    update public.reports
       set last_reporter_reply_at = now(),
           awaiting_reporter_at = null
     where id = NEW.report_id;
  end if;

  return NEW;
end;
$$;

revoke execute on function public.report_comments_fanout_to_reporter() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- "Ask for more info": the question and the waiting state commit together.
-- ---------------------------------------------------------------------------
create or replace function public.mushi_request_reporter_info(
  p_report_id uuid,
  p_project_id uuid,
  p_author_user_id uuid,
  p_author_name text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment_id bigint;
  v_created_at timestamptz;
begin
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'mushi_request_reporter_info: empty question' using errcode = '22023';
  end if;

  update public.reports
     set awaiting_reporter_at = now()
   where id = p_report_id
     and project_id = p_project_id;
  if not found then
    raise exception 'mushi_request_reporter_info: report % not in project %', p_report_id, p_project_id
      using errcode = 'P0002';
  end if;

  perform set_config('mushi.comment_kind', 'info_requested', true);

  insert into public.report_comments (
    report_id, project_id, author_kind, author_user_id, author_name, body, visible_to_reporter
  )
  values (
    p_report_id, p_project_id, 'admin', p_author_user_id,
    coalesce(nullif(btrim(p_author_name), ''), 'Developer'), p_body, true
  )
  returning id, created_at into v_comment_id, v_created_at;

  perform set_config('mushi.comment_kind', '', true);

  return jsonb_build_object('comment_id', v_comment_id, 'created_at', v_created_at);
end;
$$;

revoke execute on function public.mushi_request_reporter_info(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.mushi_request_reporter_info(uuid, uuid, uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Duplicate follows: the reporter's updates move to the canonical report.
-- ---------------------------------------------------------------------------
create or replace function public.reports_follow_canonical()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canonical uuid;
  v_grouped boolean;
  v_closed_dup boolean;
begin
  if NEW.reporter_token_hash is null or NEW.report_group_id is null then
    return NEW;
  end if;

  if tg_op = 'INSERT' then
    v_grouped := true;
    v_closed_dup := false;
  else
    v_grouped := NEW.report_group_id is distinct from OLD.report_group_id;
    v_closed_dup := NEW.status = 'dismissed'
      and NEW.closed_reason = 'duplicate'
      and (OLD.status is distinct from 'dismissed' or OLD.closed_reason is distinct from 'duplicate');
  end if;

  if not (v_grouped or v_closed_dup) then
    return NEW;
  end if;

  select canonical_report_id into v_canonical
    from public.report_groups
   where id = NEW.report_group_id;

  if v_canonical is null or v_canonical = NEW.id then
    return NEW;
  end if;

  begin
    insert into public.reporter_report_follows (report_id, reporter_token_hash, project_id, source_report_id)
    select v_canonical, NEW.reporter_token_hash, NEW.project_id, NEW.id
     where not exists (
       select 1 from public.reports r
        where r.id = v_canonical and r.reporter_token_hash = NEW.reporter_token_hash
     )
    on conflict do nothing;

    if coalesce(
         (select ps.reporter_notifications_enabled from public.project_settings ps
           where ps.project_id = NEW.project_id),
         true
       ) then
      insert into public.reporter_notifications (
        project_id, report_id, reporter_token_hash, notification_type,
        channel, payload, sent_at, status, dedupe_key
      )
      values (
        NEW.project_id,
        NEW.id,
        NEW.reporter_token_hash,
        'duplicate_linked',
        'in_app',
        jsonb_build_object('reportId', NEW.id, 'canonicalReportId', v_canonical),
        now(),
        'sent',
        v_canonical::text
      )
      on conflict do nothing;
    end if;
  exception when others then
    -- Grouping is written by classify-report; a follow failure must not undo it.
    raise warning 'reports_follow_canonical_failed report_id=% canonical=% err=%',
      NEW.id, v_canonical, sqlerrm;
  end;

  return NEW;
end;
$$;

revoke execute on function public.reports_follow_canonical() from public, anon, authenticated;

drop trigger if exists reports_follow_canonical_trigger on public.reports;
create trigger reports_follow_canonical_trigger
after insert or update of report_group_id, status, closed_reason on public.reports
for each row
execute function public.reports_follow_canonical();

notify pgrst, 'reload schema';
