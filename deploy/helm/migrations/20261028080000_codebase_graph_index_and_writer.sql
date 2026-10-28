/*
FILE: 20261028080000_codebase_graph_index_and_writer.sql
PURPOSE: Index the analyze walk's order, and make the graph's one writer a database rule.

OVERVIEW:
- listIndexedFileRows orders by (file_path, id). idx_codebase_files_active was
  (project_id, file_path) only, so the id tiebreak was an incremental sort the
  planner was free to turn into a project-wide sort. That sort is what pushed
  paged reads toward statement_timeout. The index now leads with the same
  columns the walk orders by.
- A complete index read replaces project_codebase_graph instead of merging
  the stored jsonb (that merge is what grew the row until the upsert hit
  57014). Replacing the row is safe only if nothing else writes it. The
  trigger rejects an insert or update that did not come through
  write_codebase_graph. Deletes stay open so a project cascade can remove
  the row.

USAGE:
- Applied after 20261020123834. Replaces write_codebase_graph. Signature
  and grants are unchanged.

NOTES:
- The old index is dropped and recreated in this transaction, so chunk
  upserts do not maintain two copies. CREATE INDEX takes a share lock for
  the build.
*/

drop index if exists public.idx_codebase_files_active;

create index idx_codebase_files_active
  on public.project_codebase_files (project_id, file_path, id)
  where tombstoned_at is null;

create or replace function public.project_codebase_graph_writer_only()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_setting('mushi.codebase_graph_write', true) is distinct from '1' then
    raise exception 'project_codebase_graph is written only by write_codebase_graph'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

revoke all on function public.project_codebase_graph_writer_only() from public, anon, authenticated;

drop trigger if exists project_codebase_graph_writer_only on public.project_codebase_graph;
create trigger project_codebase_graph_writer_only
  before insert or update on public.project_codebase_graph
  for each row execute function public.project_codebase_graph_writer_only();

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
  perform set_config('statement_timeout', '90s', true);
  -- The row trigger requires this. Transaction-local, so it covers the
  -- insert and the conflict update and ends with the call.
  perform set_config('mushi.codebase_graph_write', '1', true);

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
