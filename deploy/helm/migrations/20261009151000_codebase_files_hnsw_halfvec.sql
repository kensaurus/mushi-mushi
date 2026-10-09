-- match_codebase_files ran an exact scan: no vector index existed in
-- production (the HNSW index from 20260416300000 is absent there), so every
-- RAG lookup detoasted every embedding of the project — 138 MB for the
-- largest one (23.5k chunks). Mean 1.7 s, max 7.8 s against PostgREST's 8 s
-- statement timeout. From 2026-10-08 09:44 UTC these scans repeated every
-- 20-30 s, drained the disk IO budget (checkpoints of ~400 buffers took 40-55
-- s) and every other query timed out with them: Sentry MUSHI-MUSHI-SERVER-2D,
-- 2E, 2F, 2G, 2H.
--
-- Fix: a partial HNSW index over the embedding cast to halfvec (half the size
-- of a vector index: ~0.2 GB for 73k chunks, on a 256 MB shared_buffers box),
-- and an RPC whose unfiltered branch orders by that same expression so the
-- planner uses it. pgvector 0.8 iterative scan keeps reading the graph until
-- `match_count` rows of this project are found; relaxed order is re-sorted in
-- the outer query. A path_prefix call keeps the exact scan: its candidate set
-- is small, and a selective filter is where filtered HNSW returns short.
--
-- The phase-2 index (full-precision, never used by the halfvec query) is
-- dropped so fresh and Helm installs do not build two graphs.

set local maintenance_work_mem = '128MB';

drop index if exists public.idx_codebase_embedding;

create index if not exists idx_codebase_embedding_hnsw_half
  on public.project_codebase_files
  using hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops)
  with (m = 16, ef_construction = 64)
  where embedding is not null and tombstoned_at is null;

create or replace function public.match_codebase_files(
  query_embedding vector,
  match_project uuid,
  match_count integer default 5,
  path_prefix text default null
)
returns table(
  id uuid,
  file_path text,
  content_preview text,
  component_tag text,
  symbol_name text,
  signature text,
  line_start integer,
  line_end integer,
  similarity double precision
)
language plpgsql
stable
set search_path to 'pg_catalog', 'public', 'extensions'
set hnsw.iterative_scan to 'relaxed_order'
set hnsw.ef_search to '100'
as $function$
begin
  if path_prefix is null then
    return query
      with hits as materialized (
        select
          pcf.id,
          pcf.file_path,
          pcf.content_preview,
          pcf.component_tag,
          pcf.symbol_name,
          pcf.signature,
          pcf.line_start,
          pcf.line_end,
          (pcf.embedding::halfvec(1536) <=> query_embedding::halfvec(1536)) as distance
        from project_codebase_files pcf
        where pcf.project_id = match_project
          and pcf.tombstoned_at is null
          and pcf.embedding is not null
        order by pcf.embedding::halfvec(1536) <=> query_embedding::halfvec(1536)
        limit match_count
      )
      select h.id, h.file_path, h.content_preview, h.component_tag, h.symbol_name,
             h.signature, h.line_start, h.line_end, (1 - h.distance)::double precision
      from hits h
      order by h.distance;
  else
    return query
      select
        pcf.id,
        pcf.file_path,
        pcf.content_preview,
        pcf.component_tag,
        pcf.symbol_name,
        pcf.signature,
        pcf.line_start,
        pcf.line_end,
        1 - (pcf.embedding <=> query_embedding) as similarity
      from project_codebase_files pcf
      where pcf.project_id = match_project
        and pcf.tombstoned_at is null
        and pcf.embedding is not null
        and (pcf.file_path = path_prefix or pcf.file_path like path_prefix || '/%')
      order by pcf.embedding <=> query_embedding
      limit match_count;
  end if;
end;
$function$;

notify pgrst, 'reload schema';
