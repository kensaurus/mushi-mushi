-- match_codebase_files still hits the 8s statement timeout (57014).
--
-- 20261009156000 forces the halfvec IVFFlat index and, with a literal small
-- LIMIT, finishes in about half a second. Inside plpgsql the limit is the
-- match_count parameter. After a few calls on a pooled connection Postgres
-- caches a generic plan, and a generic LIMIT is costed as a large fraction of
-- the table. The scan then keeps reading lists and detoasting embeddings
-- until the authenticator role's statement_timeout cancels it. Report
-- 32fded2a-1f38-4929-bf29-de4bfb518be2.
--
-- Plan each call with the real limit by splicing a capped integer into the
-- query text (1..20; callers ask for 5, 12, or at most 20). The winning ids
-- are chosen first; content_preview is read only for those rows. The project
-- filter stays a text compare with sequential scans off, so the only plan is
-- the halfvec IVFFlat index. plan_cache_mode stays on custom plans so the
-- embedding parameter is planned the same way. The small-prefix branch stays
-- an exact distance sort. Raising statement_timeout is not the fix: a generic
-- plan does not finish just because it is allowed to run longer.

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
set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  prefix_rows integer;
  lim integer;
begin
  -- Integer only. replace() splices it as text; it is never taken from the
  -- caller as a string, so it cannot change the query.
  lim := least(greatest(coalesce(match_count, 5), 1), 20);

  if path_prefix is not null then
    select count(*) into prefix_rows
    from project_codebase_files pcf
    where pcf.project_id = match_project
      and pcf.tombstoned_at is null
      and (pcf.file_path = path_prefix or pcf.file_path like path_prefix || '/%');
  end if;

  if path_prefix is null or prefix_rows > 2000 then
    return query execute replace($q$
      with hits as materialized (
        select
          pcf.id,
          (pcf.embedding::halfvec(1536) <=> $1::halfvec(1536)) as distance
        from project_codebase_files pcf
        where pcf.project_id::text = $2::text
          and pcf.tombstoned_at is null
          and pcf.embedding is not null
          and (
            $3::text is null
            or pcf.file_path = $3
            or pcf.file_path like $3 || '/%'
          )
        order by pcf.embedding::halfvec(1536) <=> $1::halfvec(1536)
        limit __ROW_LIMIT__
      )
      select
        pcf.id,
        pcf.file_path,
        pcf.content_preview,
        pcf.component_tag,
        pcf.symbol_name,
        pcf.signature,
        pcf.line_start,
        pcf.line_end,
        (1 - h.distance)::double precision
      from hits h
      join project_codebase_files pcf on pcf.id = h.id
      order by h.distance
    $q$, '__ROW_LIMIT__', lim::text)
    using query_embedding, match_project, path_prefix;
  else
    return query execute replace($q$
      with hits as materialized (
        select
          pcf.id,
          (pcf.embedding <=> $1) as distance
        from project_codebase_files pcf
        where pcf.project_id = $2
          and pcf.tombstoned_at is null
          and pcf.embedding is not null
          and (pcf.file_path = $3 or pcf.file_path like $3 || '/%')
        order by pcf.embedding <=> $1
        limit __ROW_LIMIT__
      )
      select
        pcf.id,
        pcf.file_path,
        pcf.content_preview,
        pcf.component_tag,
        pcf.symbol_name,
        pcf.signature,
        pcf.line_start,
        pcf.line_end,
        (1 - h.distance)::double precision
      from hits h
      join project_codebase_files pcf on pcf.id = h.id
      order by h.distance
    $q$, '__ROW_LIMIT__', lim::text)
    using query_embedding, match_project, path_prefix;
  end if;
end;
$function$;

notify pgrst, 'reload schema';
