-- Write a project's codebase graph with a statement timeout that fits it.
--
-- Sentry MUSHI-MUSHI-SERVER-2Q: the analyze runner upserted the whole graph
-- through PostgREST, under the authenticator role's 8 s statement_timeout.
-- The largest project's graph is about 12 MB of JSON (25.7k nodes, 22.9k
-- edges, 3.7 MB stored), and 2 of its 68 jobs in a week were cancelled at
-- 8 s ("canceling statement due to statement timeout"). The graph is one
-- jsonb row, so batching the write is not an option.
--
-- PostgREST hoists a called function's `set statement_timeout` to the
-- transaction (db-hoisted-tx-settings default), so this RPC gets 60 s while
-- every other request keeps the role's 8 s. Service role only.

create or replace function public.write_codebase_graph(
  p_project_id uuid,
  p_index_fingerprint text,
  p_commit_sha text,
  p_graph jsonb
)
returns void
language sql
security definer
set search_path = public
set statement_timeout = '60s'
as $fn$
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
$fn$;

revoke all on function public.write_codebase_graph(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_codebase_graph(uuid, text, text, jsonb) to service_role;
