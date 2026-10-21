-- match_codebase_files still hits statement_timeout (57014) after 20261009156000.
--
-- RAG calls it on every classification (rag.ts logs "match_codebase_files rpc
-- failed"). The IVFFlat plan measured then was ~539 ms cold. The body passed
-- LIMIT match_count, a PL/pgSQL parameter. After a few calls on a PostgREST
-- connection the interpreter switches to a generic plan, and a generic plan
-- does not see that the limit is 5. It prices an unbounded scan. With the
-- project's embeddings toasted, that is the exact detoast that took 8.1 s
-- cold and was cancelled at the role's 8 s statement_timeout.
--
-- The scan statement is now EXECUTE'd with the limit spliced in as a literal
-- (capped at 20, which is every caller's ceiling), so it is planned every
-- time with LIMIT 5 / 12 / 20 visible. plan_cache_mode = force_custom_plan
-- covers the prefix count. enable_bitmapscan = off closes the bitmap-and-sort
-- detoast; enable_seqscan stays off; project_id::text still blocks the btree.
-- A null path_prefix (the RAG call) has no LIKE predicate, so that filter
-- cannot be costed as selective. The inner scan returns ids only; the preview
-- text is read afterwards for those rows. The outer ORDER BY distance + 0
-- keeps the Postgres 17 re-sort from pulling the inner limit into one node.

-- Load pgvector so the ivfflat.* settings below are registered (see 154000).
-- The halfvec(1536) casts must match idx_codebase_embedding_ivf_half; every
-- codebase embedding is text-embedding-3-small at 1536 dimensions
-- (DEFAULT_DIMENSIONS in _shared/embeddings.ts).
select extensions.vector_dims('[1]'::extensions.vector);

create or replace function public.match_codebase_files(
  query_embedding extensions.vector,
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
set enable_bitmapscan to 'off'
set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  prefix_rows integer;
  capped integer;
begin
  capped := least(greatest(coalesce(match_count, 5), 1), 20);

  if path_prefix is not null then
    select count(*) into prefix_rows
    from (
      select 1
      from project_codebase_files pcf
      where pcf.project_id = match_project
        and pcf.tombstoned_at is null
        and (pcf.file_path = path_prefix or pcf.file_path like path_prefix || '/%')
      limit 2001
    ) bounded;
  end if;

  if path_prefix is not null and prefix_rows <= 2000 then
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
      limit capped;
    return;
  end if;

  -- ann: no path filter
  if path_prefix is null then
    return query execute replace(
      $ann$
        with hits as materialized (
          select
            pcf.id,
            (pcf.embedding::halfvec(1536) <=> $1::halfvec(1536)) as distance
          from project_codebase_files pcf
          where pcf.project_id::text = $2::text
            and pcf.tombstoned_at is null
            and pcf.embedding is not null
          order by pcf.embedding::halfvec(1536) <=> $1::halfvec(1536)
          limit __CAP__
        )
        select pcf.id, pcf.file_path, pcf.content_preview, pcf.component_tag,
               pcf.symbol_name, pcf.signature, pcf.line_start, pcf.line_end,
               (1 - h.distance)::double precision
        from hits h
        join project_codebase_files pcf on pcf.id = h.id
        order by h.distance + 0
      $ann$,
      '__CAP__',
      capped::text
    )
    using query_embedding, match_project;
    return;
  end if;

  -- ann: broad path prefix
  return query execute replace(
    $ann$
      with hits as materialized (
        select
          pcf.id,
          (pcf.embedding::halfvec(1536) <=> $1::halfvec(1536)) as distance
        from project_codebase_files pcf
        where pcf.project_id::text = $2::text
          and pcf.tombstoned_at is null
          and pcf.embedding is not null
          and (pcf.file_path = $3 or pcf.file_path like $3 || '/%')
        order by pcf.embedding::halfvec(1536) <=> $1::halfvec(1536)
        limit __CAP__
      )
      select pcf.id, pcf.file_path, pcf.content_preview, pcf.component_tag,
             pcf.symbol_name, pcf.signature, pcf.line_start, pcf.line_end,
             (1 - h.distance)::double precision
      from hits h
      join project_codebase_files pcf on pcf.id = h.id
      order by h.distance + 0
    $ann$,
    '__CAP__',
    capped::text
  )
  using query_embedding, match_project, path_prefix;
end;
$function$;

comment on function public.match_codebase_files(extensions.vector, uuid, integer, text) is
  'Nearest codebase files by embedding. match_count is clamped to 1..20: larger values return at most 20 rows, 0 or negative returns 1, null returns 5.';

notify pgrst, 'reload schema';
