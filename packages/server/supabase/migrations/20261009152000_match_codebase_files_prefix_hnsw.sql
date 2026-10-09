-- match_codebase_files with a path_prefix kept an exact scan (20261009151000).
-- A broad prefix made that the same full detoast the HNSW index removed:
-- 'src' matched most of a 23.5k-chunk project and hit the 8 s statement
-- timeout on 2026-10-09. The prefix's candidates are now counted first
-- (index-only on idx_codebase_files_active): up to 2,000 rows it stays exact,
-- cheap and complete, since a selective filter is where filtered HNSW returns
-- short; above that the graph is used with the prefix as a filter, which
-- holds at least ~3% of the vectors, so the iterative scan fills match_count.

-- Load pgvector in this session first: until its library is loaded the
-- hnsw.* settings below are unregistered placeholders, and setting one of
-- those in a function definition is "permission denied" for non-superusers.
select extensions.vector_dims('[1]'::extensions.vector);

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
