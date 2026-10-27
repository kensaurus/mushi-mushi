/*
FILE: 20261020123834_codebase_graph_write_lock.sql
PURPOSE: Make write_codebase_graph finish under the statement timeout.

OVERVIEW:
- Sentry 7786063319: the analyze runner's graph upsert is cancelled with
  SQLSTATE 57014 ("canceling statement due to statement timeout").
- The 20261014120000 RPC raised the timeout to 60s. A second job for the
  same project waits on the single jsonb row, and that wait counts toward
  the timeout. pglz toast compression of the multi-megabyte document is
  the other slow part.
- This replaces the function: PostgREST hoists statement_timeout to 90s
  before the call, the body takes a non-blocking advisory lock so the
  waiter fails fast (55P03 graph_write_busy) instead of sitting out the
  timeout, and the column compresses new values with lz4.

USAGE:
- Called only by codebase-analyze-runner via rpc write_codebase_graph.
- Service role only. Signature is unchanged, so existing grants stay.

NOTES:
- 90s stays inside the edge worker's request wall clock. lz4 requires a
  server built with lz4 (Supabase Postgres is). If it is unavailable the
  compression change is skipped and pglz remains.
*/

create or replace function public.write_codebase_graph(
  p_project_id uuid,
  p_index_fingerprint text,
  p_commit_sha text,
  p_graph jsonb
)
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '90s'
as $fn$
begin
  -- Re-arm the timer for the statements below. The function SET above is
  -- what PostgREST hoists onto the transaction before this call.
  perform set_config('statement_timeout', '90s', true);

  if not pg_try_advisory_xact_lock(
    hashtext('mushi-codebase-graph'),
    hashtext(p_project_id::text)
  ) then
    raise exception 'graph_write_busy'
      using errcode = '55P03';
  end if;

  insert into public.project_codebase_graph
    (project_id, index_fingerprint, commit_sha, graph, graph_version, updated_at)
  values
    (p_project_id, p_index_fingerprint, p_commit_sha, p_graph, 1, now())
  on conflict (project_id) do update set
    index_fingerprint = excluded.index_fingerprint,
    commit_sha        = excluded.commit_sha,
    graph             = excluded.graph,
    graph_version     = excluded.graph_version,
    updated_at        = excluded.updated_at;
end;
$fn$;

revoke all on function public.write_codebase_graph(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_codebase_graph(uuid, text, text, jsonb) to service_role;

do $lz4$
begin
  execute 'alter table public.project_codebase_graph alter column graph set compression lz4';
exception
  when feature_not_supported then
    raise notice 'lz4 unavailable; project_codebase_graph.graph stays on pglz';
end;
$lz4$;
