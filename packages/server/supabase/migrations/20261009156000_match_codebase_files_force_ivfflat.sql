-- Keep match_codebase_files on the IVFFlat index for every project.
--
-- For a project whose chunks are a large share of the table (glot.it, 12.6k of
-- 73k) the planner judged an exact scan through idx_codebase_project cheaper
-- than the vector index: it detoasted every embedding of the project (77k
-- buffer pages). Warm that is 270 ms; cold it took 8.1 s and hit the 8 s
-- statement timeout (MUSHI-MUSHI-SERVER-2D regressed at 14:34 UTC). The
-- vector branch now filters on project_id::text, which no btree serves, and
-- the function turns sequential scans off, so the only plan left is the
-- IVFFlat scan: ~7.5k pages whatever the project (539 ms cold). The
-- path_prefix exact branch (<= 2000 candidates) keeps its btree plan.

-- Load pgvector so the ivfflat.* settings are registered (see 154000).
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
set ivfflat.iterative_scan to 'relaxed_order'
set ivfflat.probes to '20'
set ivfflat.max_probes to '60'
set enable_seqscan to 'off'
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
        where pcf.project_id::text = match_project::text
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
