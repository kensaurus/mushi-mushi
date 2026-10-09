-- Replace the HNSW index from 20261009151000 with IVFFlat.
--
-- HNSW fixed reads (1.7 s exact scans to 5 ms) but every chunk row update
-- that is not HOT inserts into the graph: ~200 random page reads into a
-- 284 MB index that does not stay cached beside everything else in 256 MB
-- of shared_buffers. A no-op update of 90 rows took 18 s, so the indexer's
-- refresh batches hit the 8 s statement timeout (Sentry MUSHI-MUSHI-SERVER-2N)
-- and every sweep drove the random IO that caused the original stall. An
-- IVFFlat insert appends to one list page; a search reads `probes` lists.
--
-- lists = 100 for ~73k chunks (rows / 1000 rounded up). IVFFlat centroids
-- come from the build, so they drift as projects are added: rebuild with
-- REINDEX INDEX CONCURRENTLY when the table has grown several-fold.
--
-- iterative scan keeps probing past `probes` until `match_count` rows of
-- this project are found (capped by max_probes); relaxed order is the only
-- order IVFFlat supports, so the outer query re-sorts. The path_prefix
-- branch is unchanged from 20261009152000.

-- Load pgvector in this session: until its library is loaded the ivfflat.*
-- settings below are unregistered placeholders, and setting one of those in
-- a function definition is "permission denied" for non-superusers.
select extensions.vector_dims('[1]'::extensions.vector);

create index if not exists idx_codebase_embedding_ivf_half
  on public.project_codebase_files
  using ivfflat ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops)
  with (lists = 100)
  where embedding is not null and tombstoned_at is null;

drop index if exists public.idx_codebase_embedding_hnsw_half;

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
set ivfflat.iterative_scan to 'relaxed_order'
set ivfflat.probes to '10'
set ivfflat.max_probes to '40'
as $function$
declare
  prefix_rows integer;
begin
  if path_prefix is not null then
    select count(*) into prefix_rows
    from project_codebase_files pcf
    where pcf.project_id = match_project
      and pcf.tombstoned_at is null
      and (pcf.file_path = path_prefix or pcf.file_path like path_prefix || '/%');
  end if;

  if path_prefix is null or prefix_rows > 2000 then
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
          and (
            path_prefix is null
            or pcf.file_path = path_prefix
            or pcf.file_path like path_prefix || '/%'
          )
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
