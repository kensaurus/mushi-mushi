-- match_report_embeddings hit the statement timeout on similarity search.
--
-- findSimilarReports (and the reports similarity route) call this RPC.
-- The old body joined reports for the project and kept
-- `1 - (embedding <=> query) > threshold` in WHERE. The planner then
-- exact-scanned every embedding in the project. PostgREST cancels that
-- at the authenticator role's 8s statement_timeout (SQLSTATE 57014),
-- and the search fails.
--
-- The partial HNSW index can answer the search only when the project
-- filter is a residual qual on report_embeddings itself. project_id is
-- copied onto that table: backfilled here, and set on later writes by a
-- trigger so the embedding upsert does not have to know about it. The
-- HNSW index is dropped across the backfill and built once afterwards.
-- A row-by-row update with the graph still attached maintains the index
-- on every row (the 2026-10-09 indexer stall).
--
-- The function then orders by the same distance the index stores, with
-- iterative strict order, sequential scans off, and project_id compared
-- as text so a btree cannot pull the plan back onto an exact scan. The
-- threshold is the distance form of the old similarity comparison
-- (similarity > threshold <=> distance < 1 - threshold). Signature is
-- unchanged.

set local statement_timeout = '0';
set local maintenance_work_mem = '128MB';
set local search_path = public, extensions;

-- Register pgvector GUCs before the function sets hnsw.*.
select extensions.vector_dims('[1]'::extensions.vector);

alter table public.report_embeddings
  add column if not exists project_id uuid;

comment on column public.report_embeddings.project_id is
  'Owning project, copied from reports so match_report_embeddings can filter inside the HNSW scan.';

drop index if exists public.idx_embeddings_default;

update public.report_embeddings re
set project_id = r.project_id
from public.reports r
where r.id = re.report_id
  and re.project_id is null;

create index idx_embeddings_default
  on public.report_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where model = 'text-embedding-3-small' and embedding is not null;

create or replace function public.report_embeddings_set_project_id()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.project_id is null then
    select r.project_id into new.project_id
    from public.reports r
    where r.id = new.report_id;
  end if;
  return new;
end;
$fn$;

revoke all on function public.report_embeddings_set_project_id() from public;
revoke execute on function public.report_embeddings_set_project_id() from anon, authenticated;

drop trigger if exists trg_report_embeddings_project_id on public.report_embeddings;
create trigger trg_report_embeddings_project_id
  before insert or update of report_id, project_id
  on public.report_embeddings
  for each row
  execute function public.report_embeddings_set_project_id();

create or replace function public.match_report_embeddings(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  p_project_id uuid
)
returns table(
  report_id uuid,
  similarity double precision,
  description text,
  category text,
  created_at timestamp with time zone,
  report_group_id uuid
)
language plpgsql
stable
set search_path to 'public', 'extensions'
set hnsw.iterative_scan to 'strict_order'
set hnsw.ef_search to '100'
set enable_seqscan to 'off'
as $fn$
begin
  return query
    with hits as materialized (
      select
        re.report_id,
        (re.embedding <=> query_embedding) as distance
      from public.report_embeddings re
      where re.project_id::text = p_project_id::text
        and re.model = 'text-embedding-3-small'
        and re.embedding is not null
        and (re.embedding <=> query_embedding) < (1 - match_threshold)
      order by re.embedding <=> query_embedding
      limit match_count
    )
    select
      h.report_id,
      (1 - h.distance)::double precision,
      r.description,
      r.category,
      r.created_at,
      r.report_group_id
    from hits h
    join public.reports r on r.id = h.report_id
    order by h.distance;
end;
$fn$;

notify pgrst, 'reload schema';
